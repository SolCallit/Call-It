import { NextResponse } from 'next/server';
import { isMint } from '@/lib/market/sources';
import { tokenRisk } from '@/lib/market/risk';

export const runtime = 'nodejs';

/** GET /api/market/risk/<mint>: Dex paid, launch bundle %, and top holders for the bubble map. Cached 5 min. */
export async function GET(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  if (!isMint(mint)) return NextResponse.json({ error: 'invalid_mint' }, { status: 400 });
  return NextResponse.json(await tokenRisk(mint), { headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=900' } });
}
