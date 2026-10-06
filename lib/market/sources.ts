import 'server-only';

/**
 * Live Solana token data.
 *  - Jupiter Tokens API v2: prices, market cap, holders, audit, trending/new lists
 *  - DexScreener: best trading pair per token (for charts), images and socials
 *  - GeckoTerminal: OHLCV candles for charts
 * Every fetch goes through Next's data cache so many visitors share one upstream call.
 */

export type LiveToken = {
  mint: string;
  sym: string;
  name: string;
  icon: string | null;
  price: number | null;
  mc: number | null;
  fdv: number | null;
  liq: number | null;
  holders: number | null;
  vol24: number | null;
  chg: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  buys24: number | null;
  sells24: number | null;
  traders24: number | null;
  createdAt: string | null;
  pool: string | null;
  dex: string | null;
  verified: boolean;
  organic: number | null;
  audit: { mintOff: boolean | null; freezeOff: boolean | null; top10: number | null; dev: number | null; sus: boolean };
  socials: { x: string | null; web: string | null; tg: string | null };
  launchpad: string | null;
  decimals: number | null;
  /** What the token trades against in its main pool (SOL, USDC, a stock token, another meme...). */
  quote?: { mint: string; sym: string } | null;
  /** Buy/sell volume (USD) and counts over 5m and 1h, for Heat. */
  flow?: { m5: Flow | null; h1: Flow | null } | null;
};
export type Flow = { bv: number; sv: number; b: number; s: number };
const flowOf = (x?: { buyVolume?: number; sellVolume?: number; numBuys?: number; numSells?: number } | null): Flow | null =>
  x && (x.buyVolume != null || x.sellVolume != null) ? { bv: Number(x.buyVolume) || 0, sv: Number(x.sellVolume) || 0, b: Number(x.numBuys) || 0, s: Number(x.numSells) || 0 } : null;

const JUP = 'https://api.jup.ag';
const DEXS = 'https://api.dexscreener.com';
const GT = 'https://api.geckoterminal.com/api/v2';

export const isMint = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

async function getJSON<T>(url: string, revalidate: number, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: { accept: 'application/json', ...headers }, next: { revalidate } });
    if (!r.ok) {
      console.error('[market] upstream', r.status, url.split('?')[0]);
      return null;
    }
    return (await r.json()) as T;
  } catch (e) {
    console.error('[market] fetch failed', url.split('?')[0], e);
    return null;
  }
}

const jupHeaders = (): Record<string, string> => (process.env.JUPITER_API_KEY ? { 'x-api-key': process.env.JUPITER_API_KEY } : {});
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(+v) ? +v : null);

/* ---------- Jupiter ---------- */

type JupStats = { priceChange?: number; buyVolume?: number; sellVolume?: number; numBuys?: number; numSells?: number; numTraders?: number };
type JupToken = {
  id: string; name: string; symbol: string; icon: string | null; createdAt?: string; decimals?: number;
  twitter?: string; website?: string; telegram?: string; launchpad?: string;
  fdv: number | null; mcap: number | null; usdPrice: number | null; liquidity: number | null; holderCount: number | null;
  organicScore?: number; isVerified: boolean | null;
  audit?: { isSus?: boolean; mintAuthorityDisabled?: boolean; freezeAuthorityDisabled?: boolean; topHoldersPercentage?: number; devBalancePercentage?: number } | null;
  firstPool?: { id: string; createdAt: string } | null;
  stats5m?: JupStats | null; stats1h?: JupStats | null; stats6h?: JupStats | null; stats24h?: JupStats | null;
};

function fromJup(j: JupToken): LiveToken {
  const s24 = j.stats24h || {};
  const vol = (s24.buyVolume ?? 0) + (s24.sellVolume ?? 0);
  return {
    mint: j.id,
    sym: (j.symbol || '').slice(0, 16) || j.id.slice(0, 4),
    name: (j.name || j.symbol || 'Unknown').slice(0, 48),
    icon: j.icon || null,
    price: num(j.usdPrice),
    mc: num(j.mcap) ?? num(j.fdv),
    fdv: num(j.fdv),
    liq: num(j.liquidity),
    holders: num(j.holderCount),
    vol24: s24.buyVolume != null || s24.sellVolume != null ? vol : null,
    chg: { m5: num(j.stats5m?.priceChange), h1: num(j.stats1h?.priceChange), h6: num(j.stats6h?.priceChange), h24: num(s24.priceChange) },
    buys24: num(s24.numBuys),
    sells24: num(s24.numSells),
    traders24: num(s24.numTraders),
    createdAt: j.firstPool?.createdAt || j.createdAt || null,
    pool: j.firstPool?.id || null,
    dex: null,
    verified: !!j.isVerified,
    organic: num(j.organicScore),
    flow: { m5: flowOf(j.stats5m), h1: flowOf(j.stats1h) },
    audit: {
      mintOff: j.audit?.mintAuthorityDisabled ?? null,
      freezeOff: j.audit?.freezeAuthorityDisabled ?? null,
      top10: num(j.audit?.topHoldersPercentage),
      dev: num(j.audit?.devBalancePercentage),
      sus: !!j.audit?.isSus,
    },
    socials: { x: j.twitter || null, web: j.website || null, tg: j.telegram || null },
    launchpad: j.launchpad || null,
    decimals: num(j.decimals),
  };
}

export type Feed = 'movers' | 'new' | 'traded' | 'organic';
export async function jupList(feed: Feed, interval: '5m' | '1h' | '6h' | '24h' = '1h', limit = 50): Promise<LiveToken[] | null> {
  const path =
    feed === 'new' ? '/tokens/v2/recent'
    : `/tokens/v2/${feed === 'movers' ? 'toptrending' : feed === 'traded' ? 'toptraded' : 'toporganicscore'}/${interval}?limit=${limit}`;
  const [data, extra] = await Promise.all([
    getJSON<JupToken[]>(JUP + path, feed === 'new' ? 5 : 6, jupHeaders()),
    feed === 'new' ? gtNewLaunches() : Promise.resolve([] as LiveToken[]),
  ]);
  if (Array.isArray(data) && data.length) {
    const out = data.filter((j) => j && j.id).map(fromJup);
    const seen = new Set(out.map((t) => t.mint));
    for (const t of extra) if (!seen.has(t.mint)) { seen.add(t.mint); out.push(t); }
    return out;
  }
  return extra.length ? extra : dsList(feed); // Jupiter unavailable (no key / rate limit): fall back to DexScreener
}

/**
 * New pools on every Solana DEX/launchpad from GeckoTerminal (Meteora DBC, LaunchLab, Moonshot,
 * Raydium, Orca...). pump.fun already streams in live through PumpPortal, so it's skipped here to
 * give the other launchpads room in the New feed.
 */
type GtPool = { attributes?: { address?: string; pool_created_at?: string }; relationships?: { base_token?: { data?: { id?: string } }; quote_token?: { data?: { id?: string } }; dex?: { data?: { id?: string } } } };
const GT_LP: [RegExp, string][] = [[/dbc|dynamic-bonding|meteora/, 'meteora'], [/launchlab|raydium-launch/, 'launchlab'], [/moonshot/, 'moonshot'], [/boop/, 'boop'], [/bonk/, 'bonk']];
async function gtNewLaunches(): Promise<LiveToken[]> {
  const pages = await Promise.all([1, 2].map((p) => getJSON<{ data?: GtPool[] }>(`${GT}/networks/solana/new_pools?page=${p}`, 15)));
  const pools = pages.flatMap((d) => d?.data || []);
  const meta = new Map<string, { dex: string; quote: string | null }>();
  for (const p of pools) {
    const dex = p.relationships?.dex?.data?.id || '';
    const mint = (p.relationships?.base_token?.data?.id || '').replace(/^solana_/, '');
    if (!isMint(mint) || /pump/.test(dex) || meta.has(mint)) continue;
    meta.set(mint, { dex, quote: (p.relationships?.quote_token?.data?.id || '').replace(/^solana_/, '') || null });
  }
  if (!meta.size) return [];
  const toks = await jupMany([...meta.keys()].slice(0, 40));
  return toks.map((t) => {
    const m = meta.get(t.mint);
    const lp = t.launchpad || (m ? GT_LP.find(([re]) => re.test(m.dex))?.[1] ?? null : null);
    return { ...t, launchpad: lp, dex: t.dex || m?.dex || null };
  });
}

/** Fallback lists from DexScreener: newest token profiles, or most-boosted tokens. */
async function dsList(feed: Feed): Promise<LiveToken[] | null> {
  const src = await getJSON<{ chainId: string; tokenAddress: string }[]>(
    `${DEXS}/${feed === 'new' ? 'token-profiles/latest/v1' : 'token-boosts/top/v1'}`, 30,
  );
  if (!Array.isArray(src)) return null;
  const mints = [...new Set(src.filter((x) => x.chainId === 'solana').map((x) => x.tokenAddress))].slice(0, 30);
  if (!mints.length) return [];
  const pairs = await getJSON<DsPair[]>(`${DEXS}/tokens/v1/solana/${mints.join(',')}`, 20);
  if (!Array.isArray(pairs)) return null;
  const out: LiveToken[] = [];
  for (const m of mints) {
    const t = withPair(null, pairs.filter((p) => p.baseToken?.address === m));
    if (t) out.push(t);
  }
  return out;
}

/** Many tokens at once (Jupiter search takes comma-separated mints). DexScreener fills any gaps. */
export async function jupMany(mints: string[]): Promise<LiveToken[]> {
  const ids = [...new Set(mints.filter(isMint))].slice(0, 50);
  if (!ids.length) return [];
  const data = await getJSON<JupToken[]>(`${JUP}/tokens/v2/search?query=${ids.join(',')}`, 6, jupHeaders());
  const out = Array.isArray(data) ? data.filter((j) => j && ids.includes(j.id)).map(fromJup) : [];
  const missing = ids.filter((m) => !out.some((t) => t.mint === m)).slice(0, 30);
  if (missing.length) {
    const pairs = await getJSON<DsPair[]>(`${DEXS}/tokens/v1/solana/${missing.join(',')}`, 6);
    if (Array.isArray(pairs)) {
      for (const m of missing) {
        const t = withPair(null, pairs.filter((p) => p.baseToken?.address === m));
        if (t) out.push(t);
      }
    }
  }
  return out;
}

export async function jupSearch(q: string, revalidate = 6): Promise<LiveToken[]> {
  const data = await getJSON<JupToken[]>(`${JUP}/tokens/v2/search?query=${encodeURIComponent(q)}`, revalidate, jupHeaders());
  return Array.isArray(data) ? data.filter((j) => j && j.id).map(fromJup) : [];
}

/* ---------- DexScreener ---------- */

type DsPair = {
  pairAddress: string; dexId: string; priceUsd?: string; marketCap?: number; fdv?: number; pairCreatedAt?: number;
  liquidity?: { usd?: number }; volume?: { h24?: number }; priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  baseToken: { address: string; name: string; symbol: string };
  quoteToken?: { address: string; name?: string; symbol: string };
  info?: { imageUrl?: string; websites?: { url: string }[]; socials?: { type: string; url: string }[] };
};

export async function dsPairs(mint: string, revalidate = 8): Promise<DsPair[]> {
  const data = await getJSON<DsPair[]>(`${DEXS}/tokens/v1/solana/${mint}`, revalidate);
  return Array.isArray(data) ? data.filter((p) => p.baseToken?.address === mint) : [];
}

/** Merges DexScreener's best pair into a token (or builds the token from it if Jupiter has nothing). */
export function withPair(t: LiveToken | null, pairs: DsPair[]): LiveToken | null {
  const best = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  if (!best) return t;
  const soc = (type: string) => best.info?.socials?.find((s) => s.type === type)?.url || null;
  const base: LiveToken = t ?? {
    mint: best.baseToken.address, sym: best.baseToken.symbol, name: best.baseToken.name, icon: null,
    price: num(best.priceUsd), mc: num(best.marketCap) ?? num(best.fdv), fdv: num(best.fdv), liq: num(best.liquidity?.usd),
    holders: null, vol24: num(best.volume?.h24),
    chg: { m5: num(best.priceChange?.m5), h1: num(best.priceChange?.h1), h6: num(best.priceChange?.h6), h24: num(best.priceChange?.h24) },
    buys24: num(best.txns?.h24?.buys), sells24: num(best.txns?.h24?.sells), traders24: null,
    createdAt: best.pairCreatedAt ? new Date(best.pairCreatedAt).toISOString() : null,
    pool: null, dex: null, verified: false, organic: null,
    audit: { mintOff: null, freezeOff: null, top10: null, dev: null, sus: false },
    socials: { x: null, web: null, tg: null }, launchpad: null, decimals: null,
  };
  /* DexScreener is near real-time; Jupiter's token index can lag minutes on fresh launches (the header
     showed $3.4K while the DexScreener chart showed $8.7K). When the pair has a price, its price, market
     cap and changes win, so the header always matches the chart underneath it. */
  const dsPrice = num(best.priceUsd);
  const live: Partial<LiveToken> = dsPrice ? {
    price: dsPrice,
    mc: num(best.marketCap) ?? (base.mc && base.price ? (base.mc * dsPrice) / base.price : base.mc),
    fdv: num(best.fdv) ?? base.fdv,
    liq: num(best.liquidity?.usd) ?? base.liq,
    vol24: num(best.volume?.h24) ?? base.vol24,
    chg: {
      m5: num(best.priceChange?.m5) ?? base.chg.m5, h1: num(best.priceChange?.h1) ?? base.chg.h1,
      h6: num(best.priceChange?.h6) ?? base.chg.h6, h24: num(best.priceChange?.h24) ?? base.chg.h24,
    },
    buys24: num(best.txns?.h24?.buys) ?? base.buys24, sells24: num(best.txns?.h24?.sells) ?? base.sells24,
  } : {};
  return {
    ...base,
    ...live,
    pool: best.pairAddress,
    dex: best.dexId,
    quote: best.quoteToken?.address ? { mint: best.quoteToken.address, sym: (best.quoteToken.symbol || '').slice(0, 16) } : null,
    icon: base.icon || best.info?.imageUrl || null,
    socials: {
      x: base.socials.x || soc('twitter'),
      web: base.socials.web || best.info?.websites?.[0]?.url || null,
      tg: base.socials.tg || soc('telegram'),
    },
  };
}

/** One token for its live page. Short cache: the page polls every ~2s and should feel live. */
export async function liveToken(mint: string): Promise<LiveToken | null> {
  const [j, pairs] = await Promise.all([jupSearch(mint, 2), dsPairs(mint, 3)]);
  return withPair(j.find((x) => x.mint === mint) || null, pairs);
}

/* ---------- GeckoTerminal candles ---------- */

/* [unit, aggregate, cache seconds]. Candles are re-pulled on this cadence; between pulls the
   client moves the last candle with the live price every ~2s, so the chart never looks frozen. */
export const TIMEFRAMES = {
  '1m': ['minute', 1, 5],
  '5m': ['minute', 5, 10],
  '15m': ['minute', 15, 15],
  '1h': ['hour', 1, 30],
  '4h': ['hour', 4, 60],
  '1d': ['day', 1, 120],
} as const;
export type Tf = keyof typeof TIMEFRAMES;

/** Candles oldest-first: [unixSeconds, open, high, low, close, volumeUsd]. */
export async function candles(pool: string, mint: string, tf: Tf): Promise<number[][] | null> {
  const [unit, agg, ttl] = TIMEFRAMES[tf];
  const data = await getJSON<{ data?: { attributes?: { ohlcv_list?: number[][] } } }>(
    `${GT}/networks/solana/pools/${pool}/ohlcv/${unit}?aggregate=${agg}&limit=300&currency=usd&token=${mint}`,
    ttl,
  );
  let list = data?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list) || !list.length) {
    // Brand-new or bonding-curve pools are often missing: fall back to the token's most liquid pool.
    const pools = await getJSON<{ data?: { attributes?: { address?: string } }[] }>(`${GT}/networks/solana/tokens/${mint}/pools?page=1`, 60);
    const alt = pools?.data?.map((p) => p.attributes?.address).find((a) => a && a !== pool);
    if (alt) {
      const d2 = await getJSON<{ data?: { attributes?: { ohlcv_list?: number[][] } } }>(
        `${GT}/networks/solana/pools/${alt}/ohlcv/${unit}?aggregate=${agg}&limit=300&currency=usd&token=${mint}`, ttl);
      const l2 = d2?.data?.attributes?.ohlcv_list;
      if (Array.isArray(l2)) list = l2;
    }
  }
  if (!Array.isArray(list)) return null;
  return list.filter((c) => Array.isArray(c) && c.length >= 6).map((c) => c.slice(0, 6).map(Number)).reverse();
}
