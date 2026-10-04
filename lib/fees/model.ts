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
  { key: 'caller',   label: 'Callers',           call: 20, buy: 0,  sell: 0,  note: 'Buys from a bought-in call. 20% base, up to 30% by X reached' },
  { key: 'referrer', label: 'Referrals',         call: 10, buy: 10, sell: 0,  note: 'Whoever invited the buyer' },
  { key: 'cashback', label: 'Trader cashback',   call: 5,  buy: 5,  sell: 0,  note: 'Back to the buyer' },
  { key: 'buyback',  label: 'Buyback & burn',    call: 15, buy: 20, sell: 30, note: '$CALLIT bought and burned after launch' },
  { key: 'treasury', label: 'Treasury & growth', call: 50, buy: 65, sell: 70, note: 'Team, infra, product expansion' },
];

/** Caller share grows 2.5 points per doubling of the X reached while still holding, capped at 30%. */
export const CALLER_BASE = 20, CALLER_STEP = 2.5, CALLER_CAP = 30;
export function callerShare(xReached: number): number {
  if (!(xReached >= 2)) return CALLER_BASE;
  return Math.min(CALLER_CAP, CALLER_BASE + CALLER_STEP * Math.floor(Math.log2(xReached)));
}

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
