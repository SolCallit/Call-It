/**
 * Private Withdraw settings (Privacy Cash, mainnet only).
 *
 * NEXT_PUBLIC_PRIVATE_WITHDRAW   off (default) | on   ("mainnet" also means on)
 *
 * Privacy Cash has no devnet, so test with small amounts. Keep it off in Production until tested.
 */

export type PrivateToken = { sym: string; mint: string; decimals: number; native?: boolean; min: number };

const RAW = (process.env.NEXT_PUBLIC_PRIVATE_WITHDRAW || '').trim().toLowerCase();
export const PRIVATE_ON = RAW === 'on' || RAW === 'mainnet' || RAW === '1' || RAW === 'true';

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
