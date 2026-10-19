import { NextRequest, NextResponse } from 'next/server';
import { privateConfig } from '@/lib/privacy/config';
import { burst, clientIp } from '@/lib/ratelimit';
import { rpcUrl } from '@/lib/solana/rpc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Same-origin pass-through to Umbra's indexer and relayer for Private Withdraw.
 * Umbra's APIs don't send CORS headers for Callit's domain, so the browser can't call them
 * directly. This forwards only to those two fixed hosts (never an open proxy), keeps the
 * protobuf body byte-for-byte, and logs nothing about what's requested.
 */
/** JSON-RPC methods the Umbra SDK and the Private tab use. Anything else is refused (keeps our RPC key from being a free-for-all). */
const RPC_METHODS = new Set([
  'getAccountInfo', 'getMultipleAccounts', 'getBalance', 'getTokenAccountBalance', 'getLatestBlockhash', 'getEpochInfo',
  'getSlot', 'getBlockHeight', 'getSignatureStatuses', 'getSignaturesForAddress', 'getTransaction', 'getMinimumBalanceForRentExemption',
  'sendTransaction', 'simulateTransaction', 'getRecentPrioritizationFees', 'getFeeForMessage', 'getAddressLookupTable',
  'getProgramAccounts', 'getTokenAccountsByOwner', 'isBlockhashValid', 'getGenesisHash', 'getVersion',
]);

async function rpc(req: NextRequest, network: 'devnet' | 'mainnet') {
  if (req.method !== 'POST') return NextResponse.json({ error: 'not_allowed' }, { status: 405 });
  const text = await req.text();
  if (text.length > 256_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  let j: unknown;
  try { j = JSON.parse(text); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const calls = Array.isArray(j) ? j : [j];
  if (!calls.length || calls.length > 50 || !calls.every((c) => c && typeof c === 'object' && RPC_METHODS.has((c as { method?: string }).method || ''))) {
    return NextResponse.json({ error: 'method_not_allowed' }, { status: 403 });
  }
  const url = network === 'mainnet' ? rpcUrl() : 'https://api.devnet.solana.com';
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: text, cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    return new NextResponse(await r.text(), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Solana RPC is unreachable right now.' }, { status: 502 });
  }
}

const SAFE = /^(health(\/[a-z]+)?|v\d+\/[A-Za-z0-9/_.-]{1,200})$/;

async function handle(req: NextRequest, ctx: { params: Promise<{ svc: string; path?: string[] }> }) {
  const cfg = privateConfig();
  if (!cfg) return NextResponse.json({ error: 'Private withdraw is off' }, { status: 404 });
  const { svc, path: parts = [] } = await ctx.params;
  if (svc === 'rpc') {
    if (!burst(`umbra-rpc:${clientIp(req)}`, 300, 60_000)) return NextResponse.json({ error: 'Too many requests. Slow down a little.' }, { status: 429 });
    return rpc(req, cfg.network);
  }
  const base = svc === 'indexer' ? cfg.indexer : svc === 'relayer' ? cfg.relayer : null;
  const path = parts.join('/');
  if (!base || !SAFE.test(path) || path.includes('..')) return NextResponse.json({ error: 'not_allowed' }, { status: 404 });
  if (!burst(`umbra:${clientIp(req)}`, 240, 60_000)) return NextResponse.json({ error: 'Too many requests. Slow down a little.' }, { status: 429 });

  const headers: Record<string, string> = {};
  for (const h of ['accept', 'content-type']) {
    const v = req.headers.get(h);
    if (v) headers[h] = v;
  }
  const body = req.method === 'GET' ? undefined : Buffer.from(await req.arrayBuffer());
  if (body && body.length > 512_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  try {
    const r = await fetch(`${base}/${path}${req.nextUrl.search}`, {
      method: req.method, headers, body, cache: 'no-store', signal: AbortSignal.timeout(50_000),
    });
    const out = new Uint8Array(await r.arrayBuffer());
    return new NextResponse(out, {
      status: r.status,
      headers: { 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'no-store' },
    });
  } catch (e) {
    const c = (e as { cause?: { code?: string; hostname?: string } }).cause;
    return NextResponse.json({ error: 'The private pool is unreachable right now. Try again shortly.', detail: c?.code || (e as Error).name }, { status: 502 });
  }
}

export const GET = handle;
export const POST = handle;
