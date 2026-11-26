/**
 * $CALL airdrop rules. One place for the numbers the page, the API and the snapshot all use.
 * Dollar figures are examples at REF_MC only — the airdrop is denominated in tokens.
 */
export const SUPPLY = 1_000_000_000;
export const REF_MC = 500_000;
export const usdAtRef = (tokens: number) => (tokens / SUPPLY) * REF_MC;

export type Pool = 'community' | 'callit' | 'giveaway';

/** When each pool's claim opens (UTC). Checking is open as soon as the page is live. */
export const OPENS: Record<Pool, string> = {
  community: process.env.AIRDROP_OPEN_COMMUNITY || '2026-12-04T13:00:00Z',
  giveaway: process.env.AIRDROP_OPEN_GIVEAWAY || '2026-12-04T13:00:00Z',
  callit: process.env.AIRDROP_OPEN_CALLIT || '2026-12-11T13:00:00Z',
};
/** Callit activity counts toward the 15% pool until this moment. */
export const CALLIT_CUTOFF = process.env.AIRDROP_CALLIT_CUTOFF || '2026-12-10T22:59:00Z';
/** The $CALL mint, set at launch. Until then the "make a call" step waits. */
export const CALL_MINT = process.env.NEXT_PUBLIC_CALL_MINT || '';

export const POOLS: { id: Pool; label: string; pct: number; wallets: number; tiers: { ranks: string; count: number; tokens: number }[] }[] = [
  { id: 'community', label: 'Solana community holders', pct: 20, wallets: 2000, tiers: [
    { ranks: '1–40', count: 40, tokens: 200_000 }, { ranks: '41–100', count: 60, tokens: 120_000 },
    { ranks: '101–160', count: 60, tokens: 60_000 }, { ranks: '161–200', count: 40, tokens: 20_000 }] },
  { id: 'callit', label: 'Callit early community', pct: 15, wallets: 1000, tiers: [
    { ranks: '1–300', count: 300, tokens: 200_000 }, { ranks: '301–600', count: 300, tokens: 100_000 },
    { ranks: '601–800', count: 200, tokens: 50_000 }, { ranks: '801–1,000', count: 200, tokens: 20_000 }] },
  { id: 'giveaway', label: 'X giveaways', pct: 5, wallets: 1000, tiers: [
    { ranks: 'Top 50', count: 50, tokens: 200_000 }, { ranks: 'Next 150', count: 150, tokens: 100_000 },
    { ranks: 'Next 300', count: 300, tokens: 50_000 }, { ranks: 'Next 500', count: 500, tokens: 20_000 }] },
];

/** The ten eligible communities (top 200 holders each). Edit here; the page reads it from the API. */
export const COMMUNITIES = (process.env.AIRDROP_COMMUNITIES || 'JUP,PENGU,PUMP,RING,SKR,MET,KMNO,ANSEM,AKT,BACKPACK')
  .split(',').map((s) => s.trim()).filter(Boolean);

export const isWallet = (s: unknown): s is string => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
/** A post on X by this handle: x.com/<handle>/status/<id> (twitter.com accepted). */
export function xPost(url: string, handle?: string | null) {
  const m = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})/.exec(url.trim());
  if (!m) return null;
  if (handle && m[1].toLowerCase() !== handle.replace(/^@/, '').toLowerCase()) return null;
  return `https://x.com/${m[1]}/status/${m[2]}`;
}
