import { NextRequest, NextResponse } from 'next/server';
import { privateConfig } from '@/lib/privacy/config';
import { burst, clientIp } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Same-origin pass-through to Umbra's indexer and relayer for Private Withdraw.
 * Umbra's APIs don't send CORS headers for Callit's domain, so the browser can't call them
 * directly. This forwards only to those two fixed hosts (never an open proxy), keeps the
 * protobuf body byte-for-byte, and logs nothing about what's requested.
 */
const SAFE = /^(health(\/[a-z]+)?|v\d+\/[A-Za-z0-9/_.-]{1,200})$/;

async function handle(req: NextRequest, ctx: { params: Promise<{ svc: string; path: string[] }> }) {
  const cfg = privateConfig();
  if (!cfg) return NextResponse.json({ error: 'Private withdraw is off' }, { status: 404 });
  const { svc, path: parts } = await ctx.params;
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
