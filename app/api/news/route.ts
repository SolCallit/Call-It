import { NextResponse } from 'next/server';
import { getNews } from '@/lib/news/sources';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** GET /api/news?tab=recent|trending — crypto/tech headlines or social trending, cached 5 min. */
export async function GET(req: Request) {
  const tab = new URL(req.url).searchParams.get('tab') === 'trending' ? 'trending' : 'recent';
  try {
    const sec = await getNews(tab);
    return NextResponse.json(sec, { headers: { 'cache-control': 'public, s-maxage=120, stale-while-revalidate=600' } });
  } catch (e) {
    console.error('[news]', e);
    return NextResponse.json({ items: [], sources: [], at: Date.now(), error: 'News is unavailable right now.' }, { status: 502 });
  }
}
