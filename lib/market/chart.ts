'use client';

import { CandlestickSeries, ColorType, HistogramSeries, LineSeries, LineStyle, PriceScaleMode, createChart, createSeriesMarkers, type IChartApi, type IPriceLine, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
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
  opts: { pool: string; mint: string; tf: ChartTf; factor: number; sym?: string; mode?: 'mc' | 'price'; onState?: (s: 'loading' | 'ok' | 'empty' | 'error') => void },
): LiveChart {
  let chart: IChartApi | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let dead = false;
  const up = css('--up', '#22c55e'), down = css('--down', '#ef4444'), text = css('--muted', '#8fa6ba'), line = css('--line', '#1e3a54');

  chart = createChart(el, {
    autoSize: true,
    layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: text, fontSize: 11, attributionLogo: true },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.18, bottom: 0.22 } },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 6, minBarSpacing: 0.2 },
    crosshair: { mode: 0 },
    localization: { locale: 'en-US', priceFormatter: (v: number) => fmtSmall(v) },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true, axisDoubleClickReset: true },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
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
  // Every candle seen so far, by time. Polls merge into it; scrolling to the left edge loads older ones.
  const all = new Map<number, number[]>();
  const paint = () => {
    const f = opts.factor || 1;
    const list = [...all.values()].sort((a, b) => a[0] - b[0]);
    candles.setData(list.map(([t, o, h, l, c]) => ({ time: t as UTCTimestamp, open: o * f, high: h * f, low: l * f, close: c * f })));
    vol.setData(list.map(([t, o, , , c, v]) => ({ time: t as UTCTimestamp, value: v, color: c >= o ? up + '66' : down + '66' })));
    paintExtras(list);
  };
  let olderBusy = false, olderDone = false;
  const loadOlder = async () => {
    if (olderBusy || olderDone || dead || !chart || !all.size) return;
    olderBusy = true;
    try {
      const oldest = Math.min(...all.keys());
      const r = await fetch(`/api/market/chart?pool=${opts.pool}&mint=${opts.mint}&tf=${opts.tf}&before=${oldest}`);
      const list = r.ok ? (((await r.json()).candles || []) as number[][]).filter((c) => c[0] < oldest) : [];
      if (dead || !chart) return;
      if (!list.length) { olderDone = true; return; }
      const ts = chart.timeScale(), vr = ts.getVisibleLogicalRange();
      for (const c of list) all.set(c[0], c);
      paint();
      if (last) put(last);
      if (vr) ts.setVisibleLogicalRange({ from: vr.from + list.length, to: vr.to + list.length });
    } catch { /* try again on the next scroll */ } finally { olderBusy = false; }
  };
  let retry: ReturnType<typeof setTimeout> | null = null;
  // Newest candle in raw price units (before the MC factor), so ticks and reloads agree.
  let last: { time: number; open: number; high: number; low: number; close: number } | null = null;
  const put = (c: NonNullable<typeof last>) => {
    const f = opts.factor || 1;
    candles.update({ time: c.time as UTCTimestamp, open: c.open * f, high: c.high * f, low: c.low * f, close: c.close * f });
    try { lineS.update({ time: c.time as UTCTimestamp, value: c.close * f }); } catch { /* not ready */ }
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
      for (const c of list) all.set(c[0], c);
      paint();
      const z = list[list.length - 1];
      // Keep a live-ticked candle that is newer than what the API returned.
      if (last && last.time > z[0]) put(last);
      else last = { time: z[0], open: z[1], high: z[2], low: z[3], close: z[4] };
      if (first) { const n = all.size; if (n > 140) chart.timeScale().setVisibleLogicalRange({ from: n - 120, to: n + 6 }); else chart.timeScale().fitContent(); }
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
  // ---------- Terminal chrome: legend, chart type, indicators, drawing, ranges, scale modes ----------
  const card = el.closest('.chcard') as HTMLElement | null;
  const hi = css('--hi', '#4DA8FF');
  const store = (k: string, v?: string): string | null => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* private mode */ } return null; };
  const escH = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
  let ctype: 'candle' | 'line' = store('callit.ctype') === 'line' ? 'line' : 'candle';
  const IND: Record<string, boolean> = (() => { try { return { ma: false, ema: false, vol: true, ...JSON.parse(store('callit.cind') || '{}') }; } catch { return { ma: false, ema: false, vol: true }; } })();
  const pf = { type: 'custom' as const, formatter: (v: number) => fmtSmall(v), minMove: 1e-12 };
  const lineS = chart.addSeries(LineSeries, { color: hi, lineWidth: 2, priceFormat: pf, visible: ctype === 'line' });
  const maS = chart.addSeries(LineSeries, { color: '#F5B841', lineWidth: 1, priceFormat: pf, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: IND.ma });
  const emaS = chart.addSeries(LineSeries, { color: '#B07CFF', lineWidth: 1, priceFormat: pf, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: IND.ema });
  candles.applyOptions({ visible: ctype === 'candle' });
  vol.applyOptions({ visible: IND.vol });
  const legend = document.createElement('div');
  legend.className = 'clegend';
  el.appendChild(legend);
  const tfl = opts.tf === '1d' ? 'D' : opts.tf;
  const head = `<div class="clg1"><b>${escH(opts.sym || '')}/USD</b>${opts.mode === 'price' ? 'Price' : 'Market Cap'} · ${tfl} · Callit</div>`;
  const legendFor = (b: { open: number; high: number; low: number; close: number } | null, v: number | null) => {
    if (!b) { legend.innerHTML = head; return; }
    const d = b.close - b.open, p = b.open ? (d / b.open) * 100 : 0, c = d >= 0 ? 'up' : 'down';
    legend.innerHTML = head + `<div class="clg2">O<b class="${c}">${fmtSmall(b.open, false)}</b>H<b class="${c}">${fmtSmall(b.high, false)}</b>L<b class="${c}">${fmtSmall(b.low, false)}</b>C<b class="${c}">${fmtSmall(b.close, false)}</b><b class="${c}">${d >= 0 ? '+' : ''}${fmtSmall(d, false)} (${d >= 0 ? '+' : ''}${p.toFixed(2)}%)</b></div>`
      + (IND.vol && v != null ? `<div class="clg3">Volume<b>${fmtSmall(v, false)}</b></div>` : '');
  };
  const lastBar = () => {
    const f = opts.factor || 1, k = all.size ? Math.max(...all.keys()) : 0, c = all.get(k);
    const z = last && last.time >= k ? last : c ? { open: c[1], high: c[2], low: c[3], close: c[4] } : null;
    return z ? { b: { open: z.open * f, high: z.high * f, low: z.low * f, close: z.close * f }, v: c ? c[5] : null } : null;
  };
  chart.subscribeCrosshairMove((p) => {
    const b = p.time ? (p.seriesData.get(candles) as { open: number; high: number; low: number; close: number } | undefined) : undefined;
    const v = p.time ? (p.seriesData.get(vol) as { value: number } | undefined) : undefined;
    if (b && 'open' in b) legendFor(b, v ? v.value : null); else { const z = lastBar(); legendFor(z ? z.b : null, z ? z.v : null); }
  });
  const sma = (xs: number[][], n: number) => xs.map((_, i) => i < n - 1 ? null : xs.slice(i - n + 1, i + 1).reduce((a, c) => a + c[4], 0) / n);
  const ema = (xs: number[][], n: number) => { const k = 2 / (n + 1); let e: number | null = null; return xs.map((c, i) => { e = e == null ? c[4] : c[4] * k + e * (1 - k); return i < n - 1 ? null : e; }); };
  const paintExtras = (list: number[][]) => {
    const f = opts.factor || 1;
    lineS.setData(list.map((c) => ({ time: c[0] as UTCTimestamp, value: c[4] * f })));
    const put2 = (s: typeof maS, vals: (number | null)[]) => s.setData(list.map((c, i) => vals[i] == null ? { time: c[0] as UTCTimestamp } : { time: c[0] as UTCTimestamp, value: (vals[i] as number) * f }));
    put2(maS, IND.ma ? sma(list, 20) : []);
    put2(emaS, IND.ema ? ema(list, 50) : []);
    const z = lastBar(); legendFor(z ? z.b : null, z ? z.v : null);
  };
  // Horizontal lines you draw, saved per token (raw price, so they survive MC/Price switches).
  const hlKey = `callit.hl.${opts.mint}`;
  let hls: number[] = (() => { try { return (JSON.parse(store(hlKey) || '[]') as number[]).filter((x) => x > 0).slice(0, 20); } catch { return []; } })();
  let hlLines: IPriceLine[] = [];
  const drawHl = () => {
    hlLines.forEach((l) => { try { candles.removePriceLine(l); } catch { /* gone */ } });
    const f = opts.factor || 1;
    hlLines = hls.map((p) => candles.createPriceLine({ price: p * f, color: hi, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: '' }));
  };
  drawHl();
  let drawing = false;
  chart.subscribeClick((p) => {
    if (!drawing || !p.point) return;
    const v = candles.coordinateToPrice(p.point.y);
    drawing = false;
    card?.querySelector('[data-ch="hline"]')?.classList.remove('on');
    el.classList.remove('cdraw');
    if (v == null || !(Number(v) > 0)) return;
    hls = [...hls, Number(v) / (opts.factor || 1)].slice(-20);
    store(hlKey, JSON.stringify(hls));
    drawHl();
  });
  const syncBtns = () => {
    if (!card) return;
    const t = card.querySelector('[data-ch="type"]');
    if (t) t.innerHTML = ctype === 'line' ? '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 17l6-6 4 4 8-8"/></svg>' : '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3v4M7 17v4M17 3v2M17 15v6"/><rect x="5" y="7" width="4" height="10" rx="1"/><rect x="15" y="5" width="4" height="10" rx="1"/></svg>';
    const m = chart?.priceScale('right').options().mode;
    card.querySelector('[data-ch="pct"]')?.classList.toggle('on', m === PriceScaleMode.Percentage);
    card.querySelector('[data-ch="log"]')?.classList.toggle('on', m === PriceScaleMode.Logarithmic);
    card.querySelector('[data-ch="auto"]')?.classList.toggle('on', !!chart?.priceScale('right').options().autoScale);
    card.querySelector('[data-ch="ind"]')?.classList.toggle('on', IND.ma || IND.ema);
  };
  const indMenu = () => {
    const old = card?.querySelector('.cindm'); if (old) { old.remove(); return; }
    const rows: [string, string][] = [['ma', 'MA 20'], ['ema', 'EMA 50'], ['vol', 'Volume']];
    card?.insertAdjacentHTML('beforeend', `<div class="cindm" role="menu">${rows.map(([k, l]) => `<button data-ch="indt" data-f="${k}" class="${IND[k] ? 'on' : ''}" role="menuitemcheckbox" aria-checked="${IND[k]}"><i></i>${l}</button>`).join('')}</div>`);
  };
  const onClick = (e: Event) => {
    const b = (e.target as HTMLElement).closest('[data-ch]') as HTMLElement | null;
    if (!b || !card || !card.contains(b) || !chart) { if (!(e.target as HTMLElement).closest('.cindm')) card?.querySelector('.cindm')?.remove(); return; }
    const k = b.dataset.ch, ts = chart.timeScale(), ps = chart.priceScale('right');
    if (k !== 'ind' && k !== 'indt') card.querySelector('.cindm')?.remove();
    if (k === 'type') { ctype = ctype === 'line' ? 'candle' : 'line'; store('callit.ctype', ctype); candles.applyOptions({ visible: ctype === 'candle' }); lineS.applyOptions({ visible: ctype === 'line' }); }
    else if (k === 'ind') indMenu();
    else if (k === 'indt') {
      const f = b.dataset.f as string; IND[f] = !IND[f]; store('callit.cind', JSON.stringify(IND));
      b.classList.toggle('on', IND[f]); b.setAttribute('aria-checked', String(IND[f]));
      maS.applyOptions({ visible: IND.ma }); emaS.applyOptions({ visible: IND.ema }); vol.applyOptions({ visible: IND.vol });
      paintExtras([...all.values()].sort((a, c) => a[0] - c[0]));
    } else if (k === 'hline') { drawing = !drawing; b.classList.toggle('on', drawing); el.classList.toggle('cdraw', drawing); }
    else if (k === 'clear') { hls = []; store(hlKey, '[]'); drawHl(); }
    else if (k === 'shot') {
      const c = chart.takeScreenshot();
      c.toBlob((bl) => { if (!bl) return; const a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = `${(opts.sym || 'chart').replace(/[^\w-]/g, '')}-${opts.tf}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); });
    } else if (k === 'fs') { const on = !card.classList.contains('lfull'); card.classList.toggle('lfull', on); document.body.classList.toggle('lfull-on', on); b.classList.toggle('on', on); }
    else if (k === 'rng') { const s = Number(b.dataset.f) || 86400, now = Math.floor(Date.now() / 1000); try { ts.setVisibleRange({ from: (now - s) as UTCTimestamp, to: now as UTCTimestamp }); } catch { /* not enough data */ } if (all.size && Math.min(...all.keys()) > now - s) loadOlder(); }
    else if (k === 'pct') ps.applyOptions({ mode: ps.options().mode === PriceScaleMode.Percentage ? PriceScaleMode.Normal : PriceScaleMode.Percentage });
    else if (k === 'log') ps.applyOptions({ mode: ps.options().mode === PriceScaleMode.Logarithmic ? PriceScaleMode.Normal : PriceScaleMode.Logarithmic });
    else if (k === 'auto') ps.applyOptions({ autoScale: true });
    syncBtns();
  };
  card?.addEventListener('click', onClick);
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && card?.classList.contains('lfull')) { card.classList.remove('lfull'); document.body.classList.remove('lfull-on'); syncBtns(); } };
  document.addEventListener('keydown', onKey);
  const clk = card?.querySelector('.cclock') as HTMLElement | null;
  const tz = (() => { const o = -new Date().getTimezoneOffset() / 60; return `UTC${o >= 0 ? '+' : ''}${o}`; })();
  const tickClock = () => { if (clk) clk.textContent = `${new Date().toLocaleTimeString('en-GB', { hour12: false })} (${tz})`; };
  tickClock();
  const clock = setInterval(tickClock, 1000);
  setTimeout(syncBtns, 0);
  load();
  chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r && r.from < 30) loadOlder(); });
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
    clearInterval(clock);
    card?.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
    card?.classList.remove('lfull');
    document.body.classList.remove('lfull-on');
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
