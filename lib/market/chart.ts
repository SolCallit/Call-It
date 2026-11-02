'use client';

import { CandlestickSeries, ColorType, HistogramSeries, LineStyle, createChart, createSeriesMarkers, type IChartApi, type IPriceLine, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import { fmtSmall } from '@/lib/market/client';

export type ChartTf = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
/** How often candles are re-pulled. Between pulls, tick() moves the last candle with the live price. */
const POLL: Record<ChartTf, number> = { '1m': 5e3, '5m': 10e3, '15m': 15e3, '1h': 30e3, '4h': 60e3, '1d': 120e3 };
const BUCKET: Record<ChartTf, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };

/** A level drawn across the chart (avg entry, TP, SL, limit). Price is raw USD per token. */
export type ChartLine = { price: number; title: string; color: string; dashed?: boolean };
/** A marker on a candle: your buys/sells and calls made on this token. Time is unix seconds. */
export type ChartMark = { time: number; kind: 'buy' | 'sell' | 'call'; text?: string; mine?: boolean };
export type ChartOverlay = { lines: ChartLine[]; marks: ChartMark[] };

/** Cleanup function, plus tick(price) to stream the live price into the newest candle,
 *  and overlay() to draw the user's own activity on top. */
export type LiveChart = (() => void) & { tick: (price: number) => void; overlay: (o: ChartOverlay) => void };

const css = (v: string, fb: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || fb;

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
    layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: text, fontSize: 11, attributionLogo: true },
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
  const markers = createSeriesMarkers(candles, []);
  let lines: IPriceLine[] = [];
  let ov: ChartOverlay | null = null;
  const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

  let first = true;
  let fails = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
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
      if (!list.length) { if (first && fails++ < 2) { retry = setTimeout(load, 2500); return; } opts.onState?.('empty'); return; }
      const f = opts.factor || 1;
      candles.setData(list.map(([t, o, h, l, c]) => ({ time: t as UTCTimestamp, open: o * f, high: h * f, low: l * f, close: c * f })));
      const z = list[list.length - 1];
      // Keep a live-ticked candle that is newer than what the API returned.
      if (last && last.time > z[0]) put(last);
      else last = { time: z[0], open: z[1], high: z[2], low: z[3], close: z[4] };
      vol.setData(list.map(([t, o, , , c, v]) => ({ time: t as UTCTimestamp, value: v, color: c >= o ? up + '66' : down + '66' })));
      if (first) chart.timeScale().fitContent();
      if (first && ov) drawMarks(ov);
      first = false;
      opts.onState?.('ok');
    } catch {
      // Upstream rate limits are common: retry quickly (1s, 2s, 4s...) and only show an error after a few misses.
      if (first) {
        fails++;
        if (fails <= 4) { retry = setTimeout(load, 1000 * 2 ** (fails - 1)); return; }
        opts.onState?.('error');
      }
    }
  };
  load();
  timer = setInterval(() => { if (!document.hidden) load(); }, POLL[opts.tf]);

  const size = BUCKET[opts.tf];
  const accent = css('--hi', '#4DA8FF');
  function drawMarks(o: ChartOverlay) {
    const ms: SeriesMarker<Time>[] = o.marks
      .filter((m) => m.time > 0)
      .sort((a, b) => a.time - b.time)
      .map((m) => ({
        time: (m.time - (m.time % size)) as UTCTimestamp,
        position: m.kind === 'buy' ? 'belowBar' : 'aboveBar',
        shape: m.kind === 'buy' ? 'arrowUp' : m.kind === 'sell' ? 'arrowDown' : 'circle',
        color: m.kind === 'buy' ? up : m.kind === 'sell' ? down : m.mine ? accent : text,
        text: m.text ?? (m.kind === 'buy' ? 'B' : m.kind === 'sell' ? 'S' : ''),
        size: m.kind === 'call' ? 0.8 : 1,
      }));
    try { markers.setMarkers(ms); } catch { /* torn down */ }
  }
  const overlay = (o: ChartOverlay) => {
    if (dead || !chart) return;
    ov = o;
    const f = opts.factor || 1;
    lines.forEach((l) => { try { candles.removePriceLine(l); } catch { /* gone */ } });
    lines = o.lines.filter((l) => l.price > 0 && Number.isFinite(l.price)).map((l) => candles.createPriceLine({
      price: l.price * f, color: l.color, lineWidth: 1, lineStyle: l.dashed === false ? LineStyle.Solid : LineStyle.Dashed,
      axisLabelVisible: true, title: l.title,
    }));
    drawMarks(o);
  };

  const stop = () => {
    dead = true;
    if (timer) clearInterval(timer);
    if (retry) clearTimeout(retry);
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
  return Object.assign(stop, { tick, overlay });
}
