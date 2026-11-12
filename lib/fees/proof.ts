import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Proof that a trade actually carried Callit's Jupiter referral fee.
 * The order route tags an order that was built with the fee; the execute route swaps that tag for
 * a proof bound to the landed signature. Fees, earnings and cashback are only booked with a valid
 * proof, so nothing is credited for a fee that was never collected. A browser can drop the proof
 * (and lose its own cashback) but can't forge one.
 */
const key = () => process.env.PRIVY_APP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const mac = (s: string) => createHmac('sha256', key()).update(s).digest('base64url');
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const orderTag = (requestId: string) => (key() ? mac(`fee-order:${requestId}`) : '');
export const orderTagOk = (requestId: string, tag: unknown) => typeof tag === 'string' && !!key() && same(tag, mac(`fee-order:${requestId}`));
export const feeProof = (signature: string) => (key() ? mac(`fee-tx:${signature}`) : '');
export const feeProofOk = (signature: string, proof: unknown) => typeof proof === 'string' && !!key() && same(proof, mac(`fee-tx:${signature}`));
