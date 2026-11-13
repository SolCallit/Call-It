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
  tags: string[];
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
  organicScore?: number; isVerified: boolean | null; tags?: string[];
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
    tags: Array.isArray(j.tags) ? j.tags.slice(0, 12) : [],
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

export type Feed = 'movers' | 'new' | 'traded' | 'organic' | 'verified';

/**
 * Jupiter's verified list: ~4k tokens that are spot-tradeable right now, including
 * ~1.5k tokenized stocks (NVDAx, TSLAx, SPYx...), majors, stablecoins and LSTs.
 * Cached hard because the set barely moves; the biggest by market cap come first.
 */
export async function jupVerified(limit = 300): Promise<LiveToken[] | null> {
  const data = await getJSON<JupToken[]>(`${JUP}/tokens/v2/tag?query=verified`, 600, jupHeaders());
  if (!Array.isArray(data) || !data.length) return null;
  // Rank by what people are actually trading, so the list reads like a popular-right-now
  // board rather than a rich list. Organic score breaks ties and pushes wash volume down.
  const vol = (j: JupToken) => (j.stats24h?.buyVolume || 0) + (j.stats24h?.sellVolume || 0);
  const pop = (j: JupToken) => vol(j) * (0.5 + (num(j.organicScore) ?? 0) / 100);
  return data
    .filter((j) => j?.id && (num(j.usdPrice) ?? 0) > 0)
    .sort((a, b) => pop(b) - pop(a))
    .slice(0, Math.min(limit, 500))
    .map(fromJup);
}
/** Memecoins only, for the Trenches feeds: no majors, LSTs, stables, tokenized stocks or $5B+ names. */
const isMemeJup = (j: JupToken) => {
  const sym = String(j.symbol || '').toUpperCase();
  const mc = num(j.mcap) ?? num(j.fdv) ?? 0;
  return !NOT_MEME.has(sym) && !STABLE.has(sym) && !stockish(j) && !/USD|SOL$/.test(sym)
    && !(j.tags || []).some((t) => /lst|stable/i.test(t)) && mc < 5e9;
};
const isMemeLive = (t: LiveToken) => {
  const sym = String(t.sym || '').toUpperCase();
  return !NOT_MEME.has(sym) && !STABLE.has(sym) && !/xstock|securities|proshares|tokenized/i.test(t.name || '')
    && !/USD|SOL$/.test(sym) && !(t.tags || []).some((x) => /lst|stable/i.test(x)) && (t.mc ?? 0) < 5e9;
};
export async function jupList(feed: Feed, interval: '5m' | '1h' | '6h' | '24h' = '1h', limit = 50): Promise<LiveToken[] | null> {
  if (feed === 'verified') return jupVerified(limit);
  const path =
    feed === 'new' ? '/tokens/v2/recent'
    : `/tokens/v2/${feed === 'movers' ? 'toptrending' : feed === 'traded' ? 'toptraded' : 'toporganicscore'}/${interval}?limit=${limit}`;
  const [data, extra] = await Promise.all([
    getJSON<JupToken[]>(JUP + path, feed === 'new' ? 5 : 6, jupHeaders()),
    feed === 'new' ? gtNewLaunches() : Promise.resolve([] as LiveToken[]),
  ]);
  // Trenches feeds are memecoins only: majors, LSTs, stables and tokenized stocks come out here.
  const memes = feed === 'movers' || feed === 'traded' || feed === 'new';
  if (Array.isArray(data) && data.length) {
    const out = data.filter((j) => j && j.id && (!memes || isMemeJup(j))).map(fromJup);
    const seen = new Set(out.map((t) => t.mint));
    for (const t of extra) if (!seen.has(t.mint) && (!memes || isMemeLive(t))) { seen.add(t.mint); out.push(t); }
    return out;
  }
  // Jupiter unavailable (no key / rate limit): fall back to DexScreener
  const fallback = extra.length ? extra : await dsList(feed);
  return memes && fallback ? fallback.filter(isMemeLive) : fallback;
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

/**
 * Name/ticker search across every source we have, so fresh pump.fun launches and their copycats
 * show up like they do on GMGN. Jupiter's index skips many tiny or brand-new tokens, so we also ask
 * DexScreener's pair search and pump.fun's own search, then enrich and de-duplicate by mint.
 */
export async function searchAll(q: string): Promise<LiveToken[]> {
  if (isMint(q)) return liveToken(q).then((t) => (t ? [t] : []));
  const ql = q.toLowerCase();
  const [jup, ds, pump] = await Promise.all([
    jupSearch(q, 15),
    getJSON<{ pairs?: (DsPair & { chainId?: string })[] }>(`${DEXS}/latest/dex/search?q=${encodeURIComponent(q)}`, 15),
    pumpSearch(q),
  ]);
  const byMint = new Map<string, LiveToken>();
  for (const t of jup) byMint.set(t.mint, t);
  // DexScreener: group pairs by base token, keep Solana only.
  const groups = new Map<string, DsPair[]>();
  for (const p of ds?.pairs || []) {
    if (p.chainId && p.chainId !== 'solana') continue;
    const m = p.baseToken?.address;
    if (!m) continue;
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m)!.push(p);
  }
  for (const [m, pairs] of groups) {
    const t = withPair(byMint.get(m) || null, pairs);
    if (t) byMint.set(m, t);
  }
  // pump.fun: anything still missing gets enriched through Jupiter/DexScreener, else kept as-is.
  const missing = pump.filter((p) => !byMint.has(p.mint));
  if (missing.length) {
    const rich = await jupMany(missing.map((p) => p.mint));
    for (const p of missing) {
      const r = rich.find((x) => x.mint === p.mint);
      byMint.set(p.mint, r ? { ...r, icon: r.icon || p.icon, createdAt: r.createdAt || p.createdAt, launchpad: r.launchpad || 'pump.fun' } : p);
    }
  }
  const score = (t: LiveToken) => {
    const s = (t.sym || '').toLowerCase(), n = (t.name || '').toLowerCase();
    return s === ql || n === ql ? 3 : s.startsWith(ql) || n.startsWith(ql) ? 2 : s.includes(ql) || n.includes(ql) ? 1 : 0;
  };
  return [...byMint.values()]
    .filter((t) => score(t) > 0 || t.mint.toLowerCase() === ql)
    .sort((a, b) => score(b) - score(a) || (b.mc ?? 0) - (a.mc ?? 0));
}

type PumpCoin = { mint?: string; name?: string; symbol?: string; image_uri?: string; usd_market_cap?: number; market_cap?: number; created_timestamp?: number; twitter?: string; website?: string; telegram?: string };

/** pump.fun's public coin search. Best effort: it is unofficial and may refuse server traffic. */
async function pumpSearch(q: string): Promise<LiveToken[]> {
  const url = `https://frontend-api-v3.pump.fun/coins?searchTerm=${encodeURIComponent(q)}&limit=40&offset=0&sort=market_cap&order=DESC&includeNsfw=false`;
  const data = await getJSON<PumpCoin[] | { coins?: PumpCoin[] }>(url, 20, { 'user-agent': 'Mozilla/5.0 (compatible; Callit/1.0)' });
  const list = Array.isArray(data) ? data : Array.isArray(data?.coins) ? data!.coins! : [];
  return list.filter((c) => c && c.mint && isMint(c.mint)).map((c) => ({
    mint: c.mint!, sym: String(c.symbol || '').slice(0, 16), name: String(c.name || '').slice(0, 64), icon: c.image_uri || null,
    price: null, mc: num(c.usd_market_cap), fdv: null, liq: null, holders: null, vol24: null,
    chg: { m5: null, h1: null, h6: null, h24: null }, buys24: null, sells24: null, traders24: null,
    createdAt: c.created_timestamp ? new Date(c.created_timestamp).toISOString() : null,
    pool: null, dex: 'pumpfun', verified: false, organic: null, tags: [],
    audit: { mintOff: null, freezeOff: null, top10: null, dev: null, sus: false },
    socials: { x: c.twitter || null, web: c.website || null, tg: c.telegram || null }, launchpad: 'pump.fun', decimals: 6,
  }));
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
    pool: null, dex: null, verified: false, organic: null, tags: [],
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

/* ---------- Live trades on one pool (token page feed) ---------- */
export type Trade = { tx: string; t: number; side: 'buy' | 'sell'; usd: number; px: number | null; who: string };

/** Latest trades on a pool, newest first. GeckoTerminal, cached for a few seconds so open token pages share one call. */
export async function recentTrades(pool: string, mint: string): Promise<Trade[] | null> {
  const data = await getJSON<{ data?: { attributes?: Record<string, unknown> }[] }>(`${GT}/networks/solana/pools/${pool}/trades`, 3);
  if (!data || !Array.isArray(data.data)) return null;
  const out: Trade[] = [];
  for (const row of data.data) {
    const a = row?.attributes || {};
    const tx = String(a.tx_hash || '');
    const t = Date.parse(String(a.block_timestamp || ''));
    const side = a.to_token_address === mint ? 'buy' : a.from_token_address === mint ? 'sell' : null;
    if (!tx || !Number.isFinite(t) || !side) continue;
    out.push({ tx, t, side, usd: num(a.volume_in_usd) ?? 0, px: num(side === 'buy' ? a.price_to_in_usd : a.price_from_in_usd), who: String(a.tx_from_address || '') });
  }
  return out.slice(0, 100);
}

/* ---------- Meme market flow (radar) ---------- */
export type FlowWin = 'm5' | 'h1' | 'h6' | 'h24';
export type FlowTok = { mint: string; sym: string; icon: string | null; mc: number | null; net: number; buy: number; sell: number };
export type BWin = { b: number; s: number };
export type FlowBucket = { key: string; label: string; n: number; w: { m5: BWin; h1: BWin; h24: BWin } };
export type MajorsFlow = { n: number; w: { m5: BWin; h1: BWin; h24: BWin }; toks: FlowTok[] };
/** One row of tuning data for Heat/AI-filter accuracy. Saved server-side, never sent to clients. */
export type TokenSnap = {
  mint: string; sym: string; mc: number | null; price: number | null; liq: number | null; holders: number | null;
  organic: number | null; launchpad: string | null;
  buy5: number; sell5: number; buy1: number; sell1: number;
  chg5: number | null; chg1: number | null; chg24: number | null;
};
export type MarketFlow = {
  at: number; tokens: number;
  win: Record<FlowWin, { buy: number; sell: number; net: number; buys: number; sells: number; traders: number }>;
  topIn: FlowTok[]; topOut: FlowTok[];
  buckets: FlowBucket[]; majors: MajorsFlow;
  /** Stripped off by the API route before responding. */
  snap?: TokenSnap[];
};
const NOT_MEME = new Set(['SOL', 'WSOL', 'USDC', 'USDT', 'USDS', 'PYUSD', 'USD1', 'EURC', 'JUP', 'JTO', 'PYTH', 'RAY', 'ORCA', 'JLP', 'JITOSOL', 'MSOL', 'BSOL', 'INF', 'JUPSOL', 'BNSOL', 'WBTC', 'CBBTC', 'ZBTC', 'WETH', 'ETH', 'BTC', 'HNT', 'RENDER', 'RNDR', 'W', 'KMNO', 'DRIFT', 'XBTC', 'SSOL', 'HSOL', 'DSOL', 'VSOL', 'STSOL', 'LST', 'ZEC', 'HYPE', 'MPLX', 'CARDS', 'PUMP', 'ONDO', 'XRP', 'BNB', 'SUI', 'DOGE', 'LINK', 'AAVE']);
const stockish = (j: JupToken) => /xstock|securities|proshares|tokenized/i.test(j.name || '') || /backed\.fi|stock-logo/i.test(j.icon || '');

/** Stables stay out of the Majors strip: their "flow" is mostly the other side of every trade. */
const STABLE = new Set(['USDC', 'USDT', 'USDS', 'PYUSD', 'USD1', 'EURC']);
/** Market-cap bands for the radar ladder. */
const BANDS: [string, string, number, number][] = [
  ['u10k', 'Under 10K', 0, 1e4], ['10k', '10K–100K', 1e4, 1e5], ['100k', '100K–1M', 1e5, 1e6],
  ['1m', '1M–10M', 1e6, 1e7], ['10m', '10M–100M', 1e7, 1e8], ['100m', '100M+', 1e8, Infinity],
];
const sumWin = (toks: JupToken[]): { m5: BWin; h1: BWin; h24: BWin } => {
  const out = { m5: { b: 0, s: 0 }, h1: { b: 0, s: 0 }, h24: { b: 0, s: 0 } };
  for (const j of toks) {
    for (const [k, f] of [['m5', 'stats5m'], ['h1', 'stats1h'], ['h24', 'stats24h']] as const) {
      const s = j[f] as JupStats | null | undefined;
      if (!s) continue;
      out[k].b += Number(s.buyVolume) || 0;
      out[k].s += Number(s.sellVolume) || 0;
    }
  }
  return out;
};

/**
 * Net buy volume (buys minus sells, in USD) across Solana meme tokens that are trading right now:
 * Jupiter's most-traded, trending and newest lists, minus stables, LSTs, majors and anything over $5B.
 * Also returns the same flow split into market-cap bands, a Majors strip (SOL, wBTC, wETH... as they
 * trade on Solana), and a snapshot of per-token stats for tuning Heat/AI filters server-side.
 * Sampled from the lists above (~400 tokens), so tiny caps are a sample, not a census.
 */
export async function memeFlow(): Promise<MarketFlow | null> {
  const lists = await Promise.all([
    ...['toptraded/24h', 'toptraded/1h', 'toptrending/1h', 'toptrending/6h'].map((p) => getJSON<JupToken[]>(`${JUP}/tokens/v2/${p}?limit=100`, 30, jupHeaders())),
    getJSON<JupToken[]>(`${JUP}/tokens/v2/recent`, 30, jupHeaders()), // fills the under-10K / 10K–100K bands
  ]);
  const seen = new Map<string, JupToken>();
  for (const l of lists) if (Array.isArray(l)) for (const j of l) if (j?.id && !seen.has(j.id)) seen.set(j.id, j);
  const toks = [...seen.values()].filter((j) => {
    const sym = String(j.symbol || '').toUpperCase();
    const mc = num(j.mcap) ?? num(j.fdv) ?? 0;
    return !NOT_MEME.has(sym) && !stockish(j) && !/USD|SOL$/.test(sym) && mc > 0 && mc < 5e9;
  });
  if (!toks.length) return null;
  const W: [FlowWin, keyof JupToken][] = [['m5', 'stats5m'], ['h1', 'stats1h'], ['h6', 'stats6h'], ['h24', 'stats24h']];
  const win = {} as MarketFlow['win'];
  for (const [k, f] of W) {
    let buy = 0, sell = 0, buys = 0, sells = 0, traders = 0;
    for (const j of toks) {
      const s = j[f] as JupStats | null | undefined;
      if (!s) continue;
      buy += Number(s.buyVolume) || 0; sell += Number(s.sellVolume) || 0;
      buys += Number(s.numBuys) || 0; sells += Number(s.numSells) || 0; traders += Number(s.numTraders) || 0;
    }
    win[k] = { buy, sell, net: buy - sell, buys, sells, traders };
  }
  const per = toks.map((j) => {
    const s = j.stats1h || {};
    const buy = Number(s.buyVolume) || 0, sell = Number(s.sellVolume) || 0;
    return { mint: j.id, sym: (j.symbol || '').slice(0, 16), icon: j.icon || null, mc: num(j.mcap) ?? num(j.fdv), net: buy - sell, buy, sell };
  });
  const by = [...per].sort((a, b) => b.net - a.net);

  // Market-cap bands over the same meme set.
  const mcOf = (j: JupToken) => num(j.mcap) ?? num(j.fdv) ?? 0;
  const buckets: FlowBucket[] = BANDS.map(([key, label, lo, hi]) => {
    const inBand = toks.filter((j) => { const m = mcOf(j); return m >= lo && m < hi; });
    return { key, label, n: inBand.length, w: sumWin(inBand) };
  });

  // Majors as they trade on Solana (SOL, wBTC, wETH, JUP...). Real buy/sell flow, not exchange netflow.
  const majToks = [...seen.values()].filter((j) => {
    const sym = String(j.symbol || '').toUpperCase();
    return NOT_MEME.has(sym) && !STABLE.has(sym) && !stockish(j) && mcOf(j) > 0;
  });
  const majPer = majToks.map((j) => {
    const s = j.stats1h || {};
    const buy = Number(s.buyVolume) || 0, sell = Number(s.sellVolume) || 0;
    return { mint: j.id, sym: (j.symbol || '').slice(0, 16), icon: j.icon || null, mc: num(j.mcap) ?? num(j.fdv), net: buy - sell, buy, sell };
  }).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  const majors: MajorsFlow = { n: majToks.length, w: sumWin(majToks), toks: majPer.slice(0, 8) };

  // Tuning data: the most-traded tokens this hour, with the features Heat decides on.
  const snap: TokenSnap[] = [...toks]
    .sort((a, b) => ((b.stats1h?.buyVolume || 0) + (b.stats1h?.sellVolume || 0)) - ((a.stats1h?.buyVolume || 0) + (a.stats1h?.sellVolume || 0)))
    .slice(0, 150)
    .map((j) => ({
      mint: j.id, sym: (j.symbol || '').slice(0, 16), mc: num(j.mcap) ?? num(j.fdv), price: num(j.usdPrice),
      liq: num(j.liquidity), holders: num(j.holderCount), organic: num(j.organicScore), launchpad: j.launchpad || null,
      buy5: Number(j.stats5m?.buyVolume) || 0, sell5: Number(j.stats5m?.sellVolume) || 0,
      buy1: Number(j.stats1h?.buyVolume) || 0, sell1: Number(j.stats1h?.sellVolume) || 0,
      chg5: num(j.stats5m?.priceChange), chg1: num(j.stats1h?.priceChange), chg24: num(j.stats24h?.priceChange),
    }));

  return {
    at: Date.now(), tokens: toks.length, win,
    topIn: by.filter((x) => x.net > 0).slice(0, 6), topOut: by.filter((x) => x.net < 0).reverse().slice(0, 6),
    buckets, majors, snap,
  };
}
