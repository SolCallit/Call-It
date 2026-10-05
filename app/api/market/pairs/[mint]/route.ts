import { NextResponse } from 'next/server';
import { isMint } from '@/lib/market/sources';
import { rpcUrl } from '@/lib/solana/rpc';

export const runtime = 'nodejs';

type Win = { m5?: number; h1?: number; h6?: number; h24?: number };
type Tx = { buys?: number; sells?: number };
type DsPair = {
  pairAddress: string; dexId: string; url?: string; labels?: string[]; priceUsd?: string; priceNative?: string;
  marketCap?: number; fdv?: number; pairCreatedAt?: number;
  liquidity?: { usd?: number; base?: number; quote?: number };
  volume?: Win; priceChange?: Win; txns?: { m5?: Tx; h1?: Tx; h6?: Tx; h24?: Tx };
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  info?: { imageUrl?: string; header?: string; openGraph?: string; websites?: { label?: string; url: string }[]; socials?: { type: string; url: string }[] };
};

const n = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const LAUNCH: Record<string, string> = { pump: 'Pump.fun', bonk: 'Bonk', bonkfun: 'Bonk', bags: 'Bags', moon: 'Moonshot', believe: 'Believe' };
const DEX: Record<string, string> = { pumpswap: 'PumpSwap', pumpfun: 'Pump.fun', raydium: 'Raydium', meteora: 'Meteora', orca: 'Orca', 'raydium-clmm': 'Raydium CLMM', launchlab: 'LaunchLab', fluxbeam: 'FluxBeam' };

/* Token description (the coin's lore) from its on-chain metadata. Cached 1h per mint. */
const ABOUT = new Map<string, { v: string | null; at: number }>();
async function aboutOf(mint: string): Promise<string | null> {
  const hit = ABOUT.get(mint);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.v;
  let v: string | null = null;
  try {
    const url = rpcUrl();
    if (/helius/.test(url)) {
      const r = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'about', method: 'getAsset', params: { id: mint } }),
        signal: AbortSignal.timeout(3000),
      });
      const j = (await r.json()) as { result?: { content?: { json_uri?: string; metadata?: { description?: string } } } };
      v = j.result?.content?.metadata?.description?.trim() || null;
      const uri = j.result?.content?.json_uri;
      if (!v && uri && /^https:\/\//.test(uri)) {
        const m = await fetch(uri, { signal: AbortSignal.timeout(3000) }).then((x) => (x.ok ? x.json() : null)).catch(() => null) as { description?: string } | null;
        v = (m && typeof m.description === 'string' && m.description.trim()) || null;
      }
    }
  } catch { /* unknown */ }
  if (v) v = v.slice(0, 1200);
  ABOUT.set(mint, { v, at: Date.now() });
  return v;
}

/** GET /api/market/pairs/<mint>: DexScreener-style pair info (every pool for the token) plus the token's description. */
export async function GET(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  if (!isMint(mint)) return NextResponse.json({ error: 'invalid_mint' }, { status: 400 });
  const [raw, about] = await Promise.all([
    fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, { next: { revalidate: 10 }, signal: AbortSignal.timeout(4000) })
      .then((r) => (r.ok ? r.json() : [])).catch(() => []) as Promise<DsPair[]>,
    aboutOf(mint),
  ]);
  const list = (Array.isArray(raw) ? raw : []).filter((p) => p && (p.baseToken?.address === mint || p.quoteToken?.address === mint))
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)).slice(0, 8);
  const tx = (t?: Tx) => ({ buys: n(t?.buys) ?? 0, sells: n(t?.sells) ?? 0 });
  const pairs = list.map((p) => {
    const flipped = p.quoteToken?.address === mint;
    const launch = (p.labels || []).map((l) => LAUNCH[l.toLowerCase()]).find(Boolean) || (/pump$/.test(mint) ? 'Pump.fun' : null);
    return {
      address: p.pairAddress, url: p.url || `https://dexscreener.com/solana/${p.pairAddress}`,
      dex: DEX[p.dexId] || p.dexId, via: launch && launch !== (DEX[p.dexId] || p.dexId) ? launch : null, labels: p.labels || [],
      base: { sym: (flipped ? p.quoteToken : p.baseToken).symbol, address: mint },
      quote: { sym: (flipped ? p.baseToken : p.quoteToken).symbol, address: (flipped ? p.baseToken : p.quoteToken).address },
      priceUsd: n(p.priceUsd), priceNative: flipped ? null : n(p.priceNative),
      liq: { usd: n(p.liquidity?.usd), base: n(flipped ? p.liquidity?.quote : p.liquidity?.base), quote: n(flipped ? p.liquidity?.base : p.liquidity?.quote) },
      fdv: n(p.fdv), mc: n(p.marketCap), createdAt: p.pairCreatedAt || null,
      chg: { m5: n(p.priceChange?.m5), h1: n(p.priceChange?.h1), h6: n(p.priceChange?.h6), h24: n(p.priceChange?.h24) },
      vol: { m5: n(p.volume?.m5), h1: n(p.volume?.h1), h6: n(p.volume?.h6), h24: n(p.volume?.h24) },
      txns: { m5: tx(p.txns?.m5), h1: tx(p.txns?.h1), h6: tx(p.txns?.h6), h24: tx(p.txns?.h24) },
    };
  });
  const info = list.find((p) => p.info)?.info;
  return NextResponse.json({
    pairs,
    about,
    header: info?.header || null,
    links: [
      ...(info?.websites || []).map((w) => ({ type: 'web', label: w.label || 'Website', url: w.url })),
      ...(info?.socials || []).map((s) => ({ type: s.type, label: s.type === 'twitter' ? 'X' : s.type[0].toUpperCase() + s.type.slice(1), url: s.url })),
    ].filter((l) => /^https?:\/\//.test(l.url)).slice(0, 6),
  }, { headers: { 'cache-control': 'public, s-maxage=10, stale-while-revalidate=30' } });
}
