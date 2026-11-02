'use client';


export async function fetchFeed(feed: string, interval = '1h') {
  const r = await fetch(`/api/market/list?feed=${feed}&interval=${interval}`);
  if (!r.ok) throw new Error(`feed_${r.status}`);
  return (await r.json()).tokens as unknown[];
}

export async function fetchToken(mint: string) {
  const r = await fetch(`/api/market/token/${mint}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`token_${r.status}`);
  return (await r.json()).token as unknown;
}

export async function fetchTokens(mints: string[]) {
  if (!mints.length) return [];
  const r = await fetch(`/api/market/tokens?mints=${mints.slice(0, 50).join(',')}`);
  if (!r.ok) throw new Error(`tokens_${r.status}`);
  return (await r.json()).tokens as unknown[];
}

export async function searchTokens(q: string) {
  const r = await fetch(`/api/market/search?q=${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  return (await r.json()).tokens as unknown[];
}

/** Compact money: $0.0₄5821, $412K, $1.84M. */
export function fmtSmall(v: number, money = true): string {
  const p = money ? '$' : '';
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return p + (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return p + (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return p + (v / 1e3).toFixed(1) + 'K';
  if (a >= 1) return p + v.toFixed(a >= 100 ? 0 : 2);
  if (a === 0) return p + '0';
  const zeros = Math.floor(-Math.log10(a));
  if (zeros < 4) return p + v.toFixed(zeros + 3);
  const sub = String(zeros - 1).split('').map((d) => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('');
  return `${p}0.0${sub}${Math.round(a * 10 ** (zeros + 3))}`;
}


export type { ChartTf, LiveChart, ChartLine, ChartMark, ChartOverlay } from '@/lib/market/chart';
