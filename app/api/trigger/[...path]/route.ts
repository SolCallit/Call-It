import { NextRequest, NextResponse } from 'next/server';
import { getBase58Decoder } from '@solana/kit';
import { verifyPrivyToken } from '@/lib/auth/privy-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BASE = 'https://api.jup.ag/trigger/v2';
const ID = '[A-Za-z0-9-]{1,80}';
/** Only these Jupiter Trigger v2 paths can be reached through Callit. */
const ALLOW: [string, RegExp][] = [
  ['POST', /^auth\/challenge$/], ['POST', /^auth\/verify$/],
  ['GET', /^vault$/], ['GET', /^vault\/register$/], ['POST', /^vault\/register$/],
  ['POST', /^deposit\/craft$/],
  ['POST', /^orders\/price$/], ['PATCH', new RegExp(`^orders/price/${ID}$`)],
  ['POST', new RegExp(`^orders/price/cancel/${ID}$`)], ['POST', new RegExp(`^orders/price/confirm-cancel/${ID}$`)],
  ['GET', /^orders\/history$/],
];

/**
 * Proxy for Jupiter Trigger v2 (limit buys, take-profit / stop-loss, trailing stops).
 * Adds Callit's Jupiter API key server-side. The user's Jupiter login token travels in
 * x-jup-jwt; the user signs every deposit/withdrawal in their own wallet, so Callit
 * never holds funds.
 */
async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!(await verifyPrivyToken(req))) return NextResponse.json({ error: 'Sign in to place orders' }, { status: 401 });
  const path = (await ctx.params).path.join('/');
  if (!ALLOW.some(([m, re]) => m === req.method && re.test(path))) return NextResponse.json({ error: 'not_allowed' }, { status: 404 });

  const headers: Record<string, string> = {};
  const key = (process.env.JUPITER_API_KEY || '').trim();
  if (key) headers['x-api-key'] = key;
  const jwt = req.headers.get('x-jup-jwt');
  if (jwt) headers.authorization = `Bearer ${jwt}`;

  let body: string | undefined;
  if (req.method !== 'GET') {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // The wallet bridge returns signatures as base64; Jupiter wants base58.
    if (path === 'auth/verify' && typeof j.signature === 'string' && !/^[1-9A-HJ-NP-Za-km-z]+$/.test(j.signature)) {
      j.signature = getBase58Decoder().decode(Uint8Array.from(Buffer.from(j.signature, 'base64')));
    }
    body = JSON.stringify(j);
    headers['content-type'] = 'application/json';
  }
  const url = `${BASE}/${path}${req.nextUrl.search}`;
  try {
    const r = await fetch(url, { method: req.method, headers, body, cache: 'no-store', signal: AbortSignal.timeout(45_000) });
    const text = await r.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 300) || `Jupiter ${r.status}` }; }
    if (!r.ok) console.warn('[trigger]', req.method, path, r.status, text.slice(0, 300));
    return NextResponse.json(data, { status: r.status });
  } catch (e) {
    console.error('[trigger]', path, e);
    return NextResponse.json({ error: 'Jupiter orders are unreachable right now. Try again.' }, { status: 502 });
  }
}

export const GET = handle, POST = handle, PATCH = handle;
