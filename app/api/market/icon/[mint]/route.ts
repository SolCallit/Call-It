import { isMint, liveToken } from '@/lib/market/sources';

export const runtime = 'nodejs';

const MAX = 2 * 1024 * 1024;
const ipfs = (u: string) => u.replace(/^ipfs:\/\/(ipfs\/)?/, 'https://ipfs.io/ipfs/');

async function grab(url: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  try {
    const r = await fetch(ipfs(url), { signal: AbortSignal.timeout(6000), headers: { accept: 'image/*' }, redirect: 'follow' });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) return null;
    const bytes = await r.arrayBuffer();
    return bytes.byteLength > 0 && bytes.byteLength <= MAX ? { bytes, type } : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/market/icon/<mint>: the token's real logo, served from our domain.
 * Fixes logos that fail to load in the browser (hotlink blocks, slow IPFS gateways,
 * missing icon in one source). Tries Jupiter's icon, then DexScreener's.
 * 404 when nothing works, so the UI keeps its initials badge.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  if (!isMint(mint)) return new Response(null, { status: 400 });

  const t = await liveToken(mint).catch(() => null);
  const candidates = [t?.icon, `https://dd.dexscreener.com/ds-data/tokens/solana/${mint}.png`].filter(Boolean) as string[];

  for (const url of candidates) {
    const img = await grab(url);
    if (img) {
      return new Response(img.bytes, {
        headers: {
          'content-type': img.type,
          'cache-control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000',
          'x-content-type-options': 'nosniff',
          // SVG icons from third parties can't run scripts when loaded as <img>, but lock it down anyway.
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        },
      });
    }
  }
  return new Response(null, { status: 404, headers: { 'cache-control': 'public, s-maxage=3600' } });
}
