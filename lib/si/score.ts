/* ---------- SI cross-check scoring ----------
   Pure and deterministic: the same facts always give the same verdict, so it can be unit-tested and the
   model can't talk a red flag away. The model's job is to explain the verdict, not to invent one. */

export type Level = 'red' | 'yellow' | 'green';
export type Signal = { level: Level; key: string; text: string };
export type Verdict = { score: number; label: 'High risk' | 'Caution' | 'Looks healthy'; signals: Signal[] };

export type TokenFacts = {
  symbol: string; mc: number | null; liq: number | null; age_h: number | null; verified: boolean | null; organic: number | null;
  mint_off: boolean | null; freeze_off: boolean | null; suspicious: boolean;
  top10_ex_pools_pct: number | null; dev_pct: number | null; bundle_pct: number | null; dex_paid: boolean | null;
  same_symbol_count: number; is_og: boolean | null;
  chg_h1: number | null; buys_24h: number | null; sells_24h: number | null;
  callit_calls: number; best_caller: { handle: string; calls: number; held_2x: number } | null;
};

const pct = (n: number) => `${n >= 10 ? n.toFixed(0) : n.toFixed(1)}%`;
const usd = (v: number) => '$' + (v >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(0));

export function scoreToken(f: TokenFacts): Verdict {
  const s: Signal[] = [];
  const add = (level: Level, key: string, text: string) => s.push({ level, key, text });
  const liqRatio = f.liq != null && f.mc ? f.liq / f.mc : null;

  // Hard red flags
  if (f.mint_off === false) add('red', 'mint', 'Mint authority is on: the team can print more tokens.');
  if (f.freeze_off === false) add('red', 'freeze', 'Freeze authority is on: your tokens can be frozen.');
  if (f.suspicious) add('red', 'sus', 'Flagged suspicious by Jupiter.');
  if (f.is_og === false && f.same_symbol_count > 0) add('red', 'copycat', `Copycat: an older $${f.symbol} with more liquidity exists. Check you have the right contract.`);
  if (f.bundle_pct != null && f.bundle_pct >= 25) add('red', 'bundle', `${pct(f.bundle_pct)} of supply was bundled at launch.`);
  else if (f.bundle_pct != null && f.bundle_pct >= 10) add('yellow', 'bundle', `${pct(f.bundle_pct)} of supply was bundled at launch.`);
  if (f.dev_pct != null && f.dev_pct >= 10) add('red', 'dev', `Dev wallet holds ${pct(f.dev_pct)}.`);
  if (f.top10_ex_pools_pct != null) {
    if (f.top10_ex_pools_pct >= 50) add('red', 'top10', `Top 10 wallets (not counting pools) hold ${pct(f.top10_ex_pools_pct)}.`);
    else if (f.top10_ex_pools_pct >= 30) add('yellow', 'top10', `Top 10 wallets hold ${pct(f.top10_ex_pools_pct)}.`);
    else add('green', 'top10', `Spread out: top 10 wallets hold ${pct(f.top10_ex_pools_pct)}.`);
  }
  if (f.liq != null && f.liq >= 1_000_000) add('green', 'liq', `Deep liquidity: ${usd(f.liq)}.`);
  else if (liqRatio != null && f.liq != null) {
    if (liqRatio < 0.03) add('red', 'liq', `Thin liquidity: ${usd(f.liq)} behind a ${usd(f.mc!)} market cap. Selling size will hurt.`);
    else if (liqRatio < 0.08) add('yellow', 'liq', `Liquidity is ${usd(f.liq)} against a ${usd(f.mc!)} market cap.`);
    else add('green', 'liq', `Healthy liquidity: ${usd(f.liq)}.`);
  }
  if (f.chg_h1 != null && f.chg_h1 <= -40) add('red', 'dump', `Down ${pct(Math.abs(f.chg_h1))} in the last hour.`);
  // Softer
  if (f.age_h != null && f.age_h < 1) add('yellow', 'age', 'Under an hour old.');
  else if (f.age_h != null && f.age_h < 24) add('yellow', 'age', 'Under a day old.');
  if (f.verified === false) add('yellow', 'unverified', 'Not verified on Jupiter.');
  if (f.organic != null && f.organic < 30) add('yellow', 'organic', 'Low organic activity: a lot of the volume looks like bots.');
  if (f.buys_24h && f.sells_24h && f.sells_24h > f.buys_24h * 1.5) add('yellow', 'sellers', `Sellers outnumber buyers ${(f.sells_24h / f.buys_24h).toFixed(1)} to 1 over 24h.`);
  if (f.chg_h1 != null && f.chg_h1 >= 100) add('yellow', 'chase', `Up ${pct(f.chg_h1)} in an hour: late entries carry the most risk.`);
  // Good signs
  if (f.mint_off === true && f.freeze_off === true) add('green', 'auth', 'Mint and freeze authority are off.');
  if (f.verified) add('green', 'verified', 'Verified on Jupiter.');
  if (f.is_og === true && f.same_symbol_count > 0) add('green', 'og', `This is the original $${f.symbol}; ${f.same_symbol_count} copycat${f.same_symbol_count === 1 ? '' : 's'} exist.`);
  if (f.dex_paid) add('green', 'dexpaid', 'Dex paid: the team paid for a DexScreener profile.');
  if (f.best_caller && f.best_caller.calls >= 5 && f.best_caller.held_2x / f.best_caller.calls >= 0.5) add('green', 'caller', `Called on Callit by @${f.best_caller.handle} (${f.best_caller.held_2x} of ${f.best_caller.calls} calls held 2X).`);

  const reds = s.filter((x) => x.level === 'red').length, yellows = s.filter((x) => x.level === 'yellow').length, greens = s.filter((x) => x.level === 'green').length;
  let score = Math.max(0, Math.min(100, 70 - reds * 25 - yellows * 7 + greens * 4));
  // Some flags are deal-breakers on their own, whatever else looks good.
  if (s.some((x) => x.level === 'red' && ['mint', 'freeze', 'copycat', 'sus'].includes(x.key))) score = Math.min(score, 35);
  const label = score >= 70 ? 'Looks healthy' : score >= 40 ? 'Caution' : 'High risk';
  const order: Record<Level, number> = { red: 0, yellow: 1, green: 2 };
  return { score, label, signals: s.sort((a, b) => order[a.level] - order[b.level]) };
}

export type TradeFacts = {
  side: 'buy' | 'sell'; usd: number; liq: number | null; portfolio_usd: number; max_trade_pct: number | null;
  weight_after_pct: number | null; sol_left: number | null; risk: 'careful' | 'balanced' | 'degen' | null;
  token_label: Verdict['label']; unrealized_pnl_pct: number | null;
};

/** How this specific trade fits: size vs liquidity, vs their limit and goals, and what's left after. */
export function scoreTrade(f: TradeFacts): { est_price_impact_pct: number | null; signals: Signal[] } {
  const s: Signal[] = [];
  const add = (level: Level, key: string, text: string) => s.push({ level, key, text });
  // Constant-product estimate: price impact ≈ trade size ÷ the quote side of the pool (about half of liquidity).
  const impact = f.liq ? Math.min(99, (f.usd / (f.liq / 2)) * 100) : null;
  if (impact != null) {
    if (impact >= 10) add('red', 'impact', `This size would move the price about ${impact.toFixed(0)}%. Split it up or go smaller.`);
    else if (impact >= 3) add('yellow', 'impact', `Expect roughly ${impact.toFixed(1)}% price impact.`);
    else add('green', 'impact', `Small for this pool: about ${impact.toFixed(1)}% price impact.`);
  }
  const share = f.portfolio_usd ? (f.usd / f.portfolio_usd) * 100 : null;
  if (f.side === 'buy' && share != null && f.max_trade_pct != null) {
    if (share > f.max_trade_pct) add('red', 'limit', `It's ${share.toFixed(1)}% of your wallet, over your ${f.max_trade_pct}% max per trade.`);
    else add('green', 'limit', `It's ${share.toFixed(1)}% of your wallet, inside your ${f.max_trade_pct}% max.`);
  }
  if (f.side === 'buy' && f.weight_after_pct != null && f.weight_after_pct >= 40) add('yellow', 'weight', `After this, the token would be ${f.weight_after_pct.toFixed(0)}% of your wallet.`);
  if (f.side === 'buy' && f.sol_left != null && f.sol_left < 0.02) add('red', 'gas', 'This leaves almost no SOL for network fees.');
  if (f.side === 'buy' && f.risk === 'careful' && f.token_label === 'High risk') add('red', 'fit', 'This token is high risk and your setup is careful.');
  if (f.side === 'sell' && f.unrealized_pnl_pct != null) add(f.unrealized_pnl_pct >= 0 ? 'green' : 'yellow', 'pnl', f.unrealized_pnl_pct >= 0 ? `You'd lock in about +${f.unrealized_pnl_pct.toFixed(0)}% on what you sell.` : `You'd realize about ${f.unrealized_pnl_pct.toFixed(0)}% on what you sell.`);
  return { est_price_impact_pct: impact != null ? +impact.toFixed(2) : null, signals: s };
}
