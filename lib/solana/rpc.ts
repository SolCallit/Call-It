import 'server-only';

/**
 * Solana mainnet RPC for wallet features (balances, transfers, broadcasting).
 * Priority: SOLANA_RPC_URL > Helius (HELIUS_API_KEY) > public mainnet endpoint.
 * Swaps go through Jupiter and don't use this.
 */
export function rpcUrl(): string {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;
  const helius = process.env.HELIUS_API_KEY;
  return helius ? `https://mainnet.helius-rpc.com/?api-key=${helius}` : 'https://api.mainnet-beta.solana.com';
}

export class RpcError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
  }
}

export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(rpcUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
  });
  if (!r.ok) throw new RpcError(`rpc_http_${r.status}`);
  const j = (await r.json()) as { result?: T; error?: { message: string; code?: number } };
  if (j.error) throw new RpcError(j.error.message || 'rpc_error', j.error.code);
  return j.result as T;
}

export const isAddress = (s: unknown): s is string => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
