import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type Gif = { url: string; preview: string; title: string };

/**
 * GET /api/gifs?q=<text>: GIF search for the composer. Empty q = trending.
 * Uses TENOR_API_KEY (Google Tenor v2) or GIPHY_API_KEY. Without a key: { configured: false }.
 */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 60);
  const tenor = process.env.TENOR_API_KEY;
  const giphy = process.env.GIPHY_API_KEY;
  if (!tenor && !giphy) return NextResponse.json({ configured: false, gifs: [] }, { status: 404 });
  const cache = { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=3600' };
  try {
    let gifs: Gif[] = [];
    if (tenor) {
      const base = q ? 'search' : 'featured';
      const u = `https://tenor.googleapis.com/v2/${base}?key=${tenor}&client_key=callit&limit=24&contentfilter=medium&media_filter=gif,tinygif${q ? `&q=${encodeURIComponent(q)}` : ''}`;
      const j = (await (await fetch(u, { signal: AbortSignal.timeout(5000) })).json()) as { results?: { content_description?: string; media_formats?: { gif?: { url: string; size?: number }; tinygif?: { url: string } } }[] };
      gifs = (j.results || []).map((r) => ({ url: r.media_formats?.gif?.url || '', preview: r.media_formats?.tinygif?.url || r.media_formats?.gif?.url || '', title: r.content_description || 'GIF' }));
    } else if (giphy) {
      const u = q
        ? `https://api.giphy.com/v1/gifs/search?api_key=${giphy}&q=${encodeURIComponent(q)}&limit=24&rating=pg-13`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${giphy}&limit=24&rating=pg-13`;
      const j = (await (await fetch(u, { signal: AbortSignal.timeout(5000) })).json()) as { data?: { title?: string; images?: { downsized?: { url: string }; fixed_width_small?: { url: string } } }[] };
      gifs = (j.data || []).map((d) => ({ url: (d.images?.downsized?.url || '').split('?')[0], preview: (d.images?.fixed_width_small?.url || d.images?.downsized?.url || '').split('?')[0], title: d.title || 'GIF' }));
    }
    return NextResponse.json({ configured: true, gifs: gifs.filter((g) => g.url && g.preview) }, { headers: cache });
  } catch {
    return NextResponse.json({ configured: true, gifs: [], error: 'upstream_unavailable' }, { status: 502 });
  }
}
