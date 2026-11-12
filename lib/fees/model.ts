/**
 * Callit fee model (tune before $CALLIT launches).
 *
 * The swap fee is Jupiter's referral fee: it lands in Callit's referral account and
 * Jupiter keeps 20% of it. Callit's 80% is then split into buckets by trade type:
 *  - call: a BUY that came from a call's Buy button, where the caller bought in
 *  - buy:  any other buy
 *  - sell: every sell. Sell fees never go to callers, referrers or cashback.
 * Shares are percentages of Callit's 80%; each column adds up to 100.
 */
export const FEE_BPS_STANDARD = 100; // 1.00%
export const FEE_BPS_PREMIUM = 75;   // 0.75% for Premium / $CALLIT stakers (later)
export const JUP_CUT = 0.2;          // Jupiter keeps 20% of referral fees

export type Bucket = 'caller' | 'referrer' | 'cashback' | 'buyback' | 'treasury';
export type Mode = 'call' | 'buy' | 'sell';

export const BUCKETS: { key: Bucket; label: string; call: number; buy: number; sell: number; note: string }[] = [
  { key: 'caller',   label: 'Callers',           call: 20, buy: 0,  sell: 0,  note: 'Buys from a call, once it holds 2X. Bought in: 20% up to 30%. No buy: 5%' },
  { key: 'referrer', label: 'Referrals',         call: 10, buy: 10, sell: 0,  note: 'Whoever invited the buyer' },
  { key: 'cashback', label: 'Trader cashback',   call: 10, buy: 10, sell: 0,  note: 'Back to the buyer, claimable once they have enough points' },
  { key: 'buyback',  label: 'Buyback & burn',    call: 15, buy: 20, sell: 30, note: '$CALLIT bought and burned after launch' },
  { key: 'treasury', label: 'Treasury & growth', call: 45, buy: 60, sell: 70, note: 'Team, infra, product expansion' },
];

/**
 * Caller pay. Nothing is paid until the call holds 2X on its rolling-average MC (a wick doesn't count).
 * - Bought in and held to target: 20% base, +2.5 points per doubling reached, capped at 30%.
 * - Didn't buy, or sold before the target: a flat 5%.
 * Whatever a caller doesn't take stays in Treasury & growth.
 */
export const CALLER_MIN_X = 2;
export const CALLER_BASE = 20, CALLER_STEP = 2.5, CALLER_CAP = 30;
export const CALLER_NOBUY = 5;
export function callerShare(xReached: number, boughtIn = true): number {
  if (!(xReached >= CALLER_MIN_X)) return 0;
  if (!boughtIn) return CALLER_NOBUY;
  return Math.min(CALLER_CAP, CALLER_BASE + CALLER_STEP * Math.floor(Math.log2(xReached)));
}

/** Buyer cashback: % of Callit's fee (after Jupiter's cut) on every buy, paid once the buyer has CASHBACK_MIN_POINTS. */
export const CASHBACK_PCT = BUCKETS.find((b) => b.key === 'cashback')!.buy;
// 1,000 points = $1,000 traded at 10 pts per $10 (was 100 at the old 1-per-$10 rate: same unlock, new scale).
export const cashbackMinPoints = () => num(process.env.CASHBACK_MIN_POINTS, 1000);

/**
 * Points (server side, from verified facts only, so they can back real rewards):
 * - trading: 10 points for every $10 of verified volume through Callit (buys and sells), up to 10,000 per trade
 * - a call that holds 2X: +50 · a call that hits the caller's target: +100
 * Fees make wash trading cost more than it earns back (cashback is a slice of the fee you paid).
 */
export const POINTS = { perUsd: 1, perTradeCap: 10000, qualified: 50, target: 100 };

/** Points for a piece of tester feedback an admin marks as valid (FEEDBACK_POINTS, default 25). One award per report. */
export const feedbackPoints = () => Math.max(0, Math.round(num(process.env.FEEDBACK_POINTS, 25)));

/**
 * Milestone points: a call earns each tier once, as its rolling-average X (peak_x, wick-proof) climbs.
 * Money share stays capped (CALLER_CAP); runners are rewarded in points instead. Points convert from a
 * fixed season pool, so a 10,000X call takes a bigger slice of that pool but never costs Callit more.
 * 2X is POINTS.qualified above. Totals: 10X = 500, 100X = 5,750, 1,000X = 40,750, 10,000X = 140,750.
 * Tiers from 25X up also need the token's rolling-average MC to reach MOONSHOT_MIN_MC, so a caller
 * can't farm them by pumping a dust-cap token they launched.
 */
export const MILESTONES: { x: number; pts: number }[] = [
  { x: 5, pts: 150 },
  { x: 10, pts: 300 },
  { x: 25, pts: 750 },
  { x: 50, pts: 1500 },
  { x: 100, pts: 3000 },
  { x: 500, pts: 10000 },
  { x: 1000, pts: 25000 },
  { x: 10000, pts: 100000 },
];
export const MOONSHOT_FROM_X = 25;
export const moonshotMinMc = () => num(process.env.MOONSHOT_MIN_MC, 250_000);

/** Claim limits (USD). Payouts stay off until PAYOUTS_ON=1 and a payout wallet is set. */
export const PAYOUT = {
  minUsd: () => num(process.env.PAYOUT_MIN_USD, 1),
  // Brakes so one bug or one abuser can never empty the payout wallet. Bigger balances still get paid,
  // just over several claims/days. Override in Vercel env if needed.
  maxPerClaimUsd: () => num(process.env.PAYOUT_MAX_CLAIM_USD, 100),       // one claim
  userDailyCapUsd: () => num(process.env.PAYOUT_USER_DAILY_CAP_USD, 200), // one user, rolling 24h
  dailyCapUsd: () => num(process.env.PAYOUT_DAILY_CAP_USD, 3000),         // everyone, rolling 24h
};
const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

/** Splits Callit's fee (after Jupiter's cut) into buckets. */
export function split(feeUsd: number, mode: Mode): Record<Bucket, number> {
  const out = {} as Record<Bucket, number>;
  for (const b of BUCKETS) out[b.key] = (feeUsd * b[mode]) / 100;
  return out;
}

/** The fee rate Callit is actually charging right now (0 until the Jupiter referral account is set). */
export function liveFeeBps(): number {
  const bps = Number(process.env.JUPITER_REFERRAL_FEE_BPS);
  return process.env.JUPITER_REFERRAL_ACCOUNT && Number.isFinite(bps) && bps > 0 ? bps : 0;
}
