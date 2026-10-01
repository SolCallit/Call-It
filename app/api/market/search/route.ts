import { NextResponse } from 'next/server';
import { jupSearch } from '@/lib/market/sources';

export const runtime = 'nodejs';

/** GET /api/market/search?q=<name | symbol | mint> */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 64);
  if (q.length < 2) return NextResponse.json({ tokens: [] });
  const tokens = (await jupSearch(q)).slice(0, 20);
  return NextResponse.json({ tokens }, { headers: { 'cache-control': 'public, s-maxage=30, stale-while-revalidate=120' } });
}
