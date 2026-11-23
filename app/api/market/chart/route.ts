import { NextResponse } from 'next/server';
import { candles, isMint, livePool, TIMEFRAMES, type Tf } from '@/lib/market/sources';
import { poolSwaps, toCandles } from '@/lib/market/swaps';

export const runtime = 'nodejs';
export const maxDuration = 30;

const SEC = { minute: 60, hour: 3600, day: 86400 } as const;

/** GET /api/market/chart?pool=<pair>&mint=<mint>&tf=1m|5m|15m|1h|4h|1d
 *  Recent candles come from Callit's own swap indexer (Helius); GeckoTerminal fills older history. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const pool = u.searchParams.get('pool') || '';
  const mint = u.searchParams.get('mint') || '';
  const tf = (u.searchParams.get('tf') || '15m') as Tf;
  if (!isMint(pool) || !isMint(mint) || !(tf in TIMEFRAMES)) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const b = Number(u.searchParams.get('before') || 0);
  const before = Number.isFinite(b) && b > 1e9 ? Math.floor(b) : undefined;
  const [unit, agg, ttl] = TIMEFRAMES[tf];
  const bucket = SEC[unit] * agg;

  let own: number[][] = [];
  if (!before) {
    const live = await livePool(pool, mint);
    const since = Date.now() - Math.min(3 * 864e5, bucket * 1000 * 600);
    const sw = await poolSwaps(live, mint, since);
    if (sw?.length) own = toCandles(sw, bucket);
  }
  const gt = await candles(pool, mint, tf, before);
  if (!gt && !own.length) return NextResponse.json({ error: 'upstream_unavailable', candles: [] }, { status: 502, headers: { 'cache-control': 'no-store' } });
  // Our own candles win from the first bucket we indexed; older history from GeckoTerminal.
  const from = own.length ? own[0][0] : Infinity;
  const list = [...(gt || []).filter((c) => c[0] < from), ...own];
  return NextResponse.json({ tf, candles: list, src: own.length ? 'callit' : 'gt' }, { headers: { 'cache-control': `public, s-maxage=${own.length ? Math.min(ttl, 3) : ttl}, stale-while-revalidate=${ttl * 2}` } });
}
