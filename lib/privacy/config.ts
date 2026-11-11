/**
 * Private Withdraw settings (Privacy Cash, mainnet only).
 *
 * NEXT_PUBLIC_PRIVATE_WITHDRAW   off (default, shows "coming soon") | beta (allowlisted wallets) | on
 *
 * Privacy Cash has no devnet, so test with small amounts. Keep it off in Production until tested.
 */

export type PrivateToken = { sym: string; mint: string; decimals: number; native?: boolean; min: number };

const RAW = (process.env.NEXT_PUBLIC_PRIVATE_WITHDRAW || '').trim().toLowerCase();
export const PRIVATE_ON = RAW === 'on' || RAW === 'mainnet' || RAW === '1' || RAW === 'true';
/** beta: only wallets in PRIVATE_BETA_WALLETS (server env, comma separated) get the Private tab; everyone else sees "coming soon". */
export const PRIVATE_BETA = RAW === 'beta';

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/** Pools Privacy Cash runs that Callit offers. `min` mirrors the relayer's minimum withdrawal. */
export const PRIVATE_TOKENS: PrivateToken[] = [
  { sym: 'SOL', mint: WSOL_MINT, decimals: 9, native: true, min: 0.01 },
  { sym: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, min: 2 },
  { sym: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6, min: 2 },
];

/** Upstream Privacy Cash relayer; the browser reaches it through /api/privacy/relayer. */
export const PC_RELAYER = 'https://api3.privacycash.org';

/** Public WebSocket for confirmations (WebSockets can't go through Vercel functions). */
export const PRIVATE_WS = 'wss://api.mainnet-beta.solana.com';

/*
 * Rail #2: Helius Privacy Rings (Solana Privacy Rings, mainnet). SOL only for now.
 *
 * NEXT_PUBLIC_HELIUS_PRIVACY   off (default) | beta (same allowlist as Privacy Cash beta) | on
 *
 * The SDK is 0.9.0-alpha: names and endpoints can change, so keep this off in
 * Production until a real withdrawal has been tested end to end.
 */
const HRAW = (process.env.NEXT_PUBLIC_HELIUS_PRIVACY || '').trim().toLowerCase();
export const HELIUS_PRIVATE_ON = HRAW === 'on' || HRAW === 'mainnet' || HRAW === '1' || HRAW === 'true';
export const HELIUS_PRIVATE_BETA = HRAW === 'beta';

/** Solana Privacy Rings mainnet deployment: Photon indexer + attested TEE prover (CORS-open, no key). */
export const HELIUS_INDEXER = 'https://dgcj4pjarvo65.cloudfront.net';
export const HELIUS_TEE_PROVER = 'https://d3ky2kt0ntqxt1.cloudfront.net';

/** Smallest private send on the Helius rail, in SOL. */
export const HELIUS_MIN_SOL = 0.001;

/** Show the Private toggle on Swap as "Coming soon" (NEXT_PUBLIC_PRIVATE_SWAP=soon). */
export const PRIVATE_SWAP_SOON = (process.env.NEXT_PUBLIC_PRIVATE_SWAP || '').trim().toLowerCase() === 'soon';
