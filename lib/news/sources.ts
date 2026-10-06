import 'server-only';

/**
 * News + social trending for the News page.
 * Everything is free and keyless by default. X and YouTube switch on only when their keys are set
 * (X_BEARER_TOKEN, YOUTUBE_API_KEY) because those APIs cost money or quota.
 * Each source fails on its own: one dead feed never empties the page.
 */

export type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;       // publisher or account, e.g. "CoinDesk", "r/CryptoCurrency"
  platform: Platform;   // where it lives, for the filter chips and icon
  kind: Kind;
  at: number;           // ms
  image?: string | null;
  summary?: string | null;
  score?: number | null; // upvotes / points / likes, when the platform has them
  comments?: number | null;
};
export type Kind = 'crypto' | 'economy' | 'global' | 'tech' | 'sports' | 'entertainment' | 'social';
export type Platform = 'news' | 'x' | 'reddit' | 'hackernews' | 'youtube' | 'bluesky' | 'coingecko' | 'google';

const UA = 'Mozilla/5.0 (compatible; CallitNews/1.0; +https://call-it-chi.vercel.app)';
const get = (url: string, init: RequestInit = {}, ms = 6000) =>
  fetch(url, { ...init, headers: { 'user-agent': UA, accept: '*/*', ...(init.headers || {}) }, signal: AbortSignal.timeout(ms), next: { revalidate: 300 } });

/* ---------- tiny RSS / Atom reader (no dependency) ---------- */
const decode = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
// Feeds often escape twice (&amp;#8217;), so decode, drop tags, decode again.
const strip = (s: string) => decode(decode(s).replace(/<[^>]+>/g, ' ')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (block: string, name: string) => { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return m ? m[1] : ''; };
const attr = (block: string, name: string, a: string) => { const m = block.match(new RegExp(`<${name}\\b[^>]*\\b${a}=["']([^"']+)["']`, 'i')); return m ? decode(m[1]) : ''; };

export function parseFeed(xml: string, source: string, kind: Kind, platform: Platform = 'news'): NewsItem[] {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return blocks.slice(0, 25).map((b) => {
    const title = strip(tag(b, 'title'));
    let url = strip(tag(b, 'link'));
    if (!/^https?:\/\//.test(url)) url = attr(b, 'link', 'href');
    const when = strip(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    const at = Date.parse(when) || Date.now();
    const img = attr(b, 'media:content', 'url') || attr(b, 'media:thumbnail', 'url') || attr(b, 'enclosure', 'url') || (decode(b).match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1] || null;
    const sum = strip(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 220) || null;
    return { id: `${source}:${url}`, title, url, source, platform, kind, at, image: img && /^https:\/\//.test(img) ? img : null, summary: sum };
  }).filter((x) => x.title && /^https?:\/\//.test(x.url));
}

async function rss(url: string, source: string, kind: Kind, platform: Platform = 'news') {
  const r = await get(url, { headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
  if (!r.ok) throw new Error(`${source} ${r.status}`);
  return parseFeed(await r.text(), source, kind, platform);
}

/* ---------- Recent: crypto + tech headlines ---------- */
const CRYPTO_FEEDS: [string, string][] = [
  ['https://www.coindesk.com/arc/outboundfeeds/rss/', 'CoinDesk'],
  ['https://cointelegraph.com/rss', 'Cointelegraph'],
  ['https://decrypt.co/feed', 'Decrypt'],
  ['https://www.theblock.co/rss.xml', 'The Block'],
  ['https://blockworks.co/feed', 'Blockworks'],
  ['https://solana.com/news/rss.xml', 'Solana'],
];
const TECH_FEEDS: [string, string][] = [
  ['https://techcrunch.com/feed/', 'TechCrunch'],
  ['https://www.theverge.com/rss/index.xml', 'The Verge'],
  ['https://feeds.arstechnica.com/arstechnica/index', 'Ars Technica'],
  ['https://techcabal.com/feed/', 'TechCabal'],
];
const ECONOMY_FEEDS: [string, string][] = [
  ['https://www.fxstreet.com/rss/news', 'FXStreet'],
  ['https://www.cnbc.com/id/20910258/device/rss/rss.html', 'CNBC Economy'],
  ['https://feeds.content.dowjones.io/public/rss/mw_topstories', 'MarketWatch'],
  ['https://finance.yahoo.com/news/rssindex', 'Yahoo Finance'],
  ['https://www.investing.com/rss/news_14.rss', 'Investing.com'],
];
const GLOBAL_FEEDS: [string, string][] = [
  ['https://feeds.bbci.co.uk/news/world/rss.xml', 'BBC World'],
  ['https://www.aljazeera.com/xml/rss/all.xml', 'Al Jazeera'],
  ['https://www.theguardian.com/world/rss', 'The Guardian'],
  ['https://rss.nytimes.com/services/xml/rss/nyt/World.xml', 'New York Times'],
];
const SPORTS_FEEDS: [string, string][] = [
  ['https://feeds.bbci.co.uk/sport/rss.xml', 'BBC Sport'],
  ['https://www.espn.com/espn/rss/news', 'ESPN'],
  ['https://www.skysports.com/rss/12040', 'Sky Sports'],
];
const ENT_FEEDS: [string, string][] = [
  ['https://variety.com/feed/', 'Variety'],
  ['https://www.billboard.com/feed/', 'Billboard'],
  ['https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', 'BBC Entertainment'],
];

/* ---------- Economic calendar (ForexFactory's public weekly export) ----------
 * Free, but limited to 2 downloads per 5 minutes per IP, so it's cached 15 minutes.
 * The export has forecast and previous values, not actual results. */
export type CalEvent = { id: string; title: string; country: string; at: number; impact: 'High' | 'Medium' | 'Low' | 'Holiday' | string; forecast: string; previous: string };
let CAL: { events: CalEvent[]; at: number } | null = null;
export async function getCalendar(): Promise<{ events: CalEvent[]; at: number; error?: string }> {
  if (CAL && Date.now() - CAL.at < 15 * 60_000) return CAL;
  try {
    const r = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000), next: { revalidate: 900 } });
    if (!r.ok) throw new Error(`ForexFactory ${r.status}`);
    const j = (await r.json()) as { title: string; country: string; date: string; impact: string; forecast?: string; previous?: string }[];
    const events = (Array.isArray(j) ? j : []).map((e, i) => ({
      id: `ff:${e.date}:${e.country}:${i}`, title: e.title, country: e.country, at: Date.parse(e.date) || 0, impact: e.impact,
      forecast: e.forecast || '', previous: e.previous || '',
    })).filter((e) => e.at).sort((a, b) => a.at - b.at);
    CAL = { events, at: Date.now() };
    return CAL;
  } catch (e) {
    console.warn('[calendar]', (e as Error).message);
    if (CAL) return CAL; // keep serving the last good copy when rate-limited
    return { events: [], at: Date.now(), error: 'The economic calendar is unavailable right now.' };
  }
}

async function hackerNews(): Promise<NewsItem[]> {
  const r = await get('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30');
  if (!r.ok) throw new Error(`HN ${r.status}`);
  const j = (await r.json()) as { hits: { objectID: string; title: string; url: string | null; points: number; num_comments: number; created_at_i: number; author: string }[] };
  return j.hits.filter((h) => h.title).map((h) => ({
    id: `hn:${h.objectID}`, title: h.title, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    source: 'Hacker News', platform: 'hackernews' as Platform, kind: 'tech' as const, at: h.created_at_i * 1000, score: h.points, comments: h.num_comments,
  }));
}

/* ---------- Trending: social platforms ---------- */
async function reddit(sub: string): Promise<NewsItem[]> {
  // JSON first; Reddit sometimes blocks cloud IPs on .json but still serves the RSS.
  try {
    const r = await get(`https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { data: { children: { data: { id: string; title: string; permalink: string; ups: number; num_comments: number; created_utc: number; stickied: boolean; thumbnail?: string; preview?: { images?: { source?: { url?: string } }[] } } }[] } };
    return j.data.children.map((c) => c.data).filter((d) => !d.stickied).map((d) => ({
      id: `rd:${d.id}`, title: d.title, url: `https://www.reddit.com${d.permalink}`, source: `r/${sub}`, platform: 'reddit' as Platform, kind: 'social' as const,
      at: d.created_utc * 1000, score: d.ups, comments: d.num_comments, image: d.preview?.images?.[0]?.source?.url || null,
    }));
  } catch {
    return rss(`https://www.reddit.com/r/${sub}/hot/.rss`, `r/${sub}`, 'social', 'reddit');
  }
}

async function coingecko(): Promise<NewsItem[]> {
  const r = await get('https://api.coingecko.com/api/v3/search/trending', { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
  const j = (await r.json()) as { coins: { item: { id: string; name: string; symbol: string; small?: string; market_cap_rank?: number; data?: { price_change_percentage_24h?: { usd?: number } } } }[] };
  const now = Date.now();
  return j.coins.slice(0, 15).map((c, i) => {
    const ch = c.item.data?.price_change_percentage_24h?.usd;
    return {
      id: `cg:${c.item.id}`, title: `$${c.item.symbol.toUpperCase()} (${c.item.name}) is #${i + 1} trending on CoinGecko${ch != null ? `, ${ch >= 0 ? 'up' : 'down'} ${Math.abs(ch).toFixed(1)}% in 24h` : ''}`,
      url: `https://www.coingecko.com/en/coins/${c.item.id}`, source: 'CoinGecko', platform: 'coingecko' as Platform, kind: 'social' as const, at: now - i * 1000, image: c.item.small || null,
    };
  });
}

async function googleTrends(): Promise<NewsItem[]> {
  const r = await get('https://trends.google.com/trending/rss?geo=US');
  if (!r.ok) throw new Error(`Google ${r.status}`);
  const xml = await r.text();
  return (xml.match(/<item\b[\s\S]*?<\/item>/gi) || []).slice(0, 20).map((b) => {
    const q = strip(tag(b, 'title')), traffic = strip(tag(b, 'ht:approx_traffic'));
    const newsUrl = strip(tag(b, 'ht:news_item_url'));
    return {
      id: `gt:${q}`, title: traffic ? `“${q}” is trending on Google · ${traffic} searches` : `“${q}” is trending on Google`,
      url: newsUrl && /^https?:/.test(newsUrl) ? newsUrl : `https://www.google.com/search?q=${encodeURIComponent(q)}`, source: 'Google Trends', platform: 'google' as Platform, kind: 'social' as const,
      at: Date.parse(strip(tag(b, 'pubDate'))) || Date.now(), image: strip(tag(b, 'ht:picture')) || null,
    };
  });
}

async function bluesky(): Promise<NewsItem[]> {
  const out: NewsItem[] = [];
  for (const q of ['crypto', 'solana', 'bitcoin']) {
    const r = await get(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${q}&sort=top&limit=10&lang=en`, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`Bluesky ${r.status}`);
    const j = (await r.json()) as { posts: { uri: string; author: { handle: string; displayName?: string }; record: { text: string; createdAt: string }; likeCount?: number; replyCount?: number }[] };
    for (const p of j.posts) {
      const rkey = p.uri.split('/').pop();
      out.push({ id: `bs:${p.uri}`, title: p.record.text.replace(/\s+/g, ' ').slice(0, 200), url: `https://bsky.app/profile/${p.author.handle}/post/${rkey}`,
        source: `@${p.author.handle}`, platform: 'bluesky', kind: 'social', at: Date.parse(p.record.createdAt) || Date.now(), score: p.likeCount ?? null, comments: p.replyCount ?? null });
    }
  }
  return out;
}

/** X: only with X_BEARER_TOKEN set. Pay-per-use (about $0.005 per post read), so it's cached 15 min. */
async function xPosts(): Promise<NewsItem[]> {
  const t = (process.env.X_BEARER_TOKEN || '').trim();
  if (!t) return [];
  const q = encodeURIComponent('(solana OR memecoin OR crypto OR $SOL OR bitcoin) -is:retweet -is:reply lang:en has:links');
  const r = await fetch(`https://api.x.com/2/tweets/search/recent?query=${q}&max_results=20&sort_order=relevancy&tweet.fields=created_at,public_metrics&expansions=author_id&user.fields=username,name`, {
    headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(6000), next: { revalidate: 900 },
  });
  if (!r.ok) throw new Error(`X ${r.status}`);
  const j = (await r.json()) as { data?: { id: string; text: string; created_at: string; author_id: string; public_metrics?: { like_count: number; reply_count: number } }[]; includes?: { users?: { id: string; username: string }[] } };
  const U = new Map((j.includes?.users || []).map((u) => [u.id, u.username]));
  return (j.data || []).map((p) => ({
    id: `x:${p.id}`, title: p.text.replace(/https:\/\/t\.co\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Post on X',
    url: `https://x.com/${U.get(p.author_id) || 'i'}/status/${p.id}`, source: `@${U.get(p.author_id) || 'x'}`, platform: 'x' as Platform, kind: 'social' as const,
    at: Date.parse(p.created_at) || Date.now(), score: p.public_metrics?.like_count ?? null, comments: p.public_metrics?.reply_count ?? null,
  }));
}

/** YouTube: only with YOUTUBE_API_KEY set (free quota; one search costs 100 of 10,000 daily units, so it's cached 30 min). */
async function youtube(): Promise<NewsItem[]> {
  const k = (process.env.YOUTUBE_API_KEY || '').trim();
  if (!k) return [];
  const since = new Date(Date.now() - 2 * 864e5).toISOString();
  const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=viewCount&maxResults=15&q=crypto%7Csolana%7Cmemecoin&publishedAfter=${since}&relevanceLanguage=en&key=${k}`, {
    signal: AbortSignal.timeout(6000), next: { revalidate: 1800 },
  });
  if (!r.ok) throw new Error(`YouTube ${r.status}`);
  const j = (await r.json()) as { items: { id: { videoId: string }; snippet: { title: string; channelTitle: string; publishedAt: string; thumbnails?: { medium?: { url: string } } } }[] };
  return j.items.map((v) => ({
    id: `yt:${v.id.videoId}`, title: decode(v.snippet.title), url: `https://www.youtube.com/watch?v=${v.id.videoId}`, source: v.snippet.channelTitle,
    platform: 'youtube' as Platform, kind: 'social' as const, at: Date.parse(v.snippet.publishedAt) || Date.now(), image: v.snippet.thumbnails?.medium?.url || null,
  }));
}

/* ---------- assembly + cache ---------- */
type Section = { items: NewsItem[]; sources: { name: string; platform: Platform; ok: boolean }[]; at: number };
const CACHE = new Map<string, Section>();
const TTL = 5 * 60_000;

async function gather(jobs: [string, Platform, () => Promise<NewsItem[]>][]): Promise<Section> {
  const res = await Promise.allSettled(jobs.map(([, , f]) => f()));
  const items: NewsItem[] = [], sources: Section['sources'] = [];
  res.forEach((r, i) => {
    const [name, platform] = jobs[i];
    const ok = r.status === 'fulfilled' && r.value.length > 0;
    if (r.status === 'rejected') console.warn('[news]', name, (r.reason as Error)?.message);
    if (r.status === 'fulfilled') items.push(...r.value);
    sources.push({ name, platform, ok });
  });
  const seen = new Set<string>();
  const dedup = items.filter((x) => { const k = x.title.toLowerCase().replace(/\W+/g, ' ').trim().slice(0, 80); if (seen.has(k) || seen.has(x.url)) return false; seen.add(k); seen.add(x.url); return true; });
  return { items: dedup, sources, at: Date.now() };
}

export async function getNews(tab: 'recent' | 'trending'): Promise<Section> {
  const hit = CACHE.get(tab);
  if (hit && Date.now() - hit.at < TTL) return hit;
  const sec = tab === 'recent'
    ? await gather([
        ...CRYPTO_FEEDS.map(([u, n]) => [n, 'news', () => rss(u, n, 'crypto')] as [string, Platform, () => Promise<NewsItem[]>]),
        ...TECH_FEEDS.map(([u, n]) => [n, 'news', () => rss(u, n, 'tech')] as [string, Platform, () => Promise<NewsItem[]>]),
        ...ECONOMY_FEEDS.map(([u, n]) => [n, 'news', () => rss(u, n, 'economy')] as [string, Platform, () => Promise<NewsItem[]>]),
        ...GLOBAL_FEEDS.map(([u, n]) => [n, 'news', () => rss(u, n, 'global')] as [string, Platform, () => Promise<NewsItem[]>]),
        ...SPORTS_FEEDS.map(([u, n]) => [n, 'news', () => rss(u, n, 'sports')] as [string, Platform, () => Promise<NewsItem[]>]),
        ...ENT_FEEDS.map(([u, n]) => [n, 'news', () => rss(u, n, 'entertainment')] as [string, Platform, () => Promise<NewsItem[]>]),
        ['Hacker News', 'hackernews', hackerNews],
      ])
    : await gather([
        ['X', 'x', xPosts],
        ['Reddit', 'reddit', async () => (await Promise.allSettled(['CryptoCurrency', 'solana', 'memecoins', 'technology'].map(reddit))).flatMap((r) => (r.status === 'fulfilled' ? r.value : []))],
        ['YouTube', 'youtube', youtube],
        ['Bluesky', 'bluesky', bluesky],
        ['Hacker News', 'hackernews', hackerNews],
        ['CoinGecko', 'coingecko', coingecko],
        ['Google Trends', 'google', googleTrends],
      ]);
  if (tab === 'recent') sec.items.sort((a, b) => b.at - a.at);
  else {
    // Trending: blend engagement with freshness so a 2-day-old viral post doesn't sit on top forever.
    const now = Date.now();
    const rank = (x: NewsItem) => Math.log10((x.score || 0) + (x.comments || 0) * 2 + 10) * 3 - (now - x.at) / 36e5 / 6;
    sec.items.sort((a, b) => rank(b) - rank(a));
  }
  const per = new Map<string, number>();
  sec.items = sec.items.filter((x) => { const n = (per.get(x.source) || 0) + 1; per.set(x.source, n); return n <= (tab === 'recent' ? 12 : 30); }).slice(0, tab === 'recent' ? 320 : 150);
  if (sec.items.length) CACHE.set(tab, sec);
  return sec;
}
