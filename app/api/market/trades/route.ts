import { NextResponse } from 'next/server';
import { isMint, recentTrades } from '@/lib/market/sources';

export const runtime = 'nodejs';

/** GET /api/market/trades?pool=<pool>&mint=<mint>: the latest buys and sells on one pool, newest first. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const pool = u.searchParams.get('pool') || '';
  const mint = u.searchParams.get('mint') || '';
  if (!isMint(pool) || !isMint(mint)) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const trades = await recentTrades(pool, mint);
  if (!trades) return NextResponse.json({ error: 'upstream_unavailable', trades: [] }, { status: 502, headers: { 'cache-control': 'no-store' } });
  return NextResponse.json({ trades, at: Date.now() }, { headers: { 'cache-control': 'public, s-maxage=3, stale-while-revalidate=6' } });
}
