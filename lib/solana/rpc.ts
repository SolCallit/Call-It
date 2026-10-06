import 'server-only';

/**
 * Solana mainnet RPC for wallet features (balances, transfers, broadcasting).
 * Priority: SOLANA_RPC_URL > Helius (HELIUS_API_KEY) > public mainnet endpoint.
 * Swaps go through Jupiter and don't use this.
 */
/** The Helius key, even if someone pasted the whole RPC URL or added spaces/quotes. */
export function heliusKey(): string {
  let k = (process.env.HELIUS_API_KEY || '').trim().replace(/^["']|["']$/g, '');
  const m = k.match(/api-key=([A-Za-z0-9-]+)/);
  if (m) k = m[1];
  return /^[A-Za-z0-9-]{20,}$/.test(k) ? k : '';
}

const PUBLIC_RPC = 'https://api.mainnet-beta.solana.com';

export function rpcUrl(): string {
  const custom = (process.env.SOLANA_RPC_URL || '').trim();
  if (custom) return custom;
  const k = heliusKey();
  return k ? `https://mainnet.helius-rpc.com/?api-key=${k}` : PUBLIC_RPC;
}

export class RpcError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
  }
}

async function call<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const r = await fetch(url, {
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

/** JSON-RPC call. If the configured RPC is down or rejects the key (HTTP error), retries on the public endpoint. */
export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const url = rpcUrl();
  try {
    return await call<T>(url, method, params);
  } catch (e) {
    const httpFail = e instanceof RpcError && /^rpc_http_/.test(e.message);
    const netFail = !(e instanceof RpcError);
    if (url !== PUBLIC_RPC && (httpFail || netFail)) {
      console.warn('[rpc] primary RPC failed, using public endpoint:', (e as Error).message);
      return call<T>(PUBLIC_RPC, method, params);
    }
    throw e;
  }
}

export const isAddress = (s: unknown): s is string => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
