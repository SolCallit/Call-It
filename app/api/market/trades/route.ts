import { NextResponse } from 'next/server';
import { isMint, livePool, recentTrades, tokenPools, type Trade } from '@/lib/market/sources';
import { poolSwaps } from '@/lib/market/swaps';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** GET /api/market/trades?pool=<pool>&mint=<mint>: the latest buys and sells, newest first.
 *  From Callit's own swap indexer (Helius) when it's up, GeckoTerminal otherwise. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const pool = u.searchParams.get('pool') || '';
  const mint = u.searchParams.get('mint') || '';
  if (!isMint(pool) || !isMint(mint)) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const live = await livePool(pool, mint);
  // Only index a pool the token's own pool list confirms: never an arbitrary address from the URL.
  const known = (await tokenPools(mint)).some((x) => x.address === live);
  const sw = known ? await poolSwaps(live, mint, Date.now() - 864e5, 100) : null;
  let trades: Trade[] | null = sw?.length
    ? sw.slice(-100).reverse().map((s) => ({ tx: s.sig, t: s.t, side: s.side, usd: s.usd, px: s.px, who: s.who }))
    : null;
  if (!trades) trades = await recentTrades(pool, mint);
  if (!trades) return NextResponse.json({ error: 'upstream_unavailable', trades: [] }, { status: 502, headers: { 'cache-control': 'no-store' } });
  return NextResponse.json({ trades, at: Date.now(), src: sw?.length ? 'callit' : 'gt' }, { headers: { 'cache-control': 'public, s-maxage=2, stale-while-revalidate=4' } });
}
