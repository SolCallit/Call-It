import { NextResponse } from 'next/server';
import { searchAll } from '@/lib/market/sources';
import { burst, clientIp } from '@/lib/ratelimit';

export const runtime = 'nodejs';

/** GET /api/market/search?q=<name | symbol | mint> */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 64);
  if (q.length < 2) return NextResponse.json({ tokens: [] });
  if (!burst('srch:' + clientIp(req), 40, 60_000)) return NextResponse.json({ tokens: [], error: 'rate_limited' }, { status: 429 });
  const tokens = (await searchAll(q)).slice(0, 40);
  return NextResponse.json({ tokens }, { headers: { 'cache-control': 'public, s-maxage=30, stale-while-revalidate=120' } });
}
