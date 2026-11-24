import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { liveToken, searchAll, tokenPools, type LiveToken } from '@/lib/market/sources';
import { tokenRisk } from '@/lib/market/risk';
import { scoreToken, scoreTrade, type Verdict, type Signal } from '@/lib/si/score';
import type { Portfolio } from '@/lib/si/portfolio';
import type { Goals } from '@/lib/si/prompt';

/* ---------- SI cross-check ----------
   Real due diligence on a token, or on a specific trade before it happens. Gathers facts from the chain,
   Jupiter/DexScreener, GeckoTerminal and Callit's own calls, scores them deterministically (score.ts), and
   hands the model facts + verdict to explain. Nothing here moves money. */

export type CrossCheck = {
  mint: string; symbol: string; name: string; verdict: Verdict;
  facts: {
    price_usd: number | null; market_cap_usd: number | null; liquidity_usd: number | null; holders: number | null;
    age_hours: number | null; change_pct: LiveToken['chg']; buys_24h: number | null; sells_24h: number | null;
    top10_ex_pools_pct: number | null; dev_pct: number | null; launch_bundle_pct: number | null; dex_paid: boolean | null;
    pools: number; busiest_pool_trades_1h: number | null; launchpad: string | null;
  };
  copycats: { same_symbol: number; this_is_original: boolean | null; original: { mint: string; market_cap_usd: number | null; liquidity_usd: number | null } | null };
  callit: { calls: number; callers: { handle: string; entry_mc_usd: number; since_call_pct: number | null; record: { calls: number; held_2x: number } }[] };
};

const r1 = (n: number) => +n.toFixed(1);

async function callitCalls(db: SupabaseClient, mint: string, mcNow: number | null) {
  const { data } = await db.from('posts').select('profile_id, entry_mc, created_at, profiles!inner(handle)').eq('kind', 'meme').eq('mint', mint)
    .is('deleted_at', null).order('created_at', { ascending: false }).limit(50);
  const rows = (data || []) as unknown as { profile_id: string; entry_mc: number; profiles: { handle: string } }[];
  const ids = [...new Set(rows.map((r) => r.profile_id))].slice(0, 10);
  const rec = new Map<string, { calls: number; held_2x: number }>();
  if (ids.length) {
    const { data: hist } = await db.from('posts').select('profile_id, peak_x').eq('kind', 'meme').is('deleted_at', null).in('profile_id', ids)
      .gte('created_at', new Date(Date.now() - 90 * 864e5).toISOString()).limit(2000);
    for (const h of (hist || []) as { profile_id: string; peak_x: number }[]) {
      const x = rec.get(h.profile_id) || { calls: 0, held_2x: 0 };
      x.calls++; if (Number(h.peak_x) >= 2) x.held_2x++; rec.set(h.profile_id, x);
    }
  }
  const seen = new Set<string>();
  const callers = rows.filter((r) => !seen.has(r.profile_id) && seen.add(r.profile_id)).slice(0, 5).map((r) => ({
    handle: r.profiles.handle, entry_mc_usd: Number(r.entry_mc),
    since_call_pct: mcNow && r.entry_mc ? r1((mcNow / Number(r.entry_mc) - 1) * 100) : null,
    record: rec.get(r.profile_id) || { calls: 0, held_2x: 0 },
  }));
  return { calls: rows.length, callers };
}

export async function crossCheckToken(db: SupabaseClient, mint: string): Promise<CrossCheck | null> {
  const t = await liveToken(mint).catch(() => null);
  if (!t) return null;
  const [risk, pools, same, callit] = await Promise.all([
    tokenRisk(mint).catch(() => null),
    tokenPools(mint).catch(() => []),
    t.sym ? searchAll(t.sym).catch(() => [] as LiveToken[]) : Promise.resolve([] as LiveToken[]),
    callitCalls(db, mint, t.mc),
  ]);
  const nonPool = (risk?.holders || []).filter((h) => h.tag !== 'pool');
  const top10 = nonPool.length ? r1(nonPool.slice(0, 10).reduce((a, h) => a + h.pct, 0)) : t.audit.top10;
  const dev = risk?.holders.find((h) => h.tag === 'dev')?.pct ?? t.audit.dev;
  // Copycats: other tokens with the same ticker. The original is the oldest one with real liquidity.
  const sym = t.sym.toLowerCase();
  const twins = same.filter((x) => x.sym.toLowerCase() === sym && x.mint !== mint);
  const field = [t, ...twins].filter((x) => (x.liq ?? 0) >= 5000 && x.createdAt);
  const og = field.sort((a, b) => Date.parse(a.createdAt!) - Date.parse(b.createdAt!))[0] || null;
  const isOg = twins.length ? (og ? og.mint === mint : null) : null;
  const ageH = t.createdAt ? r1((Date.now() - Date.parse(t.createdAt)) / 36e5) : null;
  const best = [...callit.callers].sort((a, b) => b.record.held_2x - a.record.held_2x)[0];
  const verdict = scoreToken({
    symbol: t.sym, mc: t.mc, liq: t.liq, age_h: ageH, verified: t.verified, organic: t.organic,
    mint_off: t.audit.mintOff, freeze_off: t.audit.freezeOff, suspicious: !!t.audit.sus,
    top10_ex_pools_pct: top10, dev_pct: dev, bundle_pct: risk?.bundle?.pct ?? null, dex_paid: risk?.dexPaid ?? null,
    same_symbol_count: twins.length, is_og: isOg, chg_h1: t.chg.h1, buys_24h: t.buys24, sells_24h: t.sells24,
    callit_calls: callit.calls, best_caller: best ? { handle: best.handle, calls: best.record.calls, held_2x: best.record.held_2x } : null,
  });
  const busiest = [...pools].sort((a, b) => b.tx1 - a.tx1)[0];
  return {
    mint, symbol: t.sym, name: t.name, verdict,
    facts: {
      price_usd: t.price, market_cap_usd: t.mc, liquidity_usd: t.liq, holders: t.holders, age_hours: ageH, change_pct: t.chg,
      buys_24h: t.buys24, sells_24h: t.sells24, top10_ex_pools_pct: top10, dev_pct: dev, launch_bundle_pct: risk?.bundle?.pct != null ? r1(risk.bundle.pct) : null,
      dex_paid: risk?.dexPaid ?? null, pools: pools.length, busiest_pool_trades_1h: busiest ? busiest.tx1 : null, launchpad: t.launchpad,
    },
    copycats: { same_symbol: twins.length, this_is_original: isOg, original: og && og.mint !== mint ? { mint: og.mint, market_cap_usd: og.mc, liquidity_usd: og.liq } : null },
    callit,
  };
}

export type TradeCheck = { token: CrossCheck; trade: { side: 'buy' | 'sell'; usd: number; pct_of_portfolio: number | null; est_price_impact_pct: number | null; signals: Signal[] } };

/** Cross-check one intended trade before it's proposed: the token, plus how this size fits this wallet. */
export async function checkTrade(db: SupabaseClient, book: Portfolio, goals: Goals, i: { side: 'buy' | 'sell'; mint: string; sol_amount?: number; sell_pct?: number }): Promise<TradeCheck | { error: string }> {
  const token = await crossCheckToken(db, i.mint);
  if (!token) return { error: 'token_not_found' };
  const held = book.holdings.find((h) => h.mint === i.mint);
  let usd = 0;
  if (i.side === 'buy') { if (!(Number(i.sol_amount) > 0)) return { error: 'sol_amount_required' }; usd = Number(i.sol_amount) * book.sol.price_usd; }
  else { if (!held) return { error: 'not_held' }; if (!(Number(i.sell_pct) > 0)) return { error: 'sell_pct_required' }; usd = held.value_usd * (Number(i.sell_pct) / 100); }
  const after = i.side === 'buy' && book.total_usd ? (((held?.value_usd ?? 0) + usd) / book.total_usd) * 100 : null;
  const t = scoreTrade({
    side: i.side, usd, liq: token.facts.liquidity_usd, portfolio_usd: book.total_usd, max_trade_pct: goals?.max_trade_pct ?? null,
    weight_after_pct: after, sol_left: i.side === 'buy' ? book.sol.amount - Number(i.sol_amount) : null, risk: goals?.risk ?? null,
    token_label: token.verdict.label, unrealized_pnl_pct: held?.unrealized_pnl_pct ?? null,
  });
  return { token, trade: { side: i.side, usd: +usd.toFixed(2), pct_of_portfolio: book.total_usd ? +((usd / book.total_usd) * 100).toFixed(1) : null, ...t } };
}
