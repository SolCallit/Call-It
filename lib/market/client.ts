'use client';

import { CandlestickSeries, ColorType, HistogramSeries, createChart, type IChartApi, type UTCTimestamp } from 'lightweight-charts';

export type ChartTf = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
/** How often candles are re-pulled. Between pulls, tick() moves the last candle with the live price. */
const POLL: Record<ChartTf, number> = { '1m': 5e3, '5m': 10e3, '15m': 15e3, '1h': 30e3, '4h': 60e3, '1d': 120e3 };
const BUCKET: Record<ChartTf, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };

/** Cleanup function, plus tick(price) to stream the live price into the newest candle. */
export type LiveChart = (() => void) & { tick: (price: number) => void };

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

const css = (v: string, fb: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || fb;

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

/**
 * Live candlestick chart for a pool. `factor` turns price into market cap
 * (mc / price), so degens read the chart in MC like on pump.fun.
 * Returns a cleanup function.
 */
export function mountChart(
  el: HTMLElement,
  opts: { pool: string; mint: string; tf: ChartTf; factor: number; onState?: (s: 'loading' | 'ok' | 'empty' | 'error') => void },
): LiveChart {
  let chart: IChartApi | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let dead = false;
  const up = css('--up', '#22c55e'), down = css('--down', '#ef4444'), text = css('--muted', '#8fa6ba'), line = css('--line', '#1e3a54');

  chart = createChart(el, {
    autoSize: true,
    layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: text, fontSize: 11, attributionLogo: false },
    grid: { vertLines: { color: 'transparent' }, horzLines: { color: line } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.22 } },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4 },
    crosshair: { mode: 0 },
    localization: { locale: 'en-US', priceFormatter: (v: number) => fmtSmall(v) },
    handleScale: { axisPressedMouseMove: true },
  });
  const candles = chart.addSeries(CandlestickSeries, {
    upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down,
    priceFormat: { type: 'custom', formatter: (v: number) => fmtSmall(v), minMove: 1e-12 },
  });
  const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

  let first = true;
  // Newest candle in raw price units (before the MC factor), so ticks and reloads agree.
  let last: { time: number; open: number; high: number; low: number; close: number } | null = null;
  const put = (c: NonNullable<typeof last>) => {
    const f = opts.factor || 1;
    candles.update({ time: c.time as UTCTimestamp, open: c.open * f, high: c.high * f, low: c.low * f, close: c.close * f });
  };
  const load = async () => {
    if (first) opts.onState?.('loading');
    try {
      const r = await fetch(`/api/market/chart?pool=${opts.pool}&mint=${opts.mint}&tf=${opts.tf}`);
      if (dead) return;
      if (!r.ok) throw new Error(String(r.status));
      const list = ((await r.json()).candles || []) as number[][];
      if (dead || !chart) return;
      if (!list.length) { opts.onState?.('empty'); return; }
      const f = opts.factor || 1;
      candles.setData(list.map(([t, o, h, l, c]) => ({ time: t as UTCTimestamp, open: o * f, high: h * f, low: l * f, close: c * f })));
      const z = list[list.length - 1];
      // Keep a live-ticked candle that is newer than what the API returned.
      if (last && last.time > z[0]) put(last);
      else last = { time: z[0], open: z[1], high: z[2], low: z[3], close: z[4] };
      vol.setData(list.map(([t, o, , , c, v]) => ({ time: t as UTCTimestamp, value: v, color: c >= o ? up + '66' : down + '66' })));
      if (first) chart.timeScale().fitContent();
      first = false;
      opts.onState?.('ok');
    } catch {
      if (first) opts.onState?.('error');
    }
  };
  load();
  timer = setInterval(() => { if (!document.hidden) load(); }, POLL[opts.tf]);

  const stop = () => {
    dead = true;
    if (timer) clearInterval(timer);
    chart?.remove();
    chart = null;
  };
  const tick = (price: number) => {
    if (dead || !chart || !last || !(price > 0)) return;
    const size = BUCKET[opts.tf], now = Math.floor(Date.now() / 1000), bucket = now - (now % size);
    if (bucket > last.time) last = { time: bucket, open: last.close, high: Math.max(last.close, price), low: Math.min(last.close, price), close: price };
    else last = { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price };
    try { put(last); } catch { /* chart was torn down mid-tick */ }
  };
  return Object.assign(stop, { tick });
}
