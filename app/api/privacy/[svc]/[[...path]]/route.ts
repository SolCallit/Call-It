import { NextRequest, NextResponse } from 'next/server';
import { HELIUS_PRIVATE_BETA, HELIUS_PRIVATE_ON, PRIVATE_BETA, PRIVATE_ON, PC_RELAYER } from '@/lib/privacy/config';
import { gasAddress, relayWithdrawal } from '@/lib/privacy/gas-server';
import { solPrice } from '@/lib/payouts/payout';
import { burst, clientIp } from '@/lib/ratelimit';
import { heliusKey, rpcUrl } from '@/lib/solana/rpc';
import { HELIUS_INDEXER, HELIUS_SPR_GATEWAY, HELIUS_TEE_PROVER } from '@/lib/privacy/config';
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
export const maxDuration = 300; // a TEE proof can take a minute or more

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
  'getProgramAccounts', // Helius Privacy Rings SDK reads registry records with it
]);

const GPA_PROGRAMS = new Set([
  'ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW', // Helius Privacy Rings shielded pool
  'regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ', // Helius Privacy Rings user registry
  '9fhQBbumKEFuXtMBDw8AaQyAjCorLGJQiS3skWZdQyQD', // Privacy Cash
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
  // getProgramAccounts is the expensive one: only the privacy programs the two SDKs actually scan,
  // so nobody can run heavy scans of other programs on Callit's Helius key.
  for (const c of calls as { method?: string; params?: unknown[] }[]) {
    if (c.method === 'getProgramAccounts' && !GPA_PROGRAMS.has(String(c.params?.[0] ?? ''))) {
      return NextResponse.json({ error: 'method_not_allowed' }, { status: 403 });
    }
  }
  try {
    const r = await fetch(rpcUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: text, cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    return new NextResponse(await r.text(), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Solana RPC is unreachable right now.' }, { status: 502 });
  }
}

/* Helius Privacy Rings indexer (Photon), same-origin. The SDK POSTs JSON to <base>/<method>.
   Tries Helius' public mainnet indexer first, then the keyed /v1/spr gateway on our Helius plan.
   Only the indexer's own read methods pass; bodies are never logged (they're the user's private tags). */
const IDX_METHODS = new Set([
  'getEncryptedUtxosByTags', 'getShieldedTransactionsByTags', 'getShieldedTransactionsByNullifiers',
  'getShieldedTransactionsBySignature', 'getMerkleProofs', 'getNonInclusionProofs', 'getUserRecords',
]);
async function idx(req: NextRequest, method: string) {
  if (req.method !== 'POST') return NextResponse.json({ error: 'not_allowed' }, { status: 405 });
  if (!IDX_METHODS.has(method)) return NextResponse.json({ error: 'method_not_allowed' }, { status: 403 });
  const body = await req.text();
  if (body.length > 1_000_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  const k = heliusKey();
  // Helius closed the public CloudFront indexer (403 since late Nov 2026): the keyed /v1/spr gateway goes first.
  const ups = [...(k ? [`${HELIUS_SPR_GATEWAY}/${method}?api-key=${k}`] : []), `${HELIUS_INDEXER}/${method}`];
  let lastStatus = 502, lastText = JSON.stringify({ error: 'Helius indexer is unreachable right now.' });
  for (let i = 0; i < ups.length; i++) {
    try {
      const r = await fetch(ups[i], { method: 'POST', headers: { 'content-type': 'application/json' }, body, cache: 'no-store', signal: AbortSignal.timeout(25_000) });
      const t = await r.text();
      if (r.ok) return new NextResponse(t, { status: 200, headers: { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' } });
      lastStatus = r.status; lastText = t;
      console.warn(`[privacy/idx] ${method} upstream#${i} -> ${r.status}`);
    } catch (e) {
      console.warn(`[privacy/idx] ${method} upstream#${i} -> ${(e as Error).name}`);
    }
  }
  return new NextResponse(lastText, { status: lastStatus, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

/* Helius Privacy Rings prover (attested TEE), same-origin. Every request body is HPKE-encrypted in the browser
   to the enclave the SDK has attested, so Callit's server only ever relays ciphertext it can't read.
   Helius closed the public CloudFront prover (403), so this adds Callit's Helius key on the way through.
   Fixed routes only: /attestation, /prove/<key>, /prove/<key>/status, /prove/<key>/indexed. */
const PRV_PATH = /^(attestation|proving-keys|prove\/[A-Za-z0-9_.-]{1,128}(\/(status|indexed))?)$/;
const PRV_REQ_HEADERS = ['content-type', 'spr-tee', 'spr-tee-enc', 'spr-tee-ciphertext', 'x-sync', 'x-async', 'accept'];
async function prv(req: NextRequest, path: string) {
  if (!PRV_PATH.test(path)) return NextResponse.json({ error: 'not_allowed' }, { status: 404 });
  const k = heliusKey();
  if (!k) return NextResponse.json({ error: 'Helius key missing on the server.' }, { status: 503 });
  const q = new URLSearchParams(req.nextUrl.search);
  q.delete('api-key');
  q.set('api-key', k);
  const headers: Record<string, string> = {};
  for (const h of PRV_REQ_HEADERS) { const v = req.headers.get(h); if (v) headers[h] = v; }
  const body = req.method === 'POST' ? new Uint8Array(await req.arrayBuffer()) : undefined;
  if (body && body.length > 8_000_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  const ups = [`${HELIUS_SPR_GATEWAY}/${path}`, `${HELIUS_TEE_PROVER}/${path}`];
  let last: Response | null = null;
  for (let i = 0; i < ups.length; i++) {
    try {
      const r = await fetch(`${ups[i]}?${i === 0 ? q.toString() : req.nextUrl.search.replace(/^\?/, '')}`, {
        method: req.method, headers, body, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(280_000),
      });
      // 401/403/404 from a gateway that doesn't serve the route: try the next one. Anything else is the prover's answer.
      if ([401, 403, 404].includes(r.status) && i < ups.length - 1) { console.warn(`[privacy/prv] ${path.split('/')[0]} upstream#${i} -> ${r.status}`); last = r; continue; }
      const out = new Headers({ 'cache-control': 'no-store' });
      for (const [hk, hv] of r.headers) {
        const l = hk.toLowerCase();
        if (l === 'content-type' || l === 'retry-after' || l.startsWith('spr-tee')) out.set(hk, hv);
      }
      if (r.status >= 400) console.warn(`[privacy/prv] ${path.split('/')[0]} upstream#${i} -> ${r.status}`);
      return new NextResponse(await r.arrayBuffer(), { status: r.status, headers: out });
    } catch (e) {
      console.warn(`[privacy/prv] ${path.split('/')[0]} upstream#${i} -> ${(e as Error).name}`);
    }
  }
  return NextResponse.json({ error: 'Helius prover is unreachable right now.' }, { status: last?.status || 502 });
}

async function handle(req: NextRequest, ctx: { params: Promise<{ svc: string; path?: string[] }> }) {
  if (!PRIVATE_ON && !PRIVATE_BETA && !HELIUS_PRIVATE_ON && !HELIUS_PRIVATE_BETA) {
    return NextResponse.json({ error: 'Private withdraw is off' }, { status: 404 });
  }
  const { svc, path: parts = [] } = await ctx.params;
  if (svc === 'access') {
    // Beta: is this wallet on the tester list? Only decides whether the tab shows; every action is still signed by the user.
    // `allowed` is the Privacy Cash rail, `helius` the Helius Rings rail; both betas share PRIVATE_BETA_WALLETS.
    const w = (req.nextUrl.searchParams.get('wallet') || '').trim();
    const list = (process.env.PRIVATE_BETA_WALLETS || '').split(',').map((x) => x.trim()).filter(Boolean);
    const betaOk = (!!w && list.includes(w)) || (await isAdmin(req));
    const allowed = PRIVATE_ON || (PRIVATE_BETA && betaOk);
    const helius = HELIUS_PRIVATE_ON || (HELIUS_PRIVATE_BETA && betaOk);
    return NextResponse.json({ allowed, helius }, { headers: { 'cache-control': 'no-store' } });
  }
  if (!burst(`privacy:${svc}:${clientIp(req)}`, 300, 60_000)) return NextResponse.json({ error: 'Too many requests. Slow down a little.' }, { status: 429 });
  if (svc === 'rpc') return rpc(req);
  if (svc === 'idx') return idx(req, parts.join('/'));
  if (svc === 'prv') return prv(req, parts.join('/'));
  if (svc === 'hfee') {
    // Helius rail protocol fee, charged in SOL to the treasury inside the add-funds transaction.
    // Off unless HELIUS_PRIVATE_FEE_USD is set above zero AND a treasury wallet and a live SOL price exist.
    const t = (process.env.TREASURY_WALLET || '').trim();
    const usd = Number(process.env.HELIUS_PRIVATE_FEE_USD ?? 0);
    const ok = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t) && Number.isFinite(usd) && usd > 0 && usd <= 5;
    const price = ok ? await solPrice().catch(() => null) : null;
    const lamports = ok && price ? Math.ceil((usd / price) * 1e9) : 0;
    return NextResponse.json({ treasury: lamports ? t : null, usd: lamports ? usd : 0, lamports }, { headers: { 'cache-control': 'no-store' } });
  }
  if (svc === 'hgas') {
    // Helius rail: the gas wallet that pays withdrawal fees so the user's wallet appears nowhere.
    if (!HELIUS_PRIVATE_ON && !HELIUS_PRIVATE_BETA) return NextResponse.json({ error: 'not_allowed' }, { status: 404 });
    if (req.method === 'GET') {
      const address = await gasAddress();
      return NextResponse.json({ address }, { headers: { 'cache-control': 'no-store' } });
    }
    // Signed-in users only, and at a slower pace: each relay costs the gas wallet a network fee.
    if (!burst(`privacy:hgas-post:${clientIp(req)}`, 10, 60_000)) return NextResponse.json({ error: 'Too many requests. Slow down a little.' }, { status: 429 });
    if (!(await verifyPrivyToken(req))) return NextResponse.json({ error: 'Sign in again, then retry.' }, { status: 401 });
    const body = (await req.json().catch(() => null)) as { tx?: string } | null;
    if (!body?.tx || typeof body.tx !== 'string' || body.tx.length > 400_000) {
      return NextResponse.json({ error: 'invalid_tx' }, { status: 400 });
    }
    // Verified and forgotten: who withdraws where is exactly what this feature hides, so nothing is logged.
    return relayWithdrawal(body.tx);
  }
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
