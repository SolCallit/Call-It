import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { rpc, SOL_MINT, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '@/lib/solana/rpc';
import { jupMany, type LiveToken } from '@/lib/market/sources';

/* ---------- The user's book, as the advisor sees it ----------
   Live on-chain balances, priced by Jupiter, with cost basis from the trades the user made through Callit
   (average-cost method) and risk flags per holding. Everything here is fact the model can quote; it never
   has to guess a number. */

const STABLES = new Set(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);
const DUST_USD = 0.5;

export type RiskFlag =
  | 'mint_authority_on' | 'freeze_authority_on' | 'top10_hold_over_50pct' | 'dev_holds_over_10pct'
  | 'thin_liquidity' | 'unverified' | 'low_organic_activity' | 'under_24h_old' | 'flagged_suspicious';

export type Holding = {
  mint: string; symbol: string; name: string; amount: number; price_usd: number | null; value_usd: number;
  weight_pct: number; change_pct: { h1: number | null; h24: number | null };
  market_cap_usd: number | null; liquidity_usd: number | null;
  cost_basis_usd: number | null; avg_entry_mc_usd: number | null;
  unrealized_pnl_usd: number | null; unrealized_pnl_pct: number | null;
  risk_flags: RiskFlag[];
};

export type Portfolio = {
  wallet: string; as_of: string; total_usd: number;
  sol: { amount: number; value_usd: number; price_usd: number }; stables_usd: number;
  holdings: Holding[]; dust_count: number; unpriced_count: number;
  concentration: { top_holding_pct: number; top3_pct: number; hhi: number };
  realized_pnl_30d_usd: number | null;
};

type Parsed = { account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } } } } };

/** On-chain balances: SOL plus every SPL / Token-2022 mint above zero. */
export async function balances(owner: string): Promise<{ sol: number; tokens: Map<string, number> }> {
  const opts = { encoding: 'jsonParsed', commitment: 'confirmed' };
  const [bal, a, b] = await Promise.all([
    rpc<{ value: number }>('getBalance', [owner, { commitment: 'confirmed' }]),
    rpc<{ value: Parsed[] }>('getTokenAccountsByOwner', [owner, { programId: TOKEN_PROGRAM }, opts]),
    rpc<{ value: Parsed[] }>('getTokenAccountsByOwner', [owner, { programId: TOKEN_2022_PROGRAM }, opts]),
  ]);
  const tokens = new Map<string, number>();
  for (const acc of [...a.value, ...b.value]) {
    const info = acc.account?.data?.parsed?.info;
    if (!info?.mint || !info.tokenAmount) continue;
    const ui = Number(info.tokenAmount.amount || 0) / 10 ** info.tokenAmount.decimals;
    if (ui > 0) tokens.set(info.mint, (tokens.get(info.mint) || 0) + ui);
  }
  return { sol: bal.value / 1e9, tokens };
}

export function riskFlags(t: LiveToken): RiskFlag[] {
  const f: RiskFlag[] = [];
  if (t.audit.mintOff === false) f.push('mint_authority_on');
  if (t.audit.freezeOff === false) f.push('freeze_authority_on');
  if ((t.audit.top10 ?? 0) > 50) f.push('top10_hold_over_50pct');
  if ((t.audit.dev ?? 0) > 10) f.push('dev_holds_over_10pct');
  if (t.liq != null && t.mc && t.liq / t.mc < 0.05) f.push('thin_liquidity');
  if (!t.verified) f.push('unverified');
  if (t.organic != null && t.organic < 30) f.push('low_organic_activity');
  if (t.createdAt && Date.now() - Date.parse(t.createdAt) < 864e5) f.push('under_24h_old');
  if (t.audit.sus) f.push('flagged_suspicious');
  return f;
}

type Tx = { kind: string; in_mint: string | null; in_amount: number | null; out_mint: string | null; out_amount: number | null; usd_value: number | null; created_at: string };

/** Average-cost basis per mint from the user's Callit trades, plus realized PnL over the last 30 days. */
export function costBasis(txs: Tx[]): { basis: Map<string, { qty: number; cost: number }>; realized30: number | null } {
  const basis = new Map<string, { qty: number; cost: number }>();
  const cut = Date.now() - 30 * 864e5;
  let realized = 0, any = false;
  for (const t of [...txs].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    const usd = Number(t.usd_value) || 0;
    if (!usd) continue;
    // Acquired `out` for $usd
    if (t.out_mint && t.out_mint !== SOL_MINT && !STABLES.has(t.out_mint) && Number(t.out_amount) > 0) {
      const p = basis.get(t.out_mint) || { qty: 0, cost: 0 };
      p.qty += Number(t.out_amount); p.cost += usd; basis.set(t.out_mint, p);
    }
    // Disposed of `in` for $usd
    if (t.in_mint && t.in_mint !== SOL_MINT && !STABLES.has(t.in_mint) && Number(t.in_amount) > 0) {
      const p = basis.get(t.in_mint);
      if (p && p.qty > 0) {
        const q = Math.min(p.qty, Number(t.in_amount)), avg = p.cost / p.qty;
        if (Date.parse(t.created_at) >= cut) { realized += usd * (q / Number(t.in_amount)) - avg * q; any = true; }
        p.qty -= q; p.cost -= avg * q;
        if (p.qty <= 1e-12) basis.delete(t.in_mint);
      }
    }
  }
  return { basis, realized30: any ? +realized.toFixed(2) : null };
}

const r2 = (n: number) => +n.toFixed(2);

export async function buildPortfolio(db: SupabaseClient, profileId: string, wallet: string): Promise<Portfolio> {
  const [{ sol, tokens }, txq] = await Promise.all([
    balances(wallet),
    db.from('transactions').select('kind, in_mint, in_amount, out_mint, out_amount, usd_value, created_at')
      .eq('profile_id', profileId).in('kind', ['buy', 'sell', 'swap']).eq('verified', true)
      .order('created_at', { ascending: false }).limit(2000),
  ]);
  const mints = [...tokens.keys()].slice(0, 150);
  const priced = new Map<string, LiveToken>();
  const all = [SOL_MINT, ...mints];
  const chunks: string[][] = [];
  for (let i = 0; i < all.length; i += 50) chunks.push(all.slice(i, i + 50));
  (await Promise.all(chunks.map((c) => jupMany(c).catch(() => [] as LiveToken[])))).flat().forEach((t) => priced.set(t.mint, t));
  const solPx = priced.get(SOL_MINT)?.price ?? 0;
  const { basis, realized30 } = costBasis((txq.data || []) as Tx[]);

  let stables = 0, dust = 0, unpriced = 0;
  const raw: Omit<Holding, 'weight_pct'>[] = [];
  for (const [mint, amount] of tokens) {
    const t = priced.get(mint);
    if (STABLES.has(mint)) { stables += amount; continue; }
    if (!t?.price) { unpriced++; continue; }
    const value = amount * t.price;
    if (value < DUST_USD) { dust++; continue; }
    const b = basis.get(mint);
    // Basis covers only what was bought through Callit; scale it to what's actually held.
    const coverage = b && b.qty > 0 ? Math.min(1, b.qty / amount) : 0;
    const cost = b && coverage > 0.5 ? (b.cost / b.qty) * amount : null;
    raw.push({
      mint, symbol: t.sym, name: t.name, amount, price_usd: t.price, value_usd: r2(value),
      change_pct: { h1: t.chg.h1, h24: t.chg.h24 }, market_cap_usd: t.mc, liquidity_usd: t.liq,
      cost_basis_usd: cost != null ? r2(cost) : null,
      avg_entry_mc_usd: cost != null && t.mc ? r2((cost / value) * t.mc) : null,
      unrealized_pnl_usd: cost != null ? r2(value - cost) : null,
      unrealized_pnl_pct: cost ? r2((value / cost - 1) * 100) : null,
      risk_flags: riskFlags(t),
    });
  }
  const solUsd = sol * solPx;
  const total = solUsd + stables + raw.reduce((a, h) => a + h.value_usd, 0);
  const holdings: Holding[] = raw.sort((a, b) => b.value_usd - a.value_usd)
    .map((h) => ({ ...h, weight_pct: total ? r2((h.value_usd / total) * 100) : 0 }));
  const w = [solUsd, stables, ...holdings.map((h) => h.value_usd)].map((v) => (total ? v / total : 0)).sort((a, b) => b - a);
  return {
    wallet, as_of: new Date().toISOString(), total_usd: r2(total),
    sol: { amount: +sol.toFixed(4), value_usd: r2(solUsd), price_usd: r2(solPx) }, stables_usd: r2(stables),
    holdings: holdings.slice(0, 25), dust_count: dust, unpriced_count: unpriced,
    concentration: {
      top_holding_pct: holdings[0]?.weight_pct ?? 0,
      top3_pct: r2(holdings.slice(0, 3).reduce((a, h) => a + h.weight_pct, 0)),
      hhi: Math.round(w.reduce((a, x) => a + x * x, 0) * 10_000), // 10,000 = everything in one asset
    },
    realized_pnl_30d_usd: realized30,
  };
}
