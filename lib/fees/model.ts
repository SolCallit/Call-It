/**
 * Callit fee model (proposal, tune before $CALLIT launches).
 *
 * The swap fee is charged through Jupiter's referral fee and lands in Callit's
 * referral account. Callit then splits its share into buckets. Two cases:
 *  - viaCall: the trade came from a call's Buy button and the caller bought in.
 *  - direct:  any other trade.
 * Shares are percentages of Callit's fee and each column must add up to 100.
 */
export const FEE_BPS_STANDARD = 100; // 1.00%
export const FEE_BPS_PREMIUM = 75;   // 0.75% for Premium / $CALLIT stakers (later)

export type Bucket = 'caller' | 'referrer' | 'cashback' | 'buyback' | 'treasury';

export const BUCKETS: { key: Bucket; label: string; viaCall: number; direct: number; note: string }[] = [
  { key: 'caller',   label: 'Callers',            viaCall: 30, direct: 0,  note: 'Bought-in caller whose call the trade came from' },
  { key: 'referrer', label: 'Referrals',          viaCall: 10, direct: 10, note: 'Whoever invited the trader' },
  { key: 'cashback', label: 'Trader cashback',    viaCall: 5,  direct: 5,  note: 'Back to the person who traded' },
  { key: 'buyback',  label: 'Buyback & burn',     viaCall: 15, direct: 20, note: '$CALLIT bought and burned after launch' },
  { key: 'treasury', label: 'Treasury & growth',  viaCall: 40, direct: 65, note: 'Team, infra, product expansion' },
];

/** Splits a fee amount into buckets. */
export function split(feeUsd: number, viaCall: boolean): Record<Bucket, number> {
  const out = {} as Record<Bucket, number>;
  for (const b of BUCKETS) out[b.key] = (feeUsd * (viaCall ? b.viaCall : b.direct)) / 100;
  return out;
}

/** The fee rate Callit is actually charging right now (0 until the Jupiter referral account is set). */
export function liveFeeBps(): number {
  const bps = Number(process.env.JUPITER_REFERRAL_FEE_BPS);
  return process.env.JUPITER_REFERRAL_ACCOUNT && Number.isFinite(bps) && bps > 0 ? bps : 0;
}
