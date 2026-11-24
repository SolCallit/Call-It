import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isMint, jupSearch, liveToken, memeFlow, type LiveToken } from '@/lib/market/sources';
import { buildPortfolio, riskFlags, type Portfolio } from '@/lib/si/portfolio';
import { crossCheckToken, checkTrade, type CrossCheck } from '@/lib/si/crosscheck';
import type { Goals } from '@/lib/si/prompt';
import type { CheckCard, Proposal, Toolbox } from '@/lib/si/tools-spec';
export { TOOL_SPECS } from '@/lib/si/tools-spec';
export type { Proposal, Toolbox } from '@/lib/si/tools-spec';

/* ---------- SI tools: the live Toolbox ----------
   Real chain + market data and the user's own rows. Specs live in tools-spec.ts. */

/** What the model sees of a token: facts only, risk spelled out. */
export const tokenBrief = (t: LiveToken) => ({
  mint: t.mint, symbol: t.sym, name: t.name, price_usd: t.price, market_cap_usd: t.mc, liquidity_usd: t.liq,
  holders: t.holders, volume_24h_usd: t.vol24, change_pct: t.chg, buys_24h: t.buys24, sells_24h: t.sells24,
  net_flow_1h_usd: t.flow?.h1 ? Math.round(t.flow.h1.bv - t.flow.h1.sv) : null,
  created_at: t.createdAt, launchpad: t.launchpad, verified: t.verified, organic_score: t.organic,
  top10_holders_pct: t.audit.top10, dev_holding_pct: t.audit.dev, risk_flags: riskFlags(t),
});

const SOL_FEE_RESERVE = 0.01;

const tokenCard = (c: CrossCheck): CheckCard => ({ kind: 'token', mint: c.mint, symbol: c.symbol, label: c.verdict.label, score: c.verdict.score, signals: c.verdict.signals.slice(0, 6) });
function tradeCard(c: CrossCheck, t: { usd: number; est_price_impact_pct: number | null; signals: CheckCard['signals'] }): CheckCard {
  const sig = [...t.signals, ...c.verdict.signals].sort((a, b) => ({ red: 0, yellow: 1, green: 2 }[a.level] - { red: 0, yellow: 1, green: 2 }[b.level]));
  return { kind: 'trade', mint: c.mint, symbol: c.symbol, label: c.verdict.label, score: c.verdict.score, signals: sig.slice(0, 6), est_price_impact_pct: t.est_price_impact_pct, usd: t.usd };
}

/** The real Toolbox: live chain + market data and the user's own rows. */
export function liveToolbox(db: SupabaseClient, me: { id: string; handle: string; wallet_address: string | null }, goals: Goals): Toolbox {
  let book: Portfolio | null = null;
  const portfolio = async () => {
    if (!me.wallet_address) throw new Error('no_wallet');
    return (book ||= await buildPortfolio(db, me.id, me.wallet_address));
  };
  const tb: Toolbox = {
    tokens: [], proposals: [], checks: [],
    async run(name, input) {
      const keep = (t: LiveToken | null) => { if (t && !tb.tokens.some((x) => x.mint === t.mint)) tb.tokens.push(t); return t; };
      switch (name) {
        case 'get_portfolio': {
          if (!me.wallet_address) return { error: 'no_wallet', note: 'The user has no wallet connected yet.' };
          return await portfolio();
        }
        case 'get_activity': {
          const days = Math.min(90, Math.max(1, Number(input.days) || 14));
          const { data } = await db.from('transactions').select('kind, in_mint, in_amount, out_mint, out_amount, usd_value, label, created_at')
            .eq('profile_id', me.id).in('kind', ['buy', 'sell', 'swap']).eq('verified', true)
            .gte('created_at', new Date(Date.now() - days * 864e5).toISOString()).order('created_at', { ascending: false }).limit(40);
          return { days, trades: (data || []).map((t) => ({ side: t.kind, what: t.label, usd: t.usd_value, at: t.created_at })) };
        }
        case 'get_flags': {
          const { data } = await db.from('si_flags').select('sym, mint, kind, severity, title, detail, created_at, seen')
            .eq('profile_id', me.id).order('created_at', { ascending: false }).limit(10);
          await db.from('si_flags').update({ seen: true }).eq('profile_id', me.id).eq('seen', false);
          return { flags: data || [] };
        }
        case 'save_goals': {
          const patch: Record<string, unknown> = { profile_id: me.id, updated_at: new Date().toISOString() };
          if (['careful', 'balanced', 'degen'].includes(String(input.risk))) patch.risk = input.risk;
          if (['grow', 'stack_sol', 'protect', 'runners'].includes(String(input.goal))) patch.goal = input.goal;
          const m = Number(input.max_trade_pct);
          if (Number.isFinite(m) && m >= 1 && m <= 100) patch.max_trade_pct = m;
          if (typeof input.notes === 'string') patch.notes = input.notes.slice(0, 500);
          const { error } = await db.from('si_profiles').upsert(patch, { onConflict: 'profile_id' });
          return error ? { error: 'save_failed' } : { saved: Object.keys(patch).filter((k) => k !== 'profile_id' && k !== 'updated_at') };
        }
        case 'lookup_token': {
          const mint = String(input.mint || '').trim();
          if (!isMint(mint)) return { error: 'not_a_valid_solana_mint' };
          const t = keep(await liveToken(mint).catch(() => null));
          return t ? tokenBrief(t) : { error: 'not_found' };
        }
        case 'search_tokens': {
          const q = String(input.query || '').trim().slice(0, 40);
          const list = q ? (await jupSearch(q).catch(() => [])).slice(0, 5) : [];
          return list.length ? { matches: list.map(tokenBrief) } : { error: 'no_matches' };
        }
        case 'market_pulse': {
          const f = await memeFlow().catch(() => null);
          if (!f) return { error: 'unavailable' };
          const tok = (x: { sym: string; mint: string; mc: number | null; net: number }) => ({ symbol: x.sym, mint: x.mint, market_cap_usd: x.mc, net_flow_usd: Math.round(x.net) });
          return {
            tokens_tracked: f.tokens,
            flow: Object.fromEntries(Object.entries(f.win).map(([k, v]) => [k, { buy_usd: Math.round(v.buy), sell_usd: Math.round(v.sell), net_usd: Math.round(v.net), traders: v.traders }])),
            by_market_cap: f.buckets.map((b) => ({ bucket: b.label, tokens: b.n, net_1h_usd: Math.round(b.w.h1.b - b.w.h1.s), net_24h_usd: Math.round(b.w.h24.b - b.w.h24.s) })),
            top_inflow: f.topIn.slice(0, 5).map(tok), top_outflow: f.topOut.slice(0, 5).map(tok),
          };
        }
        case 'caller_record': {
          const h = String(input.handle || '').replace(/^@/, '').toLowerCase();
          if (!/^[a-z0-9_]{3,20}$/.test(h)) return { error: 'invalid_handle' };
          const { data: p } = await db.from('profiles').select('id, handle').eq('handle', h).maybeSingle();
          if (!p) return { error: 'not_found' };
          const { data: calls } = await db.from('posts').select('peak_x, target_at, created_at').eq('profile_id', p.id).eq('kind', 'meme').is('deleted_at', null)
            .gte('created_at', new Date(Date.now() - 90 * 864e5).toISOString()).limit(500);
          const l = (calls || []).map((c) => Number(c.peak_x) || 0);
          return {
            handle: p.handle, calls_90d: l.length, held_2x: l.filter((x) => x >= 2).length,
            target_hits: (calls || []).filter((c) => c.target_at).length,
            best_peak_x: l.length ? +Math.max(...l).toFixed(2) : null,
            avg_peak_x: l.length ? +(l.reduce((a, x) => a + x, 0) / l.length).toFixed(2) : null,
          };
        }
        case 'cross_check_token': {
          const mint = String(input.mint || '').trim();
          if (!isMint(mint)) return { error: 'not_a_valid_solana_mint' };
          const c = await crossCheckToken(db, mint);
          if (!c) return { error: 'not_found' };
          keep(await liveToken(mint).catch(() => null));
          tb.checks.push(tokenCard(c));
          return c;
        }
        case 'check_trade': {
          const side = input.side === 'buy' || input.side === 'sell' ? input.side : null;
          const mint = String(input.mint || '').trim();
          if (!side || !isMint(mint)) return { error: 'invalid_input' };
          let book: Portfolio;
          try { book = await portfolio(); } catch { return { error: 'no_wallet' }; }
          const r = await checkTrade(db, book, goals, { side, mint, sol_amount: Number(input.sol_amount) || undefined, sell_pct: Number(input.sell_pct) || undefined });
          if ('error' in r) return r;
          keep(await liveToken(mint).catch(() => null));
          tb.checks.push(tradeCard(r.token, r.trade));
          return r;
        }
        case 'propose_trade': return proposeTrade(db, me, goals, input, portfolio, keep, tb);
        default: return { error: 'unknown_tool' };
      }
    },
  };
  return tb;
}

async function proposeTrade(
  db: SupabaseClient, me: { id: string }, goals: Goals, input: Record<string, unknown>,
  portfolio: () => Promise<Portfolio>, keep: (t: LiveToken | null) => LiveToken | null, tb: Toolbox,
): Promise<unknown> {
  if (tb.proposals.length >= 1) return { error: 'one_trade_at_a_time', note: 'One proposal per message. Let the user approve or decline this one first.' };
  const side = input.side === 'buy' || input.side === 'sell' ? input.side : null;
  const mint = String(input.mint || '');
  const reason = String(input.reason || '').trim().slice(0, 200);
  if (!side || !isMint(mint) || !reason) return { error: 'invalid_input' };
  const t = keep(await liveToken(mint).catch(() => null));
  if (!t?.price) return { error: 'token_not_tradable', note: 'No live price for this token right now.' };
  let book: Portfolio;
  try { book = await portfolio(); } catch { return { error: 'no_wallet' }; }
  let sol_amount: number | null = null, sell_pct: number | null = null, usd_value = 0;

  if (side === 'buy') {
    const amt = Number(input.sol_amount);
    if (!(amt > 0)) return { error: 'sol_amount_required' };
    const room = Math.max(0, book.sol.amount - SOL_FEE_RESERVE);
    if (amt > room) return { error: 'not_enough_sol', sol_available: +room.toFixed(4) };
    const solPx = book.sol.amount ? book.sol.value_usd / book.sol.amount : 0;
    const pct = book.total_usd ? ((amt * solPx) / book.total_usd) * 100 : 100;
    const cap = goals?.max_trade_pct ?? 25;
    if (pct > cap && input.over_limit_ok !== true) {
      return { error: 'over_max_per_trade', trade_pct_of_portfolio: +pct.toFixed(1), max_trade_pct: cap, max_sol: solPx ? +((cap / 100) * book.total_usd / solPx).toFixed(4) : null };
    }
    sol_amount = +amt.toFixed(6); usd_value = amt * solPx;
  } else {
    const pct = Number(input.sell_pct);
    if (!(pct > 0 && pct <= 100)) return { error: 'sell_pct_required' };
    if (!book.holdings.some((h) => h.mint === mint)) return { error: 'not_held', note: "The user doesn't hold this token (or it's dust)." };
    sell_pct = +pct.toFixed(2);
    usd_value = (book.holdings.find((h) => h.mint === mint)?.value_usd ?? 0) * (pct / 100);
  }

  // Every Approve card carries SI's check of this exact trade.
  const chk = await checkTrade(db, book, goals, { side, mint, sol_amount: sol_amount ?? undefined, sell_pct: sell_pct ?? undefined }).catch(() => null);
  const card = chk && !('error' in chk) ? tradeCard(chk.token, chk.trade) : null;

  const { data, error } = await db.from('si_proposals')
    .insert({ profile_id: me.id, side, mint, sym: t.sym, sol_amount, sell_pct, reason })
    .select('id, expires_at').single();
  if (error || !data) return { error: 'could_not_save' };
  const p: Proposal = { id: data.id, side, mint, sym: t.sym, sol_amount, sell_pct, reason, expires_at: data.expires_at, check: card };
  tb.proposals.push(p);
  return { proposal_id: p.id, status: 'waiting_for_user_approval', side, symbol: t.sym, sol_amount, sell_pct, usd_value: +usd_value.toFixed(2), pct_of_portfolio: book.total_usd ? +((usd_value / book.total_usd) * 100).toFixed(1) : null, check: card ? { label: card.label, score: card.score, est_price_impact_pct: card.est_price_impact_pct, signals: card.signals } : null, expires_in_minutes: 10 };
}
