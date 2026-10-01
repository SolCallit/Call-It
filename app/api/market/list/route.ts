import { NextResponse } from 'next/server';
import { jupList, type Feed } from '@/lib/market/sources';

export const runtime = 'nodejs';

const FEEDS: Feed[] = ['movers', 'new', 'traded', 'organic'];
const INTERVALS = ['5m', '1h', '6h', '24h'] as const;

/** GET /api/market/list?feed=movers|new|traded|organic&interval=5m|1h|6h|24h */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const feed = (FEEDS.includes(u.searchParams.get('feed') as Feed) ? u.searchParams.get('feed') : 'movers') as Feed;
  const iv = (INTERVALS as readonly string[]).includes(u.searchParams.get('interval') || '') ? (u.searchParams.get('interval') as (typeof INTERVALS)[number]) : '1h';
  const tokens = await jupList(feed, iv, 50);
  if (!tokens) return NextResponse.json({ error: 'upstream_unavailable', tokens: [] }, { status: 502, headers: { 'cache-control': 'no-store' } });
  return NextResponse.json(
    { feed, interval: iv, tokens, at: Date.now() },
    { headers: { 'cache-control': `public, s-maxage=${feed === 'new' ? 10 : 20}, stale-while-revalidate=60` } },
  );
}
