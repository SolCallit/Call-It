import { NextResponse, after } from 'next/server';
import { requireMe, json } from '@/lib/db/me';
import { burst, dailyCount } from '@/lib/ratelimit';
import { siAllowed } from '@/lib/si/access';
import { runAgent, DEFAULT_MODEL, type Msg } from '@/lib/si/agent';
import { liveToolbox } from '@/lib/si/tools';
import { systemDynamic, type Goals } from '@/lib/si/prompt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/assistant { messages: [{ role, content }] }
 *   → { reply, tokens, proposals, log_id }
 * SI, the advisor in your wallet: knows your holdings and goals, explains moves, and prepares trades
 * that only happen when you approve and sign them.
 */
export async function POST(req: Request) {
  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  const { db, me } = ctx;
  if (!siAllowed(me)) return json({ error: 'SI Assistant is coming soon.' }, 503);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'assistant_not_configured' }, 503);
  // Every message costs money: 6 a minute and ASSISTANT_DAILY_LIMIT (default 30) a day per account.
  if (!burst('ast:' + me.id, 6, 60_000)) return json({ error: 'Slow down a little. Try again in a minute.' }, 429);
  const limit = Number(process.env.ASSISTANT_DAILY_LIMIT) || 30;
  if ((await dailyCount(db, 'ast:' + me.id)) > limit) return json({ error: `You’ve used today’s ${limit} SI messages. Back tomorrow.` }, 429);

  const b = (await req.json().catch(() => ({}))) as { messages?: { role?: string; content?: unknown }[] };
  const history: Msg[] = (b.messages || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-16)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: (m.content as string).slice(0, 4000) }));
  while (history.length && history[0].role !== 'user') history.shift();
  if (!history.length || history[history.length - 1].role !== 'user') return json({ error: 'bad_request' }, 400);

  // Goals and unseen flags go into the per-turn context. Missing tables (migration 0026 not run) = no goals.
  const [{ data: g }, { count: flags }] = await Promise.all([
    db.from('si_profiles').select('risk, goal, max_trade_pct, notes').eq('profile_id', me.id).maybeSingle(),
    db.from('si_flags').select('id', { count: 'exact', head: true }).eq('profile_id', me.id).eq('seen', false),
  ]);
  const goals = (g as Goals) || null;
  const toolbox = liveToolbox(db, me, goals);

  let r;
  try {
    r = await runAgent({ history, toolbox, model: process.env.SI_MODEL || process.env.ASSISTANT_MODEL || DEFAULT_MODEL, dynamicSystem: systemDynamic({ handle: me.handle, goals, flags: flags || 0 }) });
  } catch (e) {
    console.error('[assistant]', (e as Error).message);
    return json({ error: (e as Error).message === 'assistant_not_configured' ? 'assistant_not_configured' : 'assistant_unavailable' }, 502);
  }

  // Log the turn (for feedback and the eval suite). Tool outputs are summarized, not stored whole.
  const { data: log } = await db.from('si_logs').insert({
    profile_id: me.id, prompt_version: r.prompt_version, model: r.model,
    question: String(history[history.length - 1].content).slice(0, 2000), reply: r.reply.slice(0, 4000),
    tools: r.tools.map((t) => ({ name: t.name, input: t.input, ms: t.ms, ok: t.ok })),
    checks: { ...r.checks, corrected: r.corrected }, usage: r.usage, latency_ms: r.latency_ms, steps: r.steps,
  }).select('id').maybeSingle();
  if (log?.id && toolbox.proposals.length) {
    const ids = toolbox.proposals.map((p) => p.id);
    after(async () => { await db.from('si_proposals').update({ log_id: log.id }).in('id', ids); });
  }
  if (r.checks.ungrounded.length) console.warn('[assistant] ungrounded numbers', r.checks.ungrounded.join(' '));

  return json({ reply: r.reply, tokens: toolbox.tokens.slice(0, 4), proposals: toolbox.proposals, checks: toolbox.checks.slice(0, 3), log_id: log?.id || null });
}
