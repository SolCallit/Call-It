import { trendingCard } from '@/lib/og/trending';
import { jupList, type LiveToken } from '@/lib/market/sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NOT_MEME = new Set(['SOL', 'WSOL', 'USDC', 'USDT', 'USDS', 'PYUSD', 'USD1', 'EURC', 'JUP', 'JTO', 'PYTH', 'RAY', 'ORCA', 'JLP', 'JITOSOL', 'MSOL', 'BSOL', 'INF', 'JUPSOL', 'BNSOL', 'WBTC', 'CBBTC', 'ZBTC', 'WETH', 'ETH', 'HNT', 'RENDER', 'W', 'KMNO', 'DRIFT', 'ONDO']);
const isStock = (t: LiveToken) => /xstock|securities|proshares|tokenized/i.test(t.name) || /backed\.fi|stock-logo/i.test(t.icon || '');


/** Token icon as a PNG data URI (the image renderer can't take WebP or slow IPFS links), or null. */
async function iconData(t: LiveToken, origin: string): Promise<string | null> {
  const ipfs = (u: string) => u.replace(/^ipfs:\/\/(ipfs\/)?/, 'https://ipfs.io/ipfs/');
  const tries = [
    t.icon ? `https://wsrv.nl/?url=${encodeURIComponent(ipfs(t.icon))}&w=220&h=220&fit=cover&output=png&n=-1` : null,
    `https://wsrv.nl/?url=${encodeURIComponent(`${origin}/api/market/icon/${t.mint}`)}&w=220&h=220&fit=cover&output=png&n=-1`,
  ].filter(Boolean) as string[];
  for (const u of tries) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(6000) });
      if (!r.ok || !(r.headers.get('content-type') || '').includes('png')) continue;
      return `data:image/png;base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
    } catch { /* next */ }
  }
  return null;
}

async function font(family: string, weight: number): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}`, { signal: AbortSignal.timeout(5000) }).then((r) => r.text());
    const url = css.match(/src: url\((.+?)\) format\('(?:truetype|opentype)'\)/)?.[1];
    return url ? await fetch(url, { signal: AbortSignal.timeout(5000) }).then((r) => r.arrayBuffer()) : null;
  } catch { return null; }
}

/**
 * GET /api/og/trending?tf=24h|6h|1h — "Top gainers on Callit": a 1600×1250 card of the eight biggest
 * gaining Solana memes trending right now, for posting on X. Live data every time it's opened.
 */
export async function GET(req: Request) {
  const u = new URL(req.url), origin = u.origin;
  const tf = (['1h', '6h', '24h'].includes(u.searchParams.get('tf') || '') ? u.searchParams.get('tf') : '24h') as '1h' | '6h' | '24h';
  const key = tf === '1h' ? 'h1' : tf === '6h' ? 'h6' : 'h24';
  const skip = new Set((u.searchParams.get('skip') || '').toUpperCase().split(',').filter(Boolean));
  const list = (await jupList('movers', tf, 100)) || [];
  const top = list
    .filter((t) => !NOT_MEME.has(t.sym.toUpperCase()) && !skip.has(t.sym.toUpperCase()) && !isStock(t) && (t.mc || 0) > 100_000 && (t.mc || 0) < 5e9 && t.chg[key] != null && (t.chg[key] as number) > 0)
    .sort((a, b) => (b.chg[key] as number) - (a.chg[key] as number))
    .slice(0, 8);
  const [icons, bold, mono] = await Promise.all([
    Promise.all(top.map((t) => iconData(t, origin))),
    font('Space+Grotesk', 700),
    font('JetBrains+Mono', 700),
  ]);
  return trendingCard({ top, icons, tf, key, logo: `${origin}/mega-white.png`, bold, mono, headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=600' } });
}
