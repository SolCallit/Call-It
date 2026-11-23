'use client';

import { CandlestickSeries, ColorType, HistogramSeries, LineSeries, LineStyle, PriceScaleMode, createChart, createSeriesMarkers, type IChartApi, type IPriceLine, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import { fmtSmall } from '@/lib/market/client';
import { mountDrawings, type DrawingsApi } from '@/lib/market/draw';

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
export type LiveChart = (() => void) & { tick: (price: number) => void; overlay: (o: ChartOverlay) => void; wake: () => void };

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
  const pref = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
  // Which side the price scale sits on, and the small display switches from the scale menu.
  let side: 'left' | 'right' = pref('callit.cside') === 'left' ? 'left' : 'right';
  const SP: { cd: boolean; pl: boolean } = (() => { try { return { cd: true, pl: true, ...JSON.parse(pref('callit.cscale') || '{}') }; } catch { return { cd: true, pl: true }; } })();
  const scaleOpts = { borderVisible: false, scaleMargins: { top: 0.18, bottom: 0.22 } };

  chart = createChart(el, {
    autoSize: true,
    layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: text, fontSize: 11, attributionLogo: true },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    rightPriceScale: { ...scaleOpts, visible: side === 'right' },
    leftPriceScale: { ...scaleOpts, visible: side === 'left' },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 6, minBarSpacing: 0.2 },
    crosshair: { mode: 0 },
    localization: { locale: 'en-US', priceFormatter: (v: number) => (v < 0 ? '' : fmtSmall(v)) },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true, axisDoubleClickReset: true },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
  });
  const candles = chart.addSeries(CandlestickSeries, {
    priceScaleId: side, priceLineVisible: SP.pl,
    upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down,
    priceFormat: { type: 'custom', formatter: (v: number) => (v < 0 ? '' : fmtSmall(v)), minMove: 1e-12 },
  });
  const markers = createSeriesMarkers(candles, []);
  let lines: IPriceLine[] = [];
  let ov: ChartOverlay | null = null;
  const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

  let first = true;
  let fails = 0;
  /* Candles come from GeckoTerminal, the live tick from DexScreener/Jupiter. They can disagree by a few %
     (different pool, lag). Ticking that gap straight into the last candle drew a fake cliff, so after each
     candle pull the first live tick rescales the history onto the live price (only small gaps: a real move
     bigger than CAL_MAX is left alone). */
  const CAL_MAX = 0.06;
  let k = 1, needCal = false, apiClose = 0;
  const F = () => (opts.factor || 1) * k;
  let barsCache: number[][] = [];
  // Every candle seen so far, by time. Polls merge into it; scrolling to the left edge loads older ones.
  const all = new Map<number, number[]>();
  const paint = () => {
    const f = F();
    const list = [...all.values()].sort((a, b) => a[0] - b[0]);
    barsCache = list;
    candles.setData(list.map(([t, o, h, l, c]) => ({ time: t as UTCTimestamp, open: o * f, high: h * f, low: l * f, close: c * f })));
    vol.setData(list.map(([t, o, , , c, v]) => ({ time: t as UTCTimestamp, value: v, color: c >= o ? up + '66' : down + '66' })));
    paintExtras(list);
    if (typeof placeUi === 'function') placeUi();
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
    const f = F();
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
      apiClose = z[4]; needCal = true;
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
  const pf = { type: 'custom' as const, formatter: (v: number) => (v < 0 ? '' : fmtSmall(v)), minMove: 1e-12 };
  const lineS = chart.addSeries(LineSeries, { priceScaleId: side, color: hi, lineWidth: 2, priceFormat: pf, priceLineVisible: SP.pl, visible: ctype === 'line' });
  const maS = chart.addSeries(LineSeries, { priceScaleId: side, color: '#F5B841', lineWidth: 1, priceFormat: pf, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: IND.ma });
  const emaS = chart.addSeries(LineSeries, { priceScaleId: side, color: '#B07CFF', lineWidth: 1, priceFormat: pf, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: IND.ema });
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
    const f = F(), k = all.size ? Math.max(...all.keys()) : 0, c = all.get(k);
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
    const f = F();
    lineS.setData(list.map((c) => ({ time: c[0] as UTCTimestamp, value: c[4] * f })));
    const put2 = (s: typeof maS, vals: (number | null)[]) => s.setData(list.map((c, i) => vals[i] == null ? { time: c[0] as UTCTimestamp } : { time: c[0] as UTCTimestamp, value: (vals[i] as number) * f }));
    put2(maS, IND.ma ? sma(list, 20) : []);
    put2(emaS, IND.ema ? ema(list, 50) : []);
    const z = lastBar(); legendFor(z ? z.b : null, z ? z.v : null);
  };
  // Drawing tools (left toolbar, TradingView style). Drawings sit on whichever series is showing.
  const dwBars = () => {
    const b = barsCache; if (!last || !b.length || last.time <= b[b.length - 1][0]) return b;
    return [...b, [last.time, last.open, last.high, last.low, last.close, 0]];
  };
  let dwCache: number[][] = [], dwKey = '';
  const dwBarsMemo = () => { const k = barsCache.length + ':' + (last ? last.time : 0); if (k !== dwKey) { dwKey = k; dwCache = dwBars(); } return dwCache; };
  const setUndo = (u: boolean, r: boolean) => { card?.querySelector('[data-ch="undo"]')?.toggleAttribute('disabled', !u); card?.querySelector('[data-ch="redo"]')?.toggleAttribute('disabled', !r); };
  let dw: DrawingsApi | null = null;
  try {
    dw = mountDrawings(el, card, chart, () => (ctype === 'line' ? lineS : candles), {
      mint: opts.mint, bucket: BUCKET[opts.tf], factor: F, side: () => side, bars: dwBarsMemo,
      fmt: (v: number) => fmtSmall(v), onUndoState: setUndo,
    });
  } catch (e) { console.warn('[chart] drawings', e); }
  const syncBtns = (menu = true) => {
    if (!card) return;
    const t = card.querySelector('[data-ch="type"]');
    if (t) t.innerHTML = ctype === 'line' ? '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 17l6-6 4 4 8-8"/></svg>' : '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3v4M7 17v4M17 3v2M17 15v6"/><rect x="5" y="7" width="4" height="10" rx="1"/><rect x="15" y="5" width="4" height="10" rx="1"/></svg>';
    const o = chart?.priceScale(side).options(), m = o?.mode;
    const set = (k: string, on: boolean) => card.querySelectorAll(`[data-ch="${k}"]`).forEach((x) => x.classList.toggle('on', on));
    set('pct', m === PriceScaleMode.Percentage);
    set('log', m === PriceScaleMode.Logarithmic);
    set('auto', !!o?.autoScale);
    if (menu && card.querySelector('.cscalem')) scaleMenu(true);
    card.querySelector('[data-ch="ind"]')?.classList.toggle('on', IND.ma || IND.ema);
  };
  const indMenu = () => {
    const old = card?.querySelector('.cindm'); if (old) { old.remove(); return; }
    const rows: [string, string][] = [['ma', 'MA 20'], ['ema', 'EMA 50'], ['vol', 'Volume']];
    card?.insertAdjacentHTML('beforeend', `<div class="cindm" role="menu">${rows.map(([k, l]) => `<button data-ch="indt" data-f="${k}" class="${IND[k] ? 'on' : ''}" role="menuitemcheckbox" aria-checked="${IND[k]}"><i></i>${l}</button>`).join('')}</div>`);
  };
  const onClick = (e: Event) => {
    const b = (e.target as HTMLElement).closest('[data-ch]') as HTMLElement | null;
    if (!b || !card || !card.contains(b) || !chart) { const t = e.target as HTMLElement; if (!t.closest('.cindm')) card?.querySelector('.cindm')?.remove(); if (!t.closest('.cscalem')) card?.querySelector('.cscalem')?.remove(); return; }
    const k = b.dataset.ch as string, ts = chart.timeScale(), ps = chart.priceScale(side);
    if (k !== 'ind' && k !== 'indt') card.querySelector('.cindm')?.remove();
    if (!/^s/.test(k)) card.querySelector('.cscalem')?.remove();
    if (scaleAct(k, b.dataset.f)) {
      // Picks close the menu; on/off switches keep it open so you can flip several.
      if (k === 'sreset' || k === 'sside' || k === 'smode') card.querySelector('.cscalem')?.remove();
      syncBtns(); return;
    }
    if (k === 'type') { ctype = ctype === 'line' ? 'candle' : 'line'; store('callit.ctype', ctype); candles.applyOptions({ visible: ctype === 'candle' }); lineS.applyOptions({ visible: ctype === 'line' }); }
    else if (k === 'ind') indMenu();
    else if (k === 'indt') {
      const f = b.dataset.f as string; IND[f] = !IND[f]; store('callit.cind', JSON.stringify(IND));
      b.classList.toggle('on', IND[f]); b.setAttribute('aria-checked', String(IND[f]));
      maS.applyOptions({ visible: IND.ma }); emaS.applyOptions({ visible: IND.ema }); vol.applyOptions({ visible: IND.vol });
      paintExtras([...all.values()].sort((a, c) => a[0] - c[0]));
    } else if (k === 'dwbar' || k === 'hline') dw?.toggleBar();
    else if (k === 'undo') dw?.undo();
    else if (k === 'redo') dw?.redo();
    else if (k === 'shot') {
      const c = chart.takeScreenshot();
      c.toBlob((bl) => { if (!bl) return; const a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = `${(opts.sym || 'chart').replace(/[^\w-]/g, '')}-${opts.tf}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); });
    } else if (k === 'fs') { const on = !card.classList.contains('lfull'); card.classList.toggle('lfull', on); document.body.classList.toggle('lfull-on', on); b.classList.toggle('on', on); }
    else if (k === 'rng' && b.dataset.f === 'all') ts.fitContent();
    else if (k === 'rng') { const s = Number(b.dataset.f) || 86400, now = Math.floor(Date.now() / 1000); try { ts.setVisibleRange({ from: (now - s) as UTCTimestamp, to: now as UTCTimestamp }); } catch { /* not enough data */ } if (all.size && Math.min(...all.keys()) > now - s) loadOlder(); }
    else if (k === 'pct') ps.applyOptions({ mode: ps.options().mode === PriceScaleMode.Percentage ? PriceScaleMode.Normal : PriceScaleMode.Percentage });
    else if (k === 'log') ps.applyOptions({ mode: ps.options().mode === PriceScaleMode.Logarithmic ? PriceScaleMode.Normal : PriceScaleMode.Logarithmic });
    else if (k === 'auto') ps.applyOptions({ autoScale: true });
    syncBtns();
  };
  // ---------- Price scale menu, axis buttons, zoom/scroll buttons, countdown, resize ----------
  const MODES: [number, string, string][] = [[PriceScaleMode.Normal, 'Regular', ''], [PriceScaleMode.Percentage, 'Percent', 'Alt + P'], [PriceScaleMode.IndexedTo100, 'Indexed to 100', ''], [PriceScaleMode.Logarithmic, 'Logarithmic', 'Alt + L']];
  const saveSP = () => { try { localStorage.setItem('callit.cscale', JSON.stringify(SP)); } catch { /* private mode */ } };
  const scaleMenu = (refresh = false) => {
    const old = card?.querySelector('.cscalem');
    if (old && !refresh) { old.remove(); return; }
    if (!chart || !card) return;
    const o = chart.priceScale(side).options(), ck = (on: boolean) => `<i class="${on ? 'on' : ''}"></i>`;
    const row = (ch: string, label: string, on: boolean | null, key = '', f = '') => `<button data-ch="${ch}"${f ? ` data-f="${f}"` : ''} role="menuitem${on == null ? '' : 'checkbox'}"${on == null ? '' : ` aria-checked="${on}"`}>${on == null ? '<i></i>' : ck(on)}<span>${label}</span>${key ? `<kbd>${key}</kbd>` : ''}</button>`;
    const html = `<div class="cscalem ${side}" role="menu" aria-label="Price scale">`
      + row('sreset', 'Reset price scale', null, 'Alt + R')
      + '<hr>' + row('sauto', 'Auto (fits data to screen)', !!o.autoScale) + row('sinv', 'Invert scale', !!o.invertScale, 'Alt + I')
      + '<hr>' + MODES.map(([m, l, key]) => row('smode', l, o.mode === m, key, String(m))).join('')
      + '<hr>' + row('sside', side === 'right' ? 'Move scale to left' : 'Move scale to right', null)
      + row('scd', 'Countdown to bar close', SP.cd) + row('spl', 'Last price line', SP.pl) + row('svol', 'Volume', !!IND.vol)
      + '</div>';
    // The menu lives on the card, not inside the chart, so a short chart never clips it.
    if (old) old.outerHTML = html; else card.insertAdjacentHTML('beforeend', html);
    const m = card.querySelector('.cscalem') as HTMLElement | null;
    if (m) m.style.top = el.offsetTop + 8 + 'px';
  };
  const moveSide = () => {
    if (!chart) return;
    const was = chart.priceScale(side).options();
    side = side === 'right' ? 'left' : 'right';
    try { localStorage.setItem('callit.cside', side); } catch { /* private mode */ }
    [candles, lineS, maS, emaS].forEach((x) => x.applyOptions({ priceScaleId: side }));
    chart.applyOptions({ rightPriceScale: { visible: side === 'right' }, leftPriceScale: { visible: side === 'left' } });
    chart.priceScale(side).applyOptions({ mode: was.mode, invertScale: was.invertScale, autoScale: was.autoScale });
    el.classList.toggle('cleft', side === 'left');
  };
  /** Price-scale actions shared by the menu, the A / L buttons and Alt shortcuts. Returns true when handled. */
  const scaleAct = (k: string, f?: string): boolean => {
    if (!chart) return false;
    const ps = chart.priceScale(side), o = ps.options();
    if (k === 'smenu') { scaleMenu(); return true; }
    if (k === 'sreset') ps.applyOptions({ autoScale: true, invertScale: false, mode: PriceScaleMode.Normal });
    else if (k === 'sauto') ps.applyOptions({ autoScale: !o.autoScale });
    else if (k === 'sinv') ps.applyOptions({ invertScale: !o.invertScale });
    else if (k === 'smode') { const m = Number(f); ps.applyOptions({ mode: o.mode === m && m !== PriceScaleMode.Normal ? PriceScaleMode.Normal : m }); }
    else if (k === 'sside') moveSide();
    else if (k === 'scd') { SP.cd = !SP.cd; saveSP(); }
    else if (k === 'spl') { SP.pl = !SP.pl; saveSP(); candles.applyOptions({ priceLineVisible: SP.pl }); lineS.applyOptions({ priceLineVisible: SP.pl }); }
    else if (k === 'svol') { IND.vol = !IND.vol; store('callit.cind', JSON.stringify(IND)); vol.applyOptions({ visible: IND.vol }); }
    else if (k === 'zin' || k === 'zout') {
      const ts = chart.timeScale(), r = ts.getVisibleLogicalRange(); if (!r) return true;
      const w = r.to - r.from, nw = Math.max(8, w * (k === 'zin' ? 0.75 : 1.35)), c = r.to - w / 2;
      ts.setVisibleLogicalRange({ from: c - nw / 2, to: c + nw / 2 });
    } else if (k === 'pl' || k === 'pr') {
      const ts = chart.timeScale(), r = ts.getVisibleLogicalRange(); if (!r) return true;
      const d = (r.to - r.from) * 0.25 * (k === 'pl' ? -1 : 1);
      ts.setVisibleLogicalRange({ from: r.from + d, to: r.to + d });
    } else if (k === 'zreset') {
      const n = all.size; ps.applyOptions({ autoScale: true });
      if (n > 140) chart.timeScale().setVisibleLogicalRange({ from: n - 120, to: n + 6 }); else chart.timeScale().fitContent();
    } else return false;
    placeUi();
    return true;
  };
  el.classList.toggle('cleft', side === 'left');
  el.insertAdjacentHTML('beforeend', `<div class="cnavb" aria-label="Zoom and scroll">`
    + `<button data-ch="zout" title="Zoom out" aria-label="Zoom out"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/></svg></button>`
    + `<button data-ch="zin" title="Zoom in" aria-label="Zoom in"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14M12 5v14"/></svg></button>`
    + `<button data-ch="pl" title="Scroll left" aria-label="Scroll left"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button>`
    + `<button data-ch="pr" title="Scroll right" aria-label="Scroll right"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></button>`
    + `<button data-ch="zreset" title="Reset chart" aria-label="Reset chart"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v5h5"/></svg></button></div>`
    + `<div class="caxb"><button data-ch="auto" title="Auto scale (fits data to screen)">A</button><button data-ch="log" title="Logarithmic scale (Alt + L)">L</button></div>`
    + `<button class="cgear" data-ch="smenu" title="Price scale settings" aria-label="Price scale settings" aria-haspopup="menu"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2.5l2 2.2 3-.5.9 2.9 2.6 1.5-.9 2.9.9 2.9-2.6 1.5-.9 2.9-3-.5-2 2.2-2-2.2-3 .5-.9-2.9L3.5 15l.9-2.9-.9-2.9 2.6-1.5.9-2.9 3 .5z"/></svg></button>`
    + `<div class="ccd" aria-hidden="true"></div>`);
  const ccd = el.querySelector('.ccd') as HTMLElement, cnav = el.querySelector('.cnavb') as HTMLElement;
  const axb = el.querySelector('.caxb') as HTMLElement, gear = el.querySelector('.cgear') as HTMLElement;
  // Keep the overlay buttons glued to the price axis and the time axis as they change size.
  // Axis sizes can be briefly unknown while a scale is being moved; treat that as zero.
  const axisW = () => { try { return chart ? chart.priceScale(side).width() : 0; } catch { return 0; } };
  const axisH = () => { try { return chart ? chart.timeScale().height() : 0; } catch { return 0; } };
  function placeUi() {
    if (!chart || dead) return;
    try { placeUiNow(); } catch { /* chart is between layouts; the next tick fixes it */ }
  }
  function placeUiNow() {
    if (!chart) return;
    const aw = axisW(), th = axisH();
    const at = side === 'right' ? 'right' : 'left', other = side === 'right' ? 'left' : 'right';
    gear.style.setProperty(at, '0px'); gear.style.removeProperty(other); gear.style.width = aw + 'px'; gear.style.height = th + 'px';
    axb.style.setProperty(at, '0px'); axb.style.removeProperty(other); axb.style.width = aw + 'px'; axb.style.bottom = th + 4 + 'px';
    cnav.style.bottom = th + 12 + 'px'; cnav.style.left = side === 'left' ? `calc(50% + ${aw / 2}px)` : `calc(50% - ${aw / 2}px)`;
    // Countdown to bar close, tucked under the live price label like TradingView.
    const lb = lastBar();
    const y = lb ? candles.priceToCoordinate(lb.b.close) : null;
    if (!SP.cd || !lb || y == null || ctype !== 'candle' || y < 0 || y > el.clientHeight - th - 10) { ccd.style.display = 'none'; return; }
    const size = BUCKET[opts.tf], now = Math.floor(Date.now() / 1000), rem = size - (now % size);
    const hh = Math.floor(rem / 3600), mm = Math.floor((rem % 3600) / 60), ss = rem % 60, p2 = (n: number) => String(n).padStart(2, '0');
    ccd.textContent = hh ? `${hh}:${p2(mm)}:${p2(ss)}` : `${p2(mm)}:${p2(ss)}`;
    ccd.style.display = 'block'; ccd.style.top = Math.round(y + 9) + 'px'; ccd.style.width = aw + 'px';
    ccd.style.setProperty(at, '0px'); ccd.style.removeProperty(other);
    ccd.style.background = lb.b.close >= lb.b.open ? up : down;
  }
  chart.timeScale().subscribeSizeChange(() => placeUi());
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => placeUi());
  // Touch: the price axis is drag-to-stretch (like TradingView). The chart lets the page scroll on
  // vertical swipes everywhere else, so vertical drag is switched on only while a finger is on the axis.
  const tbl = () => el.querySelector('table') as HTMLTableElement | null;
  const touchStyles = () => {
    const t = tbl(); if (!t) return;
    [...t.rows].forEach((r, i) => [...r.cells].forEach((c, j) => {
      const last = i === t.rows.length - 1, axis = j !== 1;
      (c as HTMLElement).style.touchAction = last ? 'pan-y' : axis ? 'none' : 'pan-y';
    }));
  };
  touchStyles(); setTimeout(touchStyles, 300);
  let shown: ReturnType<typeof setTimeout> | null = null;
  const onTouchStart = (e: TouchEvent) => {
    if (!chart) return;
    touchStyles();
    const t = e.touches[0], r = el.getBoundingClientRect(), aw = axisW(), th = axisH();
    const onAxis = t && t.clientY < r.bottom - th && (side === 'right' ? t.clientX > r.right - aw : t.clientX < r.left + aw);
    chart.applyOptions({ handleScroll: { vertTouchDrag: !!onAxis || card?.classList.contains('lfull') } });
    el.classList.add('ctouch'); if (shown) clearTimeout(shown);
  };
  const onTouchEnd = () => {
    if (!chart) return;
    if (!card?.classList.contains('lfull')) chart.applyOptions({ handleScroll: { vertTouchDrag: false } });
    if (shown) clearTimeout(shown);
    shown = setTimeout(() => el.classList.remove('ctouch'), 3500);
    syncBtns(false); placeUi();
  };
  el.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  el.addEventListener('touchend', onTouchEnd, { passive: true });
  el.addEventListener('touchcancel', onTouchEnd, { passive: true });
  const onUp = () => { syncBtns(false); placeUi(); };
  el.addEventListener('mouseup', onUp);
  // Drag the grip under the chart to make it taller or shorter. Double-click puts it back.
  const grip = document.createElement('div');
  grip.className = 'chgrip'; grip.title = 'Drag to resize the chart'; grip.setAttribute('role', 'separator'); grip.setAttribute('aria-orientation', 'horizontal');
  el.after(grip);
  const savedH = Number(pref('callit.chh'));
  if (savedH >= 200) el.style.height = savedH + 'px';
  let drag: { y: number; h: number } | null = null;
  grip.addEventListener('pointerdown', (e) => { drag = { y: e.clientY, h: el.getBoundingClientRect().height / (parseFloat(document.body.style.zoom) || 1) }; grip.setPointerCapture(e.pointerId); grip.classList.add('on'); e.preventDefault(); });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const z = parseFloat(document.body.style.zoom) || 1;
    const h = Math.round(Math.min(Math.max(drag.h + (e.clientY - drag.y) / z, 200), (window.innerHeight / z) * 0.85));
    el.style.height = h + 'px';
  });
  const endDrag = () => { if (!drag) return; drag = null; grip.classList.remove('on'); try { localStorage.setItem('callit.chh', String(Math.round(parseFloat(el.style.height)))); } catch { /* private mode */ } };
  grip.addEventListener('pointerup', endDrag); grip.addEventListener('pointercancel', endDrag);
  grip.addEventListener('dblclick', () => { el.style.height = ''; try { localStorage.removeItem('callit.chh'); } catch { /* private mode */ } });
  // Alt shortcuts while the pointer is over the chart: R reset scale, I invert, P percent, L log.
  let over = false;
  const onEnter = () => { over = true; }, onLeave = () => { over = false; };
  card?.addEventListener('mouseenter', onEnter); card?.addEventListener('mouseleave', onLeave);
  const onAlt = (e: KeyboardEvent) => {
    if (!e.altKey || !over || !chart) return;
    const k = e.key.toLowerCase(), map: Record<string, [string, string?]> = { r: ['sreset'], i: ['sinv'], p: ['smode', String(PriceScaleMode.Percentage)], l: ['smode', String(PriceScaleMode.Logarithmic)] };
    const a = map[k]; if (!a) return;
    e.preventDefault(); scaleAct(a[0], a[1]); syncBtns();
  };
  document.addEventListener('keydown', onAlt);
  card?.addEventListener('click', onClick);
  const onDocDown = (e: Event) => { const t = e.target as Node; if (card && !card.contains(t)) card.querySelector('.cscalem')?.remove(); };
  document.addEventListener('pointerdown', onDocDown, true);
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && card?.classList.contains('lfull')) { card.classList.remove('lfull'); document.body.classList.remove('lfull-on'); syncBtns(); } };
  document.addEventListener('keydown', onKey);
  const clk = card?.querySelector('.cclock') as HTMLElement | null;
  const tz = (() => { const o = -new Date().getTimezoneOffset() / 60; return `UTC${o >= 0 ? '+' : ''}${o}`; })();
  const tickClock = () => { if (clk) clk.textContent = `${new Date().toLocaleTimeString('en-GB', { hour12: false })} (${tz})`; placeUi(); };
  tickClock();
  const clock = setInterval(tickClock, 1000);
  setTimeout(syncBtns, 0);
  load();
  chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r && r.from < 30) loadOlder(); });
  timer = setInterval(() => { if (!document.hidden && el.isConnected) load(); }, POLL[opts.tf]);

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
    const f = opts.factor || 1; // user levels are real prices, so they skip the calibration
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
    document.removeEventListener('keydown', onAlt);
    document.removeEventListener('pointerdown', onDocDown, true);
    card?.removeEventListener('mouseenter', onEnter); card?.removeEventListener('mouseleave', onLeave);
    el.removeEventListener('touchstart', onTouchStart, { capture: true });
    el.removeEventListener('touchend', onTouchEnd); el.removeEventListener('touchcancel', onTouchEnd); el.removeEventListener('mouseup', onUp);
    if (shown) clearTimeout(shown);
    dw?.destroy(); dw = null;
    grip.remove(); el.querySelectorAll('.cnavb,.caxb,.cgear,.ccd').forEach((x) => x.remove()); card?.querySelector('.cscalem')?.remove();
    card?.classList.remove('lfull');
    document.body.classList.remove('lfull-on');
    if (retry) clearTimeout(retry);
    chart?.remove();
    chart = null;
  };
  const tick = (price: number) => {
    if (dead || !chart || !last || !(price > 0)) return;
    if (needCal && apiClose > 0) {
      needCal = false;
      // price is what the header shows; history is in GeckoTerminal's frame. Map ticks into that frame
      // scaled by k, so the newest candle continues smoothly from the last real one.
      const r = price / apiClose, nk = Math.abs(r - 1) <= CAL_MAX ? r : 1;
      if (Math.abs(nk - k) > 1e-4) { k = nk; paint(); if (ov) overlay(ov); }
    }
    price = price / k;
    const size = BUCKET[opts.tf], now = Math.floor(Date.now() / 1000), bucket = now - (now % size);
    if (bucket > last.time) last = { time: bucket, open: last.close, high: Math.max(last.close, price), low: Math.min(last.close, price), close: price };
    else last = { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price };
    try { put(last); } catch { /* chart was torn down mid-tick */ }
  };
  // Called when a parked chart is shown again: pull fresh candles now instead of waiting for the next poll.
  const wake = () => { if (!dead && chart) load(); };
  return Object.assign(stop, { tick, overlay, wake });
}
