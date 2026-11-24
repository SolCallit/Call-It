import { NextResponse } from 'next/server';
import { requireMe, json } from '@/lib/db/me';
import { siAllowed } from '@/lib/si/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET → { allowed, goals, flags }: what SI knows about your goals, and its latest flags on your holdings. */
export async function GET(req: Request) {
  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  const allowed = siAllowed(ctx.me);
  if (!allowed) return json({ allowed: false });
  const [{ data: goals, error }, { data: flags }] = await Promise.all([
    ctx.db.from('si_profiles').select('risk, goal, max_trade_pct, notes, watch').eq('profile_id', ctx.me.id).maybeSingle(),
    ctx.db.from('si_flags').select('id, mint, sym, kind, severity, title, detail, seen, created_at').eq('profile_id', ctx.me.id)
      .gte('created_at', new Date(Date.now() - 3 * 864e5).toISOString()).order('created_at', { ascending: false }).limit(8),
  ]);
  return json({ allowed, ready: !error, goals: goals || null, flags: flags || [] });
}

/** POST { risk?, goal?, max_trade_pct?, notes?, watch? } — save goals (also how the app sets them up). */
export async function POST(req: Request) {
  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  if (!siAllowed(ctx.me)) return json({ error: 'SI Assistant is coming soon.' }, 503);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = { profile_id: ctx.me.id, updated_at: new Date().toISOString() };
  if (['careful', 'balanced', 'degen'].includes(String(b.risk))) patch.risk = b.risk;
  if (['grow', 'stack_sol', 'protect', 'runners'].includes(String(b.goal))) patch.goal = b.goal;
  const m = Number(b.max_trade_pct);
  if (b.max_trade_pct !== undefined) { if (!(m >= 1 && m <= 100)) return json({ error: 'max_trade_pct must be 1–100' }, 400); patch.max_trade_pct = m; }
  if (typeof b.notes === 'string') patch.notes = b.notes.trim().slice(0, 500) || null;
  if (typeof b.watch === 'boolean') patch.watch = b.watch;
  const { data, error } = await ctx.db.from('si_profiles').upsert(patch, { onConflict: 'profile_id' }).select('risk, goal, max_trade_pct, notes, watch').single();
  if (error) return json({ error: /does not exist|schema cache/i.test(error.message) ? 'Run migration 0026 first.' : 'save_failed' }, 503);
  return json({ goals: data });
}
