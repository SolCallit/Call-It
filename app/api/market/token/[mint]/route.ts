import { NextResponse } from 'next/server';
import { isMint, liveToken } from '@/lib/market/sources';

export const runtime = 'nodejs';

/** GET /api/market/token/<mint>: live data for one Solana token. */
export async function GET(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  if (!isMint(mint)) return NextResponse.json({ error: 'invalid_mint' }, { status: 400 });
  const token = await liveToken(mint);
  if (!token) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'public, s-maxage=30' } });
  return NextResponse.json({ token, at: Date.now() }, { headers: { 'cache-control': 'public, s-maxage=2, stale-while-revalidate=10' } });
}
