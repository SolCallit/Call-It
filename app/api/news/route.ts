import { NextResponse } from 'next/server';
import { getNews, getCalendar } from '@/lib/news/sources';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** GET /api/news?tab=recent|trending|calendar — headlines by category, social trending, or the economic calendar. */
export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get('tab');
  if (t === 'calendar') {
    const c = await getCalendar();
    return NextResponse.json(c, { status: c.events.length || !c.error ? 200 : 502, headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=900' } });
  }
  const tab = t === 'trending' ? 'trending' : 'recent';
  try {
    const sec = await getNews(tab);
    return NextResponse.json(sec, { headers: { 'cache-control': 'public, s-maxage=120, stale-while-revalidate=600' } });
  } catch (e) {
    console.error('[news]', e);
    return NextResponse.json({ items: [], sources: [], at: Date.now(), error: 'News is unavailable right now.' }, { status: 502 });
  }
}
