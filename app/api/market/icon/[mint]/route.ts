import { isMint, liveToken } from '@/lib/market/sources';
import { rpcUrl } from '@/lib/solana/rpc';

export const runtime = 'nodejs';

const MAX = 2 * 1024 * 1024;
const ipfs = (u: string) => u.replace(/^ipfs:\/\/(ipfs\/)?/, 'https://ipfs.io/ipfs/');
/** Same IPFS file through other public gateways (pump.fun images live on IPFS and gateways flake). */
const gateways = (u: string) => {
  const m = /\/ipfs\/([A-Za-z0-9]+.*)$/.exec(ipfs(u));
  return m ? [`https://ipfs.io/ipfs/${m[1]}`, `https://dweb.link/ipfs/${m[1]}`, `https://gateway.pinata.cloud/ipfs/${m[1]}`] : [];
};

/** On-chain metadata via Helius DAS: the image every brand-new launch has before Jupiter/DexScreener index it. */
async function dasImage(mint: string): Promise<string[]> {
  const url = rpcUrl();
  if (!/helius/.test(url)) return [];
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'icon', method: 'getAsset', params: { id: mint } }),
      signal: AbortSignal.timeout(5000),
    });
    const j = (await r.json()) as { result?: { content?: { json_uri?: string; links?: { image?: string }; files?: { uri?: string; cdn_uri?: string }[] } } };
    const c = j.result?.content;
    const out = [c?.files?.[0]?.cdn_uri, c?.links?.image, c?.files?.[0]?.uri].filter(Boolean) as string[];
    if (!out.length && c?.json_uri) {
      // Metadata JSON not cached by DAS yet: read it ourselves.
      const m = await fetch(ipfs(c.json_uri), { signal: AbortSignal.timeout(5000) }).then((x) => x.json()).catch(() => null);
      if (m?.image) out.push(m.image);
    }
    return out;
  } catch {
    return [];
  }
}

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
 * missing icon in one source). Tries Jupiter, DexScreener, then on-chain metadata (Helius DAS)
 * for brand-new launches, across several IPFS gateways.
 * 404 when nothing works, so the UI keeps its initials badge.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  if (!isMint(mint)) return new Response(null, { status: 400 });

  const t = await liveToken(mint).catch(() => null);
  const first = [t?.icon, `https://dd.dexscreener.com/ds-data/tokens/solana/${mint}.png`].filter(Boolean) as string[];
  const tried = new Set<string>();
  const tryAll = async (list: string[]) => {
    for (const u of list.flatMap((x) => [x, ...gateways(x)])) {
      if (tried.has(u)) continue;
      tried.add(u);
      const img = await grab(u);
      if (img) return img;
    }
    return null;
  };

  const img = (await tryAll(first)) ?? (await tryAll(await dasImage(mint)));
  {
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
  return new Response(null, { status: 404, headers: { 'cache-control': 'public, s-maxage=600' } });
}
