/**
 * Public-group guard. Runs on every message sent to a public group (DMs and private groups
 * are unrestricted). Pure function: no I/O, so it's easy to test and cheap to run.
 *
 * Blocks:
 *  - links to anywhere outside a short list of sites traders already trust (drainers live on
 *    look-alike domains, so "allow known, block the rest" beats chasing a blocklist)
 *  - invite links to other chats (t.me, discord) that pull people out of Callit into DMs
 *  - the classic wallet-drain lines: seed phrases, private keys, "verify/validate your wallet",
 *    "claim your airdrop", "DM me for…"
 *  - anything shaped like a Solana private key, so nobody can be talked into pasting one
 */

const TRUSTED = [
  'x.com', 'twitter.com', 'dexscreener.com', 'solscan.io', 'solana.fm', 'birdeye.so', 'pump.fun',
  'jup.ag', 'gmgn.ai', 'axiom.trade', 'rugcheck.xyz', 'bubblemaps.io', 'coingecko.com',
  'coinmarketcap.com', 'youtube.com', 'youtu.be', 'github.com', 'tradingview.com', 'meteora.ag',
  'raydium.io', 'orca.so', 'phantom.com', 'solflare.com', 'callit.buzz', 'www.callit.buzz', 'call-it-chi.vercel.app',
];

const TLDS = 'com|io|xyz|app|net|org|so|fun|ag|ai|trade|gg|me|co|link|site|online|live|cc|to|finance|money|pro|club|vip|top|info|biz|dev|sh|lol|meme|world|tech|network|exchange|claims?|gift|website|page';
const URL_RE = new RegExp(`\\b(?:https?:\\/\\/)?((?:[a-z0-9-]+\\.)+(?:${TLDS}))(?![a-z0-9-])(?:[\\/?#][^\\s]*)?`, 'gi');

const SCAM: RegExp[] = [
  /\b(seed|secret|recovery|mnemonic)\s*(phrase|words?|key)\b/i,
  /\bprivate\s*key\b/i,
  /\b(verify|validate|sync|rectify|restore|unlock)\s+(your\s+)?(wallet|account|tokens?)\b/i,
  /\bclaim\s+(your\s+)?(free\s+)?(airdrop|reward|tokens?|allocation)\b/i,
  /\b(dm|inbox|message)\s+me\s+(for|to)\b/i,
  /\bwallet\s*(connect|drainer)\b/i,
  /\b(double|2x)\s+your\s+(sol|money|crypto)\b/i,
  /\bsend\s+\d*\.?\d+\s*sol\s+(and|to)\s+(get|receive)\b/i,
];

const KEYISH = /\b[1-9A-HJ-NP-Za-km-z]{80,90}\b/;

export type GuardResult = { ok: true } | { ok: false; reason: 'link' | 'scam' | 'key'; detail?: string };

export function hostOf(raw: string): string {
  return raw.toLowerCase().replace(/^https?:\/\//, '').split(/[\/?#]/)[0].replace(/^www\./, '');
}

export function trustedHost(host: string, extra: string[] = []): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return [...TRUSTED, ...extra].some((t) => h === t || h.endsWith('.' + t));
}

/** GIFs picked from GIF search travel as [[gif:url]] and may only point at Tenor / GIPHY media. */
export const GIF_MARK = /\[\[gif:https:\/\/(?:media\d*\.tenor\.com|c\.tenor\.com|media\d*\.giphy\.com|i\.giphy\.com)\/[^\]\s|]+\]\]/g;

export function guardPublic(text: string, extraHosts: string[] = []): GuardResult {
  text = text.replace(GIF_MARK, ' ');
  if (KEYISH.test(text)) return { ok: false, reason: 'key' };
  for (const re of SCAM) if (re.test(text)) return { ok: false, reason: 'scam' };
  for (const m of text.matchAll(URL_RE)) {
    const host = hostOf(m[1]);
    if (!trustedHost(host, extraHosts)) return { ok: false, reason: 'link', detail: host };
  }
  return { ok: true };
}

/** Collapses whitespace and strips control characters. Returns '' for empty messages. */
export function cleanBody(v: unknown, max = 1000): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

/** True when the text carries any link at all (trusted or not). Used for the friends-only rule in DMs. */
export function hasLink(text: string): boolean {
  return [...text.replace(GIF_MARK, ' ').matchAll(URL_RE)].length > 0;
}
