import { NextResponse } from 'next/server';
import { candles, isMint, TIMEFRAMES, type Tf } from '@/lib/market/sources';

export const runtime = 'nodejs';

/** GET /api/market/chart?pool=<pair>&mint=<mint>&tf=1m|5m|15m|1h|4h|1d */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const pool = u.searchParams.get('pool') || '';
  const mint = u.searchParams.get('mint') || '';
  const tf = (u.searchParams.get('tf') || '15m') as Tf;
  if (!isMint(pool) || !isMint(mint) || !(tf in TIMEFRAMES)) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const b = Number(u.searchParams.get('before') || 0);
  const list = await candles(pool, mint, tf, Number.isFinite(b) && b > 1e9 ? Math.floor(b) : undefined);
  if (!list) return NextResponse.json({ error: 'upstream_unavailable', candles: [] }, { status: 502, headers: { 'cache-control': 'no-store' } });
  const ttl = TIMEFRAMES[tf][2];
  return NextResponse.json({ tf, candles: list }, { headers: { 'cache-control': `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}` } });
}
