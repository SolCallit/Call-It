import { NextResponse } from 'next/server';
import { requireMe, json } from '@/lib/db/me';
import { isMint, jupSearch, liveToken, type LiveToken } from '@/lib/market/sources';
import { burst, dailyCount } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = process.env.ASSISTANT_MODEL || 'claude-sonnet-5-5';

const SYSTEM = `You are the Callit Assistant inside Callit, a Solana-first social app where people post structured token "calls" (entry market cap, thesis, target, time horizon). Callers who buy the token they call with their own wallet earn fees; anyone can call. Slogan: "Call it. Get Paid."

Your job: help people research a token before they call it or follow someone's call, and help them write clear calls.

Style: short and direct, written for a phone screen. Plain sentences. No markdown headers, tables or bold. A short dash list is fine for risks.

Rules:
- Before saying anything about a specific token, use the tools. Never invent prices, market caps, holders, liquidity or audit results.
- Contract address given: use lookup_token. Only a ticker or name given: use search_tokens, show the matches with their contract addresses, and tell the user to confirm the exact CA, because tickers are copied by scam tokens all the time.
- Always read out risk signals when present: mint authority still on, freeze authority still on, top 10 holders owning a large share, thin liquidity versus market cap, unverified token, low organic score, flagged as suspicious, very new token.
- You can explain how calls, win rate, caller fees, promotions and the feed work on Callit, and help someone tighten a call thesis.
- Never tell anyone to buy, sell or how much to put in, and never promise returns. You give the information; they make the call.`;

const TOOLS = [
  {
    name: 'lookup_token',
    description: 'Live market data and safety audit for one Solana token by mint (contract) address.',
    input_schema: { type: 'object', properties: { mint: { type: 'string', description: 'Solana mint address' } }, required: ['mint'] },
  },
  {
    name: 'search_tokens',
    description: 'Find Solana tokens by ticker or name. Returns up to 5 matches with mint addresses so the user can confirm the right one.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
];

type Block = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> };
type Msg = { role: 'user' | 'assistant'; content: string | unknown[] };

const brief = (t: LiveToken) => ({
  mint: t.mint, symbol: t.sym, name: t.name, price_usd: t.price, market_cap_usd: t.mc, liquidity_usd: t.liq,
  holders: t.holders, volume_24h_usd: t.vol24, change_pct: t.chg, created_at: t.createdAt, verified: t.verified,
  organic_score: t.organic, mint_authority_disabled: t.audit.mintOff, freeze_authority_disabled: t.audit.freezeOff,
  top10_holders_pct: t.audit.top10, dev_holding_pct: t.audit.dev, flagged_suspicious: t.audit.sus, launchpad: t.launchpad,
});

async function claude(messages: Msg[]) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, system: SYSTEM, tools: TOOLS, messages }),
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw new Error(`anthropic_${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as { stop_reason: string; content: Block[] };
}

/**
 * POST /api/assistant { messages: [{ role, content }] } → { reply, tokens }
 * Signed-in users only (protects API spend). Tokens the model looked up come back
 * as full LiveToken objects so the app can render real token cards.
 */
export async function POST(req: Request) {
  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  // Locked until SI Assistant launches: set SI_ASSISTANT=1 in Vercel (and SI_OPEN in the app) to open it.
  if (process.env.SI_ASSISTANT !== '1') return json({ error: 'SI Assistant is coming soon.' }, 503);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'assistant_not_configured' }, 503);
  // Every message costs money: 6 a minute and ASSISTANT_DAILY_LIMIT (default 30) a day per account.
  if (!burst('ast:' + ctx.me.id, 6, 60_000)) return json({ error: 'Slow down a little. Try again in a minute.' }, 429);
  const limit = Number(process.env.ASSISTANT_DAILY_LIMIT) || 30;
  if ((await dailyCount(ctx.db, 'ast:' + ctx.me.id)) > limit) return json({ error: `You’ve used today’s ${limit} Assistant messages. Back tomorrow.` }, 429);

  const b = (await req.json().catch(() => ({}))) as { messages?: { role?: string; content?: unknown }[] };
  const history: Msg[] = (b.messages || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-16)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: (m.content as string).slice(0, 4000) }));
  while (history.length && history[0].role !== 'user') history.shift();
  if (!history.length || history[history.length - 1].role !== 'user') return json({ error: 'bad_request' }, 400);

  const tokens: LiveToken[] = [];
  const keep = (t: LiveToken | null) => { if (t && !tokens.some((x) => x.mint === t.mint)) tokens.push(t); };
  let convo = history;

  try {
    for (let step = 0; step < 5; step++) {
      const res = await claude(convo);
      if (res.stop_reason !== 'tool_use') {
        const reply = res.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
        return json({ reply: reply || 'Sorry, I didn’t get that. Try again?', tokens: tokens.slice(0, 4) });
      }
      const results = [];
      for (const c of res.content) {
        if (c.type !== 'tool_use') continue;
        let out: unknown;
        if (c.name === 'lookup_token') {
          const mint = String(c.input?.mint || '').trim();
          const t = isMint(mint) ? await liveToken(mint).catch(() => null) : null;
          keep(t);
          out = t ? brief(t) : { error: isMint(mint) ? 'not_found' : 'not_a_valid_solana_mint' };
        } else if (c.name === 'search_tokens') {
          const q = String(c.input?.query || '').trim().slice(0, 40);
          const list = q ? (await jupSearch(q).catch(() => [])).slice(0, 5) : [];
          out = list.length ? list.map(brief) : { error: 'no_matches' };
        } else out = { error: 'unknown_tool' };
        results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out) });
      }
      convo = [...convo, { role: 'assistant', content: res.content }, { role: 'user', content: results }];
    }
    return json({ reply: 'That took too many steps. Ask me one thing at a time?', tokens: tokens.slice(0, 4) });
  } catch (e) {
    console.error('[assistant]', e);
    return json({ error: 'assistant_unavailable' }, 502);
  }
}
