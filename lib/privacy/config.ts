/**
 * Private Withdraw settings. The feature runs on its own network so it can be tested on
 * devnet while the rest of Callit (swaps, balances, market data) stays on mainnet.
 *
 * NEXT_PUBLIC_PRIVATE_WITHDRAW   off (default) | devnet | mainnet
 * NEXT_PUBLIC_PRIVATE_RPC_URL    optional HTTP RPC for that network (defaults to the public one)
 * NEXT_PUBLIC_PRIVATE_WS_URL     optional WebSocket RPC (defaults to the HTTP URL with ws/wss)
 *
 * These are read in the browser, so never put a paid RPC key here unless it's domain-locked.
 */

export type PrivateNet = 'devnet' | 'mainnet';

export type PrivateToken = { sym: string; mint: string; decimals: number; native?: boolean };

const RAW = (process.env.NEXT_PUBLIC_PRIVATE_WITHDRAW || '').trim().toLowerCase();

export const PRIVATE_NET: PrivateNet | null = RAW === 'devnet' || RAW === 'mainnet' ? RAW : null;

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

const TOKENS: Record<PrivateNet, PrivateToken[]> = {
  mainnet: [
    { sym: 'SOL', mint: WSOL_MINT, decimals: 9, native: true },
    { sym: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
    { sym: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  ],
  // Umbra's devnet pools. dUSDC / dUSDT are Umbra's test mints, not Circle's devnet USDC.
  devnet: [
    { sym: 'SOL', mint: WSOL_MINT, decimals: 9, native: true },
    { sym: 'dUSDC', mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7', decimals: 6 },
    { sym: 'dUSDT', mint: 'DXQwBNGgyQ2BzGWxEriJPVmXYFQBsQbXvfvfSNTaJkL6', decimals: 6 },
  ],
};

const ENDPOINTS: Record<PrivateNet, { rpc: string; indexer: string; relayer: string }> = {
  mainnet: {
    rpc: 'https://api.mainnet-beta.solana.com',
    indexer: 'https://utxo-indexer.api.umbraprivacy.com',
    relayer: 'https://relayer.api.umbraprivacy.com',
  },
  devnet: {
    rpc: 'https://api.devnet.solana.com',
    indexer: 'https://utxo-indexer.api-devnet.umbraprivacy.com',
    relayer: 'https://relayer.api-devnet.umbraprivacy.com',
  },
};

export function privateConfig() {
  if (!PRIVATE_NET) return null;
  const e = ENDPOINTS[PRIVATE_NET];
  const custom = (process.env.NEXT_PUBLIC_PRIVATE_RPC_URL || '').trim();
  // Without a custom RPC, HTTP calls go through Callit's /api/umbra/rpc (server-side Helius key);
  // WebSocket subscriptions can't be proxied on Vercel, so they use the public endpoint.
  const rpc = custom || (typeof window !== 'undefined' ? `${window.location.origin}/api/umbra/rpc` : e.rpc);
  const ws = (process.env.NEXT_PUBLIC_PRIVATE_WS_URL || '').trim() || (custom || e.rpc).replace(/^http/, 'ws');
  return {
    network: PRIVATE_NET,
    rpc,
    ws,
    indexer: e.indexer,
    relayer: e.relayer,
    tokens: TOKENS[PRIVATE_NET],
    explorer: (sig: string) => `https://solscan.io/tx/${sig}${PRIVATE_NET === 'devnet' ? '?cluster=devnet' : ''}`,
  };
}

export type PrivateConfig = NonNullable<ReturnType<typeof privateConfig>>;
