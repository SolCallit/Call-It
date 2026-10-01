import { NextResponse } from 'next/server';
import { isMint, jupMany } from '@/lib/market/sources';

export const runtime = 'nodejs';

/** GET /api/market/tokens?mints=<mint>,<mint>,... (max 50). Batch refresh for call cards. */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('mints') || '';
  const mints = [...new Set(raw.split(',').map((s) => s.trim()).filter(isMint))].sort().slice(0, 50);
  if (!mints.length) return NextResponse.json({ tokens: [] });
  const tokens = await jupMany(mints);
  return NextResponse.json({ tokens }, { headers: { 'cache-control': 'public, s-maxage=6, stale-while-revalidate=30' } });
}
