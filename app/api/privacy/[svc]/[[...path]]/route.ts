import { NextRequest, NextResponse } from 'next/server';
import { PRIVATE_BETA, PRIVATE_ON, PC_RELAYER } from '@/lib/privacy/config';
import { burst, clientIp } from '@/lib/ratelimit';
import { rpcUrl } from '@/lib/solana/rpc';
import { verifyPrivyToken } from '@/lib/auth/privy-server';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** Admins always get Private Withdraw in beta, so the people running Callit can test it. */
async function isAdmin(req: NextRequest): Promise<boolean> {
  const handles = (process.env.ADMIN_HANDLES || '').toLowerCase().split(',').map((x) => x.trim().replace(/^@/, '')).filter(Boolean);
  const wallets = (process.env.ADMIN_WALLETS || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!handles.length && !wallets.length) return false;
  try {
    const pid = await verifyPrivyToken(req);
    const db = supabaseAdmin();
    if (!pid || !db) return false;
    const { data } = await db.from('profiles').select('handle, wallet_address').eq('privy_id', pid).maybeSingle();
    if (!data) return false;
    return wallets.length
      ? !!data.wallet_address && wallets.includes(data.wallet_address as string)
      : handles.includes(String(data.handle || '').toLowerCase());
  } catch { return false; }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Same-origin pass-through for Private Withdraw (Privacy Cash).
 * - /api/privacy/relayer/... → Privacy Cash relayer (fixed host, fixed paths; never an open proxy)
 * - /api/privacy/rpc         → Solana JSON-RPC with Callit's server-side key, limited to the methods the SDK uses
 * Logs nothing about what's requested: who withdraws where is exactly what this feature hides.
 */
const RELAYER_PATHS = /^(config|merkle\/root|merkle\/proofv2|utxos\/(range|indices|check\/[A-Za-z0-9+/=_-]{1,4000})|deposit(\/spl)?|withdraw(\/spl)?)$/;

const RPC_METHODS = new Set([
  'getAccountInfo', 'getMultipleAccounts', 'getBalance', 'getTokenAccountBalance', 'getTokenAccountsByOwner',
  'getLatestBlockhash', 'getSignatureStatuses', 'getMinimumBalanceForRentExemption', 'getEpochInfo', 'getSlot',
  'getBlockHeight', 'isBlockhashValid', 'getFeeForMessage', 'getRecentPrioritizationFees', 'simulateTransaction',
  'sendTransaction', 'getVersion', 'getGenesisHash',
]);

async function rpc(req: NextRequest) {
  if (req.method !== 'POST') return NextResponse.json({ error: 'not_allowed' }, { status: 405 });
  const text = await req.text();
  if (text.length > 256_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  let j: unknown;
  try { j = JSON.parse(text); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const calls = Array.isArray(j) ? j : [j];
  if (!calls.length || calls.length > 50 || !calls.every((c) => c && typeof c === 'object' && RPC_METHODS.has((c as { method?: string }).method || ''))) {
    return NextResponse.json({ error: 'method_not_allowed' }, { status: 403 });
  }
  try {
    const r = await fetch(rpcUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: text, cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    return new NextResponse(await r.text(), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Solana RPC is unreachable right now.' }, { status: 502 });
  }
}

async function handle(req: NextRequest, ctx: { params: Promise<{ svc: string; path?: string[] }> }) {
  if (!PRIVATE_ON && !PRIVATE_BETA) return NextResponse.json({ error: 'Private withdraw is off' }, { status: 404 });
  const { svc, path: parts = [] } = await ctx.params;
  if (svc === 'access') {
    // Beta: is this wallet on the tester list? Only decides whether the tab shows; every action is still signed by the user.
    const w = (req.nextUrl.searchParams.get('wallet') || '').trim();
    const list = (process.env.PRIVATE_BETA_WALLETS || '').split(',').map((x) => x.trim()).filter(Boolean);
    const allowed = PRIVATE_ON || (!!w && list.includes(w)) || (await isAdmin(req));
    return NextResponse.json({ allowed }, { headers: { 'cache-control': 'no-store' } });
  }
  if (!burst(`privacy:${svc}:${clientIp(req)}`, 300, 60_000)) return NextResponse.json({ error: 'Too many requests. Slow down a little.' }, { status: 429 });
  if (svc === 'rpc') return rpc(req);
  if (svc === 'fee') {
    // Callit's privacy fee, charged in SOL to the treasury when a user adds funds. Off if no treasury is set.
    const t = (process.env.TREASURY_WALLET || '').trim();
    // No Callit fee on Private Withdraw. Set PRIVATE_FEE_USD in Vercel to charge one.
    const usd = Number(process.env.PRIVATE_FEE_USD ?? 0);
    return NextResponse.json(
      { treasury: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t) ? t : null, usd: Number.isFinite(usd) && usd > 0 ? usd : 0 },
      { headers: { 'cache-control': 'no-store' } },
    );
  }
  if (svc !== 'relayer') return NextResponse.json({ error: 'not_allowed' }, { status: 404 });

  const path = parts.join('/');
  if (!RELAYER_PATHS.test(path) || path.includes('..')) return NextResponse.json({ error: 'not_allowed' }, { status: 404 });
  const body = req.method === 'GET' ? undefined : await req.text();
  if (body && body.length > 512_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  try {
    const r = await fetch(`${PC_RELAYER}/${path}${req.nextUrl.search}`, {
      method: req.method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body, cache: 'no-store', signal: AbortSignal.timeout(55_000),
    });
    return new NextResponse(await r.text(), {
      status: r.status,
      headers: { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' },
    });
  } catch (e) {
    const c = (e as { cause?: { code?: string } }).cause;
    return NextResponse.json({ error: 'Privacy Cash is unreachable right now. Try again shortly.', detail: c?.code || (e as Error).name }, { status: 502 });
  }
}

export const GET = handle;
export const POST = handle;
