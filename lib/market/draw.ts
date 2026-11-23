'use client';

import type { IChartApi, ISeriesApi, Logical, SeriesType } from 'lightweight-charts';

/**
 * TradingView-style drawing tools for the Callit chart.
 *
 * Drawings live on a canvas laid over the chart pane. Each point is stored as (unix time, raw USD price),
 * so drawings survive timeframe and Price/MCap switches, and they're saved per token in localStorage.
 * Times past the last candle are extrapolated by the bar size, so lines can run into the future.
 *
 * Left toolbar: cursor/eraser, lines (trend, ray, extended, info, arrow, horizontal line/ray, vertical, cross),
 * parallel channel, Fib retracement/extension, shapes (rectangle, ellipse, triangle, brush), annotations
 * (text, price label, arrow up/down), long/short position, measure (price, date, date & price), then magnet,
 * stay-in-drawing-mode, lock all, hide all, delete all. A selected drawing gets its own bar: color,
 * width, style, text, lock, clone, delete. Undo/redo, Delete, Esc and Ctrl+Z/Y work while over the chart.
 */

type Pt = { t: number; p: number };
type Kind =
  | 'trend' | 'ray' | 'ext' | 'info' | 'arrowl' | 'hline' | 'hray' | 'vline' | 'cross'
  | 'channel' | 'fib' | 'fibext' | 'rect' | 'ellipse' | 'tri' | 'brush'
  | 'text' | 'plabel' | 'aup' | 'adown' | 'long' | 'short' | 'prange' | 'drange' | 'dprange';
type Dw = { id: string; k: Kind; pts: Pt[]; c: string; w: number; s: 0 | 1 | 2; txt?: string; lock?: boolean };
type Tool = Kind | 'cursor' | 'eraser';

const NEED: Record<Kind, number> = {
  trend: 2, ray: 2, ext: 2, info: 2, arrowl: 2, hline: 1, hray: 1, vline: 1, cross: 1, channel: 3, fib: 2, fibext: 3,
  rect: 2, ellipse: 2, tri: 3, brush: 0, text: 1, plabel: 1, aup: 1, adown: 1, long: 1, short: 1, prange: 2, drange: 2, dprange: 2,
};
const NAME: Record<Tool, string> = {
  cursor: 'Cursor', eraser: 'Eraser', trend: 'Trend line', ray: 'Ray', ext: 'Extended line', info: 'Info line', arrowl: 'Arrow',
  hline: 'Horizontal line', hray: 'Horizontal ray', vline: 'Vertical line', cross: 'Cross line', channel: 'Parallel channel',
  fib: 'Fib retracement', fibext: 'Trend-based Fib extension', rect: 'Rectangle', ellipse: 'Ellipse', tri: 'Triangle', brush: 'Brush',
  text: 'Text', plabel: 'Price label', aup: 'Arrow mark up', adown: 'Arrow mark down', long: 'Long position', short: 'Short position',
  prange: 'Price range', drange: 'Date range', dprange: 'Date and price range',
};
const GROUPS: { id: string; tools: Tool[] }[] = [
  { id: 'cur', tools: ['cursor', 'eraser'] },
  { id: 'lines', tools: ['trend', 'ray', 'ext', 'info', 'arrowl', 'hline', 'hray', 'vline', 'cross'] },
  { id: 'chan', tools: ['channel'] },
  { id: 'fibs', tools: ['fib', 'fibext'] },
  { id: 'shapes', tools: ['rect', 'ellipse', 'tri', 'brush'] },
  { id: 'notes', tools: ['text', 'plabel', 'aup', 'adown'] },
  { id: 'pos', tools: ['long', 'short'] },
  { id: 'meas', tools: ['dprange', 'prange', 'drange'] },
];
const P = (d: string) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON: Record<string, string> = {
  cursor: P('<path d="M12 4v16M4 12h16"/>'),
  eraser: P('<path d="M16 4l4 4-10 10H6l-2-2z"/><path d="M11 9l4 4M6 20h14"/>'),
  trend: P('<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.8"/><circle cx="19" cy="5" r="1.8"/>'),
  ray: P('<path d="M5 19L21 3"/><circle cx="5" cy="19" r="1.8"/><circle cx="12" cy="12" r="1.8"/>'),
  ext: P('<path d="M2 22L22 2"/><circle cx="8" cy="16" r="1.8"/><circle cx="16" cy="8" r="1.8"/>'),
  info: P('<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.8"/><circle cx="19" cy="5" r="1.8"/><path d="M14 17h6M17 14v6"/>'),
  arrowl: P('<path d="M5 19L19 5M11 5h8v8"/>'),
  hline: P('<path d="M3 12h18"/><circle cx="12" cy="12" r="1.8"/>'),
  hray: P('<path d="M7 12h14"/><circle cx="7" cy="12" r="1.8"/>'),
  vline: P('<path d="M12 3v18"/><circle cx="12" cy="12" r="1.8"/>'),
  cross: P('<path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="1.8"/>'),
  channel: P('<path d="M3 15L15 3M9 21L21 9"/><circle cx="3" cy="15" r="1.5"/><circle cx="15" cy="3" r="1.5"/>'),
  fib: P('<path d="M3 5h18M3 10h18M3 14h18M3 19h18"/><circle cx="6" cy="19" r="1.5"/><circle cx="18" cy="5" r="1.5"/>'),
  fibext: P('<path d="M3 6h18M3 11h18M3 16h18"/><path d="M4 21l5-8 4 4"/>'),
  rect: P('<rect x="4" y="6" width="16" height="12" rx="1"/>'),
  ellipse: P('<ellipse cx="12" cy="12" rx="9" ry="6"/>'),
  tri: P('<path d="M12 4l9 16H3z"/>'),
  brush: P('<path d="M4 18c3 0 3-4 6-4s3 3 6 0 2-6 4-8"/>'),
  text: P('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
  plabel: P('<path d="M3 12l5-6h13v12H8z"/><path d="M11 12h7"/>'),
  aup: P('<path d="M12 4l7 8h-4v8H9v-8H5z"/>'),
  adown: P('<path d="M12 20l7-8h-4V4H9v8H5z"/>'),
  long: P('<rect x="4" y="4" width="16" height="8" rx="1"/><rect x="4" y="12" width="16" height="8" rx="1" opacity=".45"/><path d="M4 12h16"/>'),
  short: P('<rect x="4" y="4" width="16" height="8" rx="1" opacity=".45"/><rect x="4" y="12" width="16" height="8" rx="1"/><path d="M4 12h16"/>'),
  prange: P('<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>'),
  drange: P('<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>'),
  dprange: P('<path d="M4 20V4M4 20h16"/><path d="M8 16l9-9M13 7h4v4"/>'),
  mag: P('<path d="M6 4v8a6 6 0 0 0 12 0V4"/><path d="M6 8h4M14 8h4"/>'),
  stay: P('<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/><path d="M17 17l3 3M20 17l-3 3"/>'),
  lock: P('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  unlock: P('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>'),
  eye: P('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeoff: P('<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a10 10 0 0 0 4.4-1"/>'),
  trash: P('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  clone: P('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  edit: P('<path d="M4 20l4-1 11-11-3-3L5 16z"/>'),
  chev: '<svg viewBox="0 0 10 10" width="8" height="8" fill="currentColor"><path d="M3 1l4 4-4 4z"/></svg>',
};
const COLORS = ['#4DA8FF', '#22C55E', '#EF4444', '#F5B841', '#B07CFF', '#FFFFFF', '#94A3B8'];
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIBX = [0, 0.382, 0.618, 1, 1.272, 1.618, 2, 2.618];
const FIBC = ['#94A3B8', '#EF4444', '#F5B841', '#22C55E', '#14B8A6', '#4DA8FF', '#94A3B8', '#B07CFF'];

export type DrawingsApi = { destroy: () => void; redraw: () => void; toggleBar: () => void; undo: () => void; redo: () => void; place: () => void };

export function mountDrawings(el: HTMLElement, card: HTMLElement | null, chart: IChartApi, series: () => ISeriesApi<SeriesType>, o: {
  mint: string; bucket: number; factor: () => number; side: () => 'left' | 'right'; bars: () => number[][]; fmt: (v: number) => string;
  onUndoState?: (canUndo: boolean, canRedo: boolean) => void;
}): DrawingsApi {
  const store = (k: string, v?: string): string | null => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* private mode */ } return null; };
  const KEY = `callit.dw.${o.mint}`;
  let list: Dw[] = (() => { try { const a = JSON.parse(store(KEY) || '[]'); return Array.isArray(a) ? a.filter((d) => d && d.k && Array.isArray(d.pts)) : []; } catch { return []; } })();
  // Bring over horizontal lines drawn with the old single-line tool.
  try {
    const old = JSON.parse(store(`callit.hl.${o.mint}`) || '[]') as number[];
    if (Array.isArray(old) && old.length) {
      const t = Math.floor(Date.now() / 1000);
      for (const p of old) if (p > 0) list.push({ id: uid(), k: 'hline', pts: [{ t, p }], c: '#4DA8FF', w: 1, s: 0 });
      localStorage.removeItem(`callit.hl.${o.mint}`); save();
    }
  } catch { /* nothing to migrate */ }

  const prefs = (() => { try { return { open: !matchMedia('(max-width: 640px)').matches, mag: 0, stay: false, lockAll: false, hide: false, last: {} as Record<string, Tool>, c: '#4DA8FF', ...JSON.parse(store('callit.dwp') || '{}') }; } catch { return { open: true, mag: 0, stay: false, lockAll: false, hide: false, last: {} as Record<string, Tool>, c: '#4DA8FF' }; } })();
  const savePrefs = () => store('callit.dwp', JSON.stringify(prefs));

  let tool: Tool = 'cursor';
  let sel: string | null = null;
  let draft: Dw | null = null;
  let hover: Pt | null = null;
  let past: string[] = [], future: string[] = [];
  let dead = false;

  function uid() { return Math.random().toString(36).slice(2, 10); }
  function save() { store(KEY, JSON.stringify(list)); }
  function snap() { past.push(JSON.stringify(list)); if (past.length > 80) past.shift(); future = []; undoState(); }
  function undoState() { o.onUndoState?.(past.length > 0, future.length > 0); }
  function undo() { if (!past.length) return; future.push(JSON.stringify(list)); list = JSON.parse(past.pop() as string); sel = null; save(); undoState(); selBar(); draw(); }
  function redo() { if (!future.length) return; past.push(JSON.stringify(list)); list = JSON.parse(future.pop() as string); sel = null; save(); undoState(); selBar(); draw(); }

  // ---------- coordinates ----------
  const bars = () => o.bars();
  const axisW = () => { try { return chart.priceScale(o.side()).width(); } catch { return 0; } };
  const paneW = () => Math.max(0, el.clientWidth - axisW());
  const paneH = () => { try { return Math.max(0, el.clientHeight - chart.timeScale().height()); } catch { return el.clientHeight; } };
  function logicalOf(t: number): number | null {
    const B = bars(); const n = B.length; if (!n) return null;
    const b = o.bucket;
    if (t <= B[0][0]) return (t - B[0][0]) / b;
    if (t >= B[n - 1][0]) return n - 1 + (t - B[n - 1][0]) / b;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (B[m][0] <= t) lo = m; else hi = m; }
    return lo + (t - B[lo][0]) / Math.max(1, B[hi][0] - B[lo][0]);
  }
  function timeOf(L: number): number {
    const B = bars(); const n = B.length; const b = o.bucket;
    if (!n) return Math.floor(Date.now() / 1000);
    if (L <= 0) return B[0][0] + L * b;
    if (L >= n - 1) return B[n - 1][0] + (L - (n - 1)) * b;
    const i = Math.floor(L), f = L - i;
    return B[i][0] + f * (B[i + 1][0] - B[i][0]);
  }
  const X = (t: number): number | null => { const L = logicalOf(t); if (L == null) return null; const x = chart.timeScale().logicalToCoordinate(L as Logical); return x == null ? null : x; };
  const Y = (p: number): number | null => { const y = series().priceToCoordinate(p * (o.factor() || 1)); return y == null ? null : y; };
  const fromXY = (x: number, y: number): Pt | null => {
    const L = chart.timeScale().coordinateToLogical(x); const v = series().coordinateToPrice(y);
    if (L == null || v == null) return null;
    return { t: timeOf(L), p: Number(v) / (o.factor() || 1) };
  };
  const XY = (q: Pt): [number, number] | null => { const x = X(q.t), y = Y(q.p); return x == null || y == null ? null : [x, y]; };
  /** Magnet: pull the price to the nearest open/high/low/close of the candle under the pointer. */
  function magnet(q: Pt, y: number): Pt {
    if (!prefs.mag) return q;
    const L = logicalOf(q.t); const B = bars(); if (L == null || !B.length) return q;
    const i = Math.max(0, Math.min(B.length - 1, Math.round(L))); const c = B[i]; if (!c) return q;
    let best = q.p, bd = Infinity;
    for (const v of [c[1], c[2], c[3], c[4]]) { const yy = Y(v); if (yy == null) continue; const d = Math.abs(yy - y); if (d < bd) { bd = d; best = v; } }
    return prefs.mag === 2 || bd < 18 ? { t: c[0], p: best } : q;
  }

  // ---------- DOM ----------
  const cv = document.createElement('canvas'); cv.className = 'cdwcv'; el.appendChild(cv);
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  const bar = document.createElement('div'); bar.className = 'cdwbar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Drawing tools'); el.appendChild(bar);
  const tab = document.createElement('button'); tab.className = 'cdwtab'; tab.type = 'button'; el.appendChild(tab);
  const fly = document.createElement('div'); fly.className = 'cdwfly'; fly.setAttribute('role', 'menu'); el.appendChild(fly);
  const sbar = document.createElement('div'); sbar.className = 'cdwsel'; el.appendChild(sbar);

  const coarse = () => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } };
  function groupOf(t: Tool) { return GROUPS.find((g) => g.tools.includes(t)) as typeof GROUPS[0]; }
  function renderBar() {
    const btn = (g: typeof GROUPS[0]) => {
      const cur = (prefs.last[g.id] && g.tools.includes(prefs.last[g.id]) ? prefs.last[g.id] : g.tools[0]) as Tool;
      const on = g.tools.includes(tool) && (tool !== 'cursor' || g.id === 'cur');
      const shown = on ? tool : cur;
      return `<div class="cdwg${on ? ' on' : ''}"><button data-dw="tool" data-f="${shown}" title="${NAME[shown]}" aria-label="${NAME[shown]}" aria-pressed="${on}">${ICON[shown]}</button>${g.tools.length > 1 ? `<button class="cdwmore" data-dw="more" data-f="${g.id}" title="More ${g.id === 'cur' ? 'cursors' : 'tools'}" aria-label="More tools" aria-haspopup="menu">${ICON.chev}</button>` : ''}</div>`;
    };
    const tg = (k: string, on: boolean, ic: string, t: string) => `<div class="cdwg${on ? ' on' : ''}"><button data-dw="${k}" title="${t}" aria-label="${t}" aria-pressed="${on}">${ic}</button></div>`;
    bar.innerHTML = GROUPS.map(btn).join('') + '<i class="cdwsep"></i>'
      + tg('mag', !!prefs.mag, ICON.mag, prefs.mag === 2 ? 'Strong magnet (snaps to OHLC)' : prefs.mag === 1 ? 'Weak magnet (snaps near OHLC)' : 'Magnet off')
      + tg('stay', prefs.stay, ICON.stay, 'Stay in drawing mode')
      + tg('lockall', prefs.lockAll, prefs.lockAll ? ICON.lock : ICON.unlock, prefs.lockAll ? 'Unlock all drawings' : 'Lock all drawings')
      + tg('hide', prefs.hide, prefs.hide ? ICON.eyeoff : ICON.eye, prefs.hide ? 'Show all drawings' : 'Hide all drawings')
      + tg('clearall', false, ICON.trash, 'Remove all drawings');
    if (prefs.mag === 2) bar.querySelector('[data-dw="mag"]')?.classList.add('strong');
    tab.innerHTML = prefs.open ? '<svg viewBox="0 0 10 10" width="9" height="9" fill="currentColor"><path d="M7 1L3 5l4 4z"/></svg>' : '<svg viewBox="0 0 10 10" width="9" height="9" fill="currentColor"><path d="M3 1l4 4-4 4z"/></svg>';
    tab.title = prefs.open ? 'Hide drawings toolbar' : 'Show drawings toolbar'; tab.setAttribute('aria-label', tab.title);
    el.classList.toggle('cdwon', prefs.open);
    el.classList.toggle('cdraw', tool !== 'cursor');
    card?.querySelector('[data-ch="dwbar"]')?.classList.toggle('on', prefs.open);
  }
  function openFly(gid: string, anchor: HTMLElement) {
    if (fly.dataset.g === gid && fly.classList.contains('show')) { closeFly(); return; }
    const g = GROUPS.find((x) => x.id === gid); if (!g) return;
    fly.innerHTML = g.tools.map((t) => `<button data-dw="pick" data-f="${t}" role="menuitem" class="${tool === t ? 'on' : ''}">${ICON[t]}<span>${NAME[t]}</span></button>`).join('');
    fly.dataset.g = gid; fly.classList.add('show');
    const r = anchor.closest('.cdwg')!.getBoundingClientRect(), er = el.getBoundingClientRect(), z = parseFloat(document.body.style.zoom) || 1;
    fly.style.left = (r.right - er.left) / z + 6 + 'px';
    fly.style.top = Math.max(4, Math.min((r.top - er.top) / z, el.clientHeight - fly.offsetHeight - 6)) + 'px';
  }
  function closeFly() { fly.classList.remove('show'); fly.dataset.g = ''; }
  function setTool(t: Tool) {
    tool = t; draft = null; closeFly(); if (!own) freeze(false);
    if (t !== 'cursor') { const g = groupOf(t); if (g) prefs.last[g.id] = t; savePrefs(); }
    if (t !== 'cursor' && t !== 'eraser') { sel = null; selBar(); }
    renderBar(); draw();
  }

  function selBar() {
    const d = list.find((x) => x.id === sel);
    if (!d) { sbar.classList.remove('show'); sbar.innerHTML = ''; return; }
    const hasText = d.k === 'text' || d.k === 'plabel';
    sbar.innerHTML = COLORS.map((c) => `<button class="cdwc${d.c.toLowerCase() === c.toLowerCase() ? ' on' : ''}" data-dw="color" data-f="${c}" style="--c:${c}" title="Color" aria-label="Color ${c}"></button>`).join('')
      + `<i class="cdwsep v"></i><button data-dw="width" title="Line width" aria-label="Line width"><span class="cdww" style="height:${d.w}px"></span><b>${d.w}px</b></button>`
      + `<button data-dw="style" title="Line style" aria-label="Line style"><span class="cdws s${d.s}"></span></button>`
      + (hasText ? `<button data-dw="edit" title="Edit text" aria-label="Edit text">${ICON.edit}</button>` : '')
      + `<i class="cdwsep v"></i><button data-dw="lock" class="${d.lock ? 'on' : ''}" title="${d.lock ? 'Unlock' : 'Lock'}" aria-label="${d.lock ? 'Unlock' : 'Lock'}">${d.lock ? ICON.lock : ICON.unlock}</button>`
      + `<button data-dw="clone" title="Clone" aria-label="Clone">${ICON.clone}</button>`
      + `<button data-dw="del" class="cdwdel" title="Remove (Delete)" aria-label="Remove">${ICON.trash}</button>`;
    sbar.classList.add('show');
  }

  // ---------- painting ----------
  let dpr = 1;
  function fit() {
    const w = paneW(), h = paneH(); dpr = window.devicePixelRatio || 1;
    const left = o.side() === 'left' ? axisW() : 0;
    cv.style.left = left + 'px'; cv.style.width = w + 'px'; cv.style.height = h + 'px';
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const bl = (o.side() === 'left' ? axisW() : 0);
    bar.style.left = bl + 'px'; tab.style.left = bl + (prefs.open ? 44 : 0) + 'px';
    bar.style.maxHeight = h + 'px';
  }
  const dash = (s: number, w: number) => s === 1 ? [6 + w, 4 + w] : s === 2 ? [1.5 * w, 3 + w] : [];
  const alpha = (c: string, a: number) => { const h = c.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
  const textCol = () => getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#e6edf3';
  const bgCol = () => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0b1220';
  function seg(a: [number, number], b: [number, number]) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  /** Extend a→b beyond b (and beyond a when both) to the canvas edge. */
  function extend(a: [number, number], b: [number, number], back: boolean): [[number, number], [number, number]] {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, k = 1e5 / len;
    const far: [number, number] = [b[0] + dx * k, b[1] + dy * k];
    const near: [number, number] = back ? [a[0] - dx * k, a[1] - dy * k] : a;
    return [near, far];
  }
  function label(txt: string, x: number, y: number, bg: string, fg = '#fff', align: CanvasTextAlign = 'center') {
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    const lines = txt.split('\n'), w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12, h = lines.length * 14 + 6;
    let lx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    lx = Math.max(2, Math.min(lx, cv.width / dpr - w - 2));
    ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(lx, y - h / 2, w, h, 5); ctx.fill();
    ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, lx + 6, y - h / 2 + 10 + i * 14));
  }
  const pctS = (a: number, b: number) => { const v = a ? ((b - a) / a) * 100 : 0; return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`; };
  const fmtP = (raw: number) => o.fmt(raw * (o.factor() || 1));
  const dur = (s: number) => { s = Math.abs(s); const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
  const barsBetween = (a: number, b: number) => { const la = logicalOf(a), lb = logicalOf(b); return la == null || lb == null ? 0 : Math.round(lb - la); };

  function paint(d: Dw, isSel: boolean, preview: Pt | null) {
    const pts = preview ? [...d.pts, preview] : d.pts;
    const xy = pts.map(XY);
    if (xy.some((v) => v == null)) return;
    const q = xy as [number, number][];
    const W = cv.width / dpr, H = cv.height / dpr;
    ctx.save();
    ctx.strokeStyle = d.c; ctx.lineWidth = d.w; ctx.setLineDash(dash(d.s, d.w)); ctx.lineCap = 'round';
    const k = d.k;
    if (k === 'trend' || k === 'info' || k === 'arrowl') {
      if (q.length >= 2) {
        seg(q[0], q[1]);
        if (k === 'arrowl') {
          const [a, b] = [q[0], q[1]], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = 10 + d.w * 2;
          ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - L * Math.cos(ang - 0.45), b[1] - L * Math.sin(ang - 0.45));
          ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - L * Math.cos(ang + 0.45), b[1] - L * Math.sin(ang + 0.45)); ctx.stroke();
        }
        if (k === 'info') {
          const a = pts[0], b = pts[1];
          label(`${b.p >= a.p ? '+' : '-'}${fmtP(Math.abs(b.p - a.p))} (${pctS(a.p, b.p)})\n${barsBetween(a.t, b.t)} bars · ${dur(b.t - a.t)}`, (q[0][0] + q[1][0]) / 2, Math.min(q[0][1], q[1][1]) - 22, alpha(d.c, 0.9));
        }
      }
    } else if (k === 'ray' || k === 'ext') {
      if (q.length >= 2) { const [a, b] = extend(q[0], q[1], k === 'ext'); seg(a, b); } else if (q.length) seg(q[0], q[0]);
    } else if (k === 'hline') {
      seg([0, q[0][1]], [W, q[0][1]]);
      ctx.setLineDash([]); label(fmtP(pts[0].p), W - 4, q[0][1], d.c, '#fff', 'right');
    } else if (k === 'hray') {
      seg(q[0], [W, q[0][1]]); ctx.setLineDash([]); label(fmtP(pts[0].p), W - 4, q[0][1], d.c, '#fff', 'right');
    } else if (k === 'vline') {
      seg([q[0][0], 0], [q[0][0], H]);
    } else if (k === 'cross') {
      seg([0, q[0][1]], [W, q[0][1]]); seg([q[0][0], 0], [q[0][0], H]);
      ctx.setLineDash([]); label(fmtP(pts[0].p), W - 4, q[0][1], d.c, '#fff', 'right');
    } else if (k === 'channel') {
      if (q.length >= 2) {
        seg(q[0], q[1]);
        if (q.length >= 3) {
          const dy = q[2][1] - q[0][1] - ((q[1][1] - q[0][1]) * (q[2][0] - q[0][0])) / ((q[1][0] - q[0][0]) || 1);
          const a2: [number, number] = [q[0][0], q[0][1] + dy], b2: [number, number] = [q[1][0], q[1][1] + dy];
          seg(a2, b2);
          ctx.save(); ctx.setLineDash([4, 4]); ctx.globalAlpha = 0.6; seg([q[0][0], q[0][1] + dy / 2], [q[1][0], q[1][1] + dy / 2]); ctx.restore();
          ctx.fillStyle = alpha(d.c, 0.1); ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); ctx.lineTo(q[1][0], q[1][1]); ctx.lineTo(b2[0], b2[1]); ctx.lineTo(a2[0], a2[1]); ctx.closePath(); ctx.fill();
        }
      }
    } else if (k === 'fib' || k === 'fibext') {
      const lv = k === 'fib' ? FIB : FIBX;
      if (q.length >= 2) {
        ctx.save(); ctx.setLineDash([4, 4]); ctx.globalAlpha = 0.6; seg(q[0], q[1]); if (k === 'fibext' && q[2]) seg(q[1], q[2]); ctx.restore();
        const base = k === 'fib' ? pts[1].p : (pts[2] ? pts[2].p : pts[1].p);
        const span = k === 'fib' ? pts[0].p - pts[1].p : pts[1].p - pts[0].p;
        if (k === 'fib' || q.length >= 3) {
          const x1 = Math.min(...q.map((v) => v[0])), x2 = Math.max(x1 + 40, W);
          let prevY: number | null = null;
          lv.forEach((r, i) => {
            const price = base + span * r * (k === 'fib' ? 1 : 1);
            const y = Y(price); if (y == null) return;
            const c = FIBC[i % FIBC.length];
            if (prevY != null) { ctx.fillStyle = alpha(c, 0.08); ctx.fillRect(x1, Math.min(prevY, y), x2 - x1, Math.abs(y - prevY)); }
            ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.setLineDash([]); seg([x1, y], [x2, y]);
            ctx.font = '600 10.5px Inter, system-ui, sans-serif'; ctx.fillStyle = c; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
            ctx.fillText(`${r} (${fmtP(price)})`, x1 + 4, y - 2);
            prevY = y;
          });
        }
      }
    } else if (k === 'rect' || k === 'prange' || k === 'drange' || k === 'dprange') {
      if (q.length >= 2) {
        const x = Math.min(q[0][0], q[1][0]), y = Math.min(q[0][1], q[1][1]), w = Math.abs(q[1][0] - q[0][0]), h = Math.abs(q[1][1] - q[0][1]);
        if (k === 'rect') { ctx.fillStyle = alpha(d.c, 0.14); ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); }
        else {
          const a = pts[0], b = pts[1], upv = b.p >= a.p, c = k === 'drange' ? d.c : upv ? '#22C55E' : '#EF4444';
          ctx.fillStyle = alpha(c, 0.14);
          const rx = k === 'prange' ? Math.min(q[0][0], q[1][0]) : x, rw = k === 'prange' ? Math.max(24, w) : w;
          const ry = k === 'drange' ? Math.min(q[0][1], q[1][1]) : y, rh = k === 'drange' ? Math.max(24, h) : h;
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeStyle = c; ctx.setLineDash([]); ctx.lineWidth = 1;
          if (k !== 'drange') { seg([rx + rw / 2, q[0][1]], [rx + rw / 2, q[1][1]]); }
          if (k !== 'prange') { seg([q[0][0], ry + rh / 2], [q[1][0], ry + rh / 2]); }
          const parts: string[] = [];
          if (k !== 'drange') parts.push(`${b.p >= a.p ? '+' : '-'}${fmtP(Math.abs(b.p - a.p))} (${pctS(a.p, b.p)})`);
          if (k !== 'prange') parts.push(`${barsBetween(a.t, b.t)} bars, ${dur(b.t - a.t)}`);
          label(parts.join('\n'), rx + rw / 2, (upv || k === 'drange' ? ry : ry + rh) + (upv || k === 'drange' ? -18 : 18), alpha(c, 0.92));
        }
      }
    } else if (k === 'ellipse') {
      if (q.length >= 2) {
        const cx = (q[0][0] + q[1][0]) / 2, cy = (q[0][1] + q[1][1]) / 2, rx = Math.abs(q[1][0] - q[0][0]) / 2, ry = Math.abs(q[1][1] - q[0][1]) / 2;
        ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2); ctx.fillStyle = alpha(d.c, 0.14); ctx.fill(); ctx.stroke();
      }
    } else if (k === 'tri') {
      ctx.beginPath(); q.forEach((v, i) => (i ? ctx.lineTo(v[0], v[1]) : ctx.moveTo(v[0], v[1])));
      if (q.length >= 3) { ctx.closePath(); ctx.fillStyle = alpha(d.c, 0.14); ctx.fill(); }
      ctx.stroke();
    } else if (k === 'brush') {
      ctx.setLineDash([]); ctx.lineJoin = 'round'; ctx.beginPath(); q.forEach((v, i) => (i ? ctx.lineTo(v[0], v[1]) : ctx.moveTo(v[0], v[1]))); ctx.stroke();
    } else if (k === 'text') {
      ctx.font = `700 ${12 + d.w * 2}px Inter, system-ui, sans-serif`; ctx.fillStyle = d.c; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      (d.txt || 'Text').split('\n').forEach((l, i) => ctx.fillText(l, q[0][0], q[0][1] + i * (16 + d.w * 2)));
    } else if (k === 'plabel') {
      ctx.setLineDash([]); ctx.fillStyle = d.c; ctx.beginPath(); ctx.arc(q[0][0], q[0][1], 3, 0, Math.PI * 2); ctx.fill();
      label(d.txt ? `${d.txt}\n${fmtP(pts[0].p)}` : fmtP(pts[0].p), q[0][0] + 8, q[0][1] - 16, d.c, '#fff', 'left');
    } else if (k === 'aup' || k === 'adown') {
      const s = 1 + d.w * 0.4, x = q[0][0], y = q[0][1], dir = k === 'aup' ? 1 : -1;
      ctx.setLineDash([]); ctx.fillStyle = k === 'aup' ? (d.c === '#4DA8FF' ? '#22C55E' : d.c) : (d.c === '#4DA8FF' ? '#EF4444' : d.c);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 9 * s, y + 10 * s * dir); ctx.lineTo(x + 4 * s, y + 10 * s * dir); ctx.lineTo(x + 4 * s, y + 22 * s * dir);
      ctx.lineTo(x - 4 * s, y + 22 * s * dir); ctx.lineTo(x - 4 * s, y + 10 * s * dir); ctx.lineTo(x - 9 * s, y + 10 * s * dir); ctx.closePath(); ctx.fill();
    } else if (k === 'long' || k === 'short') {
      if (q.length >= 3) {
        const x1 = q[0][0], x2 = Math.max(q[1][0], x1 + 8), ye = q[0][1], ytp = q[1][1], ysl = q[2][1];
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(34,197,94,.18)'; ctx.fillRect(x1, Math.min(ye, ytp), x2 - x1, Math.abs(ytp - ye));
        ctx.fillStyle = 'rgba(239,68,68,.18)'; ctx.fillRect(x1, Math.min(ye, ysl), x2 - x1, Math.abs(ysl - ye));
        ctx.strokeStyle = textCol(); ctx.lineWidth = 1; seg([x1, ye], [x2, ye]);
        const e = pts[0].p, tp = pts[1].p, sl = pts[2].p, rr = Math.abs(e - sl) ? Math.abs(tp - e) / Math.abs(e - sl) : 0;
        const cx = (x1 + x2) / 2;
        label(`Target: ${fmtP(tp)} (${pctS(e, tp)})`, cx, ytp + (ytp < ye ? -12 : 12), 'rgba(22,163,74,.95)');
        label(`Stop: ${fmtP(sl)} (${pctS(e, sl)})`, cx, ysl + (ysl > ye ? 12 : -12), 'rgba(220,38,38,.95)');
        label(`${k === 'long' ? 'Long' : 'Short'} · Entry ${fmtP(e)} · R:R ${rr.toFixed(2)}`, cx, ye, alpha(bgCol(), 0.92), textCol());
      }
    }
    ctx.restore();
    if (isSel) handles(d, q);
  }
  function handles(d: Dw, q: [number, number][]) {
    ctx.save(); ctx.setLineDash([]);
    const hp = handlePts(d, q);
    for (const [x, y] of hp) { ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = bgCol(); ctx.fill(); ctx.lineWidth = 1.8; ctx.strokeStyle = d.lock ? '#94A3B8' : d.c; ctx.stroke(); }
    ctx.restore();
  }
  function handlePts(d: Dw, q: [number, number][]): [number, number][] {
    if (d.k === 'brush') return q.length ? [q[0], q[q.length - 1]] : [];
    if (d.k === 'long' || d.k === 'short') return q.length >= 3 ? [q[0], [q[1][0], q[1][1]], [q[2][0], q[2][1]], [q[1][0], q[0][1]]] : [];
    if (d.k === 'channel' && q.length >= 3) {
      const dy = q[2][1] - q[0][1] - ((q[1][1] - q[0][1]) * (q[2][0] - q[0][0])) / ((q[1][0] - q[0][0]) || 1);
      return [q[0], q[1], [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2 + dy]];
    }
    if (d.k === 'hline') return [[(cv.width / dpr) / 2, q[0][1]]];
    if (d.k === 'vline') return [[q[0][0], (cv.height / dpr) / 2]];
    return q;
  }
  let sig = '';
  function draw() {
    if (dead) return;
    fit();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!prefs.hide) for (const d of list) paint(d, d.id === sel, null);
    if (draft) paint(draft, true, NEED[draft.k] > draft.pts.length && hover ? hover : null);
  }
  // Redraw whenever the chart moves: pan/zoom fire events, but price-axis stretching doesn't, so watch a signature.
  let raf = 0;
  const loop = () => {
    if (dead) return;
    try {
      const B = bars(), ref = B.length ? B[B.length - 1][4] : 1;
      const s = [el.clientWidth, el.clientHeight, axisW(), chart.timeScale().logicalToCoordinate(0 as Logical), chart.timeScale().logicalToCoordinate(10 as Logical), Y(ref), Y(ref * 1.5), o.factor(), B.length, o.side(), prefs.open].join('|');
      if (s !== sig) { sig = s; draw(); }
    } catch { /* chart between layouts */ }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  // ---------- hit testing ----------
  const distSeg = (p: [number, number], a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const inBox = (p: [number, number], a: [number, number], b: [number, number]) => p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
  function hit(p: [number, number], tol: number): { d: Dw; h: number } | null {
    if (prefs.hide) return null;
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i]; const xy = d.pts.map(XY); if (xy.some((v) => v == null)) continue;
      const q = xy as [number, number][]; const W = cv.width / dpr, H = cv.height / dpr;
      if (d.id === sel) { const hp = handlePts(d, q); for (let j = 0; j < hp.length; j++) if (Math.hypot(p[0] - hp[j][0], p[1] - hp[j][1]) <= tol + 3) return { d, h: j }; }
      let ok = false; const k = d.k;
      if (k === 'trend' || k === 'info' || k === 'arrowl') ok = distSeg(p, q[0], q[1]) <= tol;
      else if (k === 'ray' || k === 'ext') { const [a, b] = extend(q[0], q[1], k === 'ext'); ok = distSeg(p, a, b) <= tol; }
      else if (k === 'hline') ok = Math.abs(p[1] - q[0][1]) <= tol;
      else if (k === 'hray') ok = p[0] >= q[0][0] - tol && Math.abs(p[1] - q[0][1]) <= tol;
      else if (k === 'vline') ok = Math.abs(p[0] - q[0][0]) <= tol;
      else if (k === 'cross') ok = Math.abs(p[1] - q[0][1]) <= tol || Math.abs(p[0] - q[0][0]) <= tol;
      else if (k === 'channel') {
        const dy = q[2][1] - q[0][1] - ((q[1][1] - q[0][1]) * (q[2][0] - q[0][0])) / ((q[1][0] - q[0][0]) || 1);
        const a2: [number, number] = [q[0][0], q[0][1] + dy], b2: [number, number] = [q[1][0], q[1][1] + dy];
        const minX = Math.min(q[0][0], q[1][0]), maxX = Math.max(q[0][0], q[1][0]);
        const t = (p[0] - q[0][0]) / ((q[1][0] - q[0][0]) || 1), yl = q[0][1] + t * (q[1][1] - q[0][1]);
        ok = distSeg(p, q[0], q[1]) <= tol || distSeg(p, a2, b2) <= tol || (p[0] >= minX && p[0] <= maxX && p[1] >= Math.min(yl, yl + dy) && p[1] <= Math.max(yl, yl + dy));
      } else if (k === 'fib' || k === 'fibext') {
        const x1 = Math.min(...q.map((v) => v[0])); const ys = (k === 'fib' ? FIB : FIBX).map((r) => {
          const base = k === 'fib' ? d.pts[1].p : (d.pts[2] || d.pts[1]).p, span = k === 'fib' ? d.pts[0].p - d.pts[1].p : d.pts[1].p - d.pts[0].p;
          return Y(base + span * r);
        }).filter((v) => v != null) as number[];
        ok = p[0] >= x1 - tol && ys.some((y) => Math.abs(p[1] - y) <= tol) || q.some((v, j) => j < q.length - 1 && distSeg(p, v, q[j + 1]) <= tol);
      } else if (k === 'rect' || k === 'prange' || k === 'drange' || k === 'dprange') ok = inBox(p, [q[0][0] - tol, q[0][1] - tol], [q[1][0] + tol, q[1][1] + tol]) || inBox(p, [q[1][0] - tol, q[1][1] - tol], [q[0][0] + tol, q[0][1] + tol]);
      else if (k === 'ellipse') {
        const cx = (q[0][0] + q[1][0]) / 2, cy = (q[0][1] + q[1][1]) / 2, rx = Math.abs(q[1][0] - q[0][0]) / 2 + tol, ry = Math.abs(q[1][1] - q[0][1]) / 2 + tol;
        ok = ((p[0] - cx) ** 2) / (rx * rx || 1) + ((p[1] - cy) ** 2) / (ry * ry || 1) <= 1;
      } else if (k === 'tri') {
        const [a, b, c] = q; const s = (u: [number, number], v: [number, number], w: [number, number]) => (u[0] - w[0]) * (v[1] - w[1]) - (v[0] - w[0]) * (u[1] - w[1]);
        const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
        ok = !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0))) || distSeg(p, a, b) <= tol || distSeg(p, b, c) <= tol || distSeg(p, c, a) <= tol;
      } else if (k === 'brush') ok = q.some((v, j) => j < q.length - 1 && distSeg(p, v, q[j + 1]) <= tol);
      else if (k === 'text') { ctx.font = `700 ${12 + d.w * 2}px Inter, system-ui, sans-serif`; const lines = (d.txt || 'Text').split('\n'); const w = Math.max(...lines.map((l) => ctx.measureText(l).width)); ok = p[0] >= q[0][0] - tol && p[0] <= q[0][0] + w + tol && p[1] >= q[0][1] - 12 - tol && p[1] <= q[0][1] + lines.length * (16 + d.w * 2) + tol; }
      else if (k === 'plabel') ok = p[0] >= q[0][0] - tol && p[0] <= q[0][0] + 120 && p[1] >= q[0][1] - 34 && p[1] <= q[0][1] + tol;
      else if (k === 'aup' || k === 'adown') ok = Math.abs(p[0] - q[0][0]) <= 12 && (k === 'aup' ? p[1] >= q[0][1] - tol && p[1] <= q[0][1] + 26 : p[1] <= q[0][1] + tol && p[1] >= q[0][1] - 26);
      else if (k === 'long' || k === 'short') ok = inBox(p, [q[0][0], Math.min(q[1][1], q[2][1])], [Math.max(q[1][0], q[0][0] + 8), Math.max(q[1][1], q[2][1])]);
      if (ok && W && H) return { d, h: -1 };
    }
    return null;
  }

  // ---------- creating ----------
  function startDraft(k: Kind, first: Pt) {
    draft = { id: uid(), k, pts: [first], c: k === 'long' || k === 'short' || k === 'prange' || k === 'dprange' ? '#4DA8FF' : prefs.c, w: k === 'text' ? 2 : k === 'brush' ? 2 : 1, s: 0 };
    if (k === 'long' || k === 'short') {
      // One tap: entry where you tapped, target and stop at ±(visible range / 6), 20 bars wide.
      const H = cv.height / dpr, top = fromXY(10, H * 0.25), bot = fromXY(10, H * 0.75);
      const step = top && bot ? Math.abs(top.p - bot.p) / 3 : first.p * 0.05;
      const end = first.t + o.bucket * 20, up = k === 'long' ? 1 : -1;
      draft.pts = [first, { t: end, p: first.p + step * up }, { t: end, p: Math.max(first.p * 0.01, first.p - step * up) }];
    }
    if (k === 'text' || k === 'plabel') draft.txt = k === 'text' ? 'Text' : '';
  }
  function finish() {
    if (!draft) return;
    snap(); list.push(draft); const d = draft; draft = null; save();
    sel = d.id; selBar();
    if (!prefs.stay) setTool('cursor'); else renderBar();
    draw();
    if (d.k === 'text') editText(d);
  }
  function editText(d: Dw) {
    const xy = XY(d.pts[0]); if (!xy) return;
    const inp = document.createElement('textarea'); inp.className = 'cdwinput'; inp.value = d.txt || ''; inp.rows = 1;
    inp.style.left = (parseFloat(cv.style.left) || 0) + xy[0] + 'px'; inp.style.top = xy[1] - 14 + 'px'; inp.style.color = d.c;
    el.appendChild(inp); inp.focus(); inp.select();
    let done = false;
    const commit = () => { if (done) return; done = true; const v = inp.value.trim(); inp.remove(); if (v !== (d.txt || '')) { snap(); d.txt = v || (d.k === 'text' ? 'Text' : ''); save(); } draw(); };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); } if (e.key === 'Escape') { inp.value = d.txt || ''; commit(); } });
    inp.addEventListener('blur', commit);
    ['pointerdown', 'mousedown', 'touchstart'].forEach((t) => inp.addEventListener(t, (e) => e.stopPropagation()));
  }

  // ---------- pointer handling ----------
  let own = false;
  let drag: { d: Dw; h: number; start: [number, number]; orig: Pt[]; moved: boolean } | null = null;
  let downAt: [number, number] | null = null;
  let saved: { s: unknown; z: unknown } | null = null;
  const freeze = (on: boolean) => {
    if (on && !saved) { const op = chart.options(); saved = { s: op.handleScroll, z: op.handleScale }; chart.applyOptions({ handleScroll: false, handleScale: false }); }
    else if (!on && saved) { chart.applyOptions({ handleScroll: saved.s as never, handleScale: saved.z as never }); saved = null; }
  };
  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = cv.getBoundingClientRect(), z = parseFloat(document.body.style.zoom) || 1;
    return [(e.clientX - r.left) / z, (e.clientY - r.top) / z];
  };
  const inPane = (p: [number, number]) => p[0] >= 0 && p[1] >= 0 && p[0] <= cv.width / dpr && p[1] <= cv.height / dpr;
  const isUi = (t: EventTarget | null) => !!(t as HTMLElement)?.closest?.('.cdwbar,.cdwtab,.cdwfly,.cdwsel,.cdwinput,.cnavb,.caxb,.cgear,button');
  const ptAt = (p: [number, number]): Pt | null => { const q = fromXY(p[0], p[1]); return q ? magnet(q, p[1]) : null; };

  function onDown(e: PointerEvent) {
    if (dead || isUi(e.target) || e.button > 0) return;
    const p = local(e); if (!inPane(p)) return;
    closeFly();
    const tol = e.pointerType === 'touch' ? 14 : 7;
    if (tool === 'eraser') {
      const h = hit(p, tol); own = true; freeze(true); e.stopPropagation(); e.preventDefault();
      if (h) { snap(); list = list.filter((x) => x.id !== h.d.id); if (sel === h.d.id) sel = null; save(); selBar(); draw(); }
      return;
    }
    if (tool !== 'cursor') {
      own = true; freeze(true); e.stopPropagation(); e.preventDefault();
      const q = ptAt(p); if (!q) return;
      downAt = p;
      if (!draft) {
        startDraft(tool as Kind, q);
        if (tool === 'brush') { draw(); return; }
        if (NEED[tool as Kind] <= 1) { finish(); return; }
        if ((draft as Dw | null)?.k === 'long' || (draft as Dw | null)?.k === 'short') { finish(); return; }
        hover = q; draw();
      } else {
        draft.pts.push(q);
        if (draft.pts.length >= NEED[draft.k]) finish(); else draw();
      }
      return;
    }
    const h = hit(p, tol);
    if (!h) { if (sel) { sel = null; selBar(); draw(); } return; }
    own = true; freeze(true); e.stopPropagation(); e.preventDefault();
    if (sel !== h.d.id) { sel = h.d.id; selBar(); }
    draw();
    if (h.d.lock || prefs.lockAll) return;
    drag = { d: h.d, h: h.h, start: p, orig: h.d.pts.map((x) => ({ ...x })), moved: false };
  }
  function onMove(e: PointerEvent) {
    if (dead) return;
    const p = local(e);
    if (own) { e.stopPropagation(); }
    if (draft) {
      const q = ptAt(p);
      if (draft.k === 'brush' && own && q) { draft.pts.push(q); draw(); return; }
      if (q) { hover = q; draw(); }
      return;
    }
    if (drag) {
      const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      if (!drag.moved) { snap(); drag.moved = true; }
      const d = drag.d, h = drag.h;
      const mv = (q: Pt, ddx: number, ddy: number): Pt => { const a = XY(q); if (!a) return q; return fromXY(a[0] + ddx, a[1] + ddy) || q; };
      if (h < 0) d.pts = drag.orig.map((q) => mv(q, dx, dy));
      else if (d.k === 'long' || d.k === 'short') {
        const o0 = drag.orig;
        const np = fromXY((XY(o0[h === 3 ? 1 : Math.min(h, 2)]) || [0, 0])[0] + dx, (XY(o0[h === 3 ? 0 : Math.min(h, 2)]) || [0, 0])[1] + dy);
        if (np) {
          if (h === 0) { const m = mv(o0[0], dx, dy); d.pts = [m, { t: Math.max(m.t + o.bucket, o0[1].t + (m.t - o0[0].t)), p: o0[1].p }, { t: Math.max(m.t + o.bucket, o0[2].t + (m.t - o0[0].t)), p: o0[2].p }]; }
          else if (h === 1) { const m = mv(o0[1], dx, dy); d.pts = [o0[0], { t: Math.max(o0[0].t + o.bucket, m.t), p: m.p }, { t: Math.max(o0[0].t + o.bucket, m.t), p: o0[2].p }]; }
          else if (h === 2) { const m = mv(o0[2], dx, dy); d.pts = [o0[0], { t: Math.max(o0[0].t + o.bucket, m.t), p: o0[1].p }, { t: Math.max(o0[0].t + o.bucket, m.t), p: m.p }]; }
          else { const m = mv(o0[1], dx, 0); const t = Math.max(o0[0].t + o.bucket, m.t); d.pts = [o0[0], { t, p: o0[1].p }, { t, p: o0[2].p }]; }
        }
      } else if (d.k === 'channel' && h === 2) {
        const m = mv(drag.orig[2], 0, dy); d.pts = [drag.orig[0], drag.orig[1], m];
      } else if (d.k === 'brush') d.pts = drag.orig.map((q) => mv(q, dx, dy));
      else if (d.k === 'hline') d.pts = [mv(drag.orig[0], 0, dy)];
      else if (d.k === 'vline') d.pts = [mv(drag.orig[0], dx, 0)];
      else { const np = ptAt([((XY(drag.orig[h]) || [0, 0])[0]) + dx, ((XY(drag.orig[h]) || [0, 0])[1]) + dy]); if (np) { d.pts = drag.orig.map((q, i) => (i === h ? np : q)); } }
      draw();
      return;
    }
    if (!own && tool === 'cursor' && inPane(p) && e.pointerType !== 'touch') {
      const h = hit(p, 7); el.classList.toggle('cdwhov', !!h); el.classList.toggle('cdwgrab', !!h && (h.h >= 0));
    }
  }
  function onUp(e: PointerEvent) {
    if (dead) return;
    const p = local(e);
    if (draft && draft.k === 'brush') { if (draft.pts.length > 1) finish(); else draft = null; draw(); }
    else if (draft && downAt && NEED[draft.k] === 2 && draft.pts.length === 1 && Math.hypot(p[0] - downAt[0], p[1] - downAt[1]) > 8) {
      // Press-drag-release also draws a two-point tool.
      const q = ptAt(p); if (q) { draft.pts.push(q); finish(); }
    }
    if (drag) { if (drag.moved) save(); drag = null; }
    downAt = null;
    if (own) { e.stopPropagation(); own = false; if (!draft) freeze(false); }
  }
  const block = (e: Event) => { if (isUi(e.target)) return; if (own || (draft && e.type !== 'mousemove')) { e.stopPropagation(); if (e.cancelable && e.type !== 'mousemove') e.preventDefault(); } };
  const onDbl = (e: MouseEvent) => {
    const p = local(e); if (!inPane(p)) return;
    const h = hit(p, 7); if (h && (h.d.k === 'text' || h.d.k === 'plabel')) { e.stopPropagation(); editText(h.d); }
  };
  el.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);
  el.addEventListener('dblclick', onDbl, true);
  ['mousedown', 'touchstart', 'touchmove', 'mouseup', 'touchend', 'click'].forEach((t) => el.addEventListener(t, block, { capture: true, passive: false }));

  // ---------- toolbar clicks ----------
  const onBar = (e: Event) => {
    const b = (e.target as HTMLElement).closest('[data-dw]') as HTMLElement | null; if (!b) return;
    e.stopPropagation();
    const a = b.dataset.dw, f = b.dataset.f || '';
    if (a === 'tool') {
      // Touch: a tap on a group opens its list (the side arrows are too small for fingers).
      const g = groupOf(f as Tool);
      if (coarse() && g && g.tools.length > 1 && !(tool === f && f !== 'cursor')) { openFly(g.id, b); return; }
      setTool((tool === f && f !== 'cursor' ? 'cursor' : f) as Tool);
    }
    else if (a === 'more') openFly(f, b);
    else if (a === 'pick') setTool(f as Tool);
    else if (a === 'mag') { prefs.mag = (prefs.mag + 1) % 3; savePrefs(); renderBar(); }
    else if (a === 'stay') { prefs.stay = !prefs.stay; savePrefs(); renderBar(); }
    else if (a === 'lockall') { prefs.lockAll = !prefs.lockAll; savePrefs(); renderBar(); }
    else if (a === 'hide') { prefs.hide = !prefs.hide; if (prefs.hide) { sel = null; selBar(); } savePrefs(); renderBar(); draw(); }
    else if (a === 'clearall') { if (!list.length) return; snap(); list = []; sel = null; save(); selBar(); draw(); }
    const d = list.find((x) => x.id === sel);
    if (d) {
      if (a === 'color') { snap(); d.c = f; prefs.c = f; savePrefs(); save(); selBar(); draw(); }
      else if (a === 'width') { snap(); d.w = d.w >= 4 ? 1 : d.w + 1; save(); selBar(); draw(); }
      else if (a === 'style') { snap(); d.s = ((d.s + 1) % 3) as 0 | 1 | 2; save(); selBar(); draw(); }
      else if (a === 'edit') editText(d);
      else if (a === 'lock') { snap(); d.lock = !d.lock; save(); selBar(); draw(); }
      else if (a === 'clone') { snap(); const c: Dw = { ...JSON.parse(JSON.stringify(d)), id: uid(), lock: false }; c.pts = c.pts.map((q) => ({ t: q.t + o.bucket * 3, p: q.p })); list.push(c); sel = c.id; save(); selBar(); draw(); }
      else if (a === 'del') { snap(); list = list.filter((x) => x.id !== d.id); sel = null; save(); selBar(); draw(); }
    }
  };
  const onTab = (e: Event) => { e.stopPropagation(); prefs.open = !prefs.open; if (!prefs.open) { setTool('cursor'); closeFly(); } savePrefs(); renderBar(); fit(); };
  [bar, fly, sbar].forEach((x) => { x.addEventListener('click', onBar); ['pointerdown', 'mousedown', 'touchstart'].forEach((t) => x.addEventListener(t, (e) => e.stopPropagation())); });
  tab.addEventListener('click', onTab);
  ['pointerdown', 'mousedown', 'touchstart'].forEach((t) => tab.addEventListener(t, (e) => e.stopPropagation()));

  // Keyboard while the pointer is over the chart: Delete removes the selection, Esc cancels, Ctrl+Z / Ctrl+Y.
  let over = false;
  const enter = () => { over = true; }, leave = () => { over = false; el.classList.remove('cdwhov', 'cdwgrab'); };
  el.addEventListener('mouseenter', enter); el.addEventListener('mouseleave', leave);
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const full = card?.classList.contains('lfull');
    if (!over && !full && !sel && !draft) return;
    if (e.key === 'Escape' && (draft || tool !== 'cursor' || sel)) { e.preventDefault(); e.stopImmediatePropagation(); draft = null; sel = null; selBar(); setTool('cursor'); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); snap(); list = list.filter((x) => x.id !== sel); sel = null; save(); selBar(); draw(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && (over || full)) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && (over || full)) { e.preventDefault(); redo(); return; }
    if (e.altKey && (over || full)) {
      const map: Record<string, Tool> = { t: 'trend', h: 'hline', v: 'vline', f: 'fib', c: 'cross', j: 'hray' };
      const tt = map[e.key.toLowerCase()]; if (tt) { e.preventDefault(); if (!prefs.open) { prefs.open = true; savePrefs(); } setTool(tt); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  const onDocDown = (e: Event) => { if (!fly.contains(e.target as Node) && !(e.target as HTMLElement)?.closest?.('.cdwmore')) closeFly(); };
  document.addEventListener('pointerdown', onDocDown, true);

  renderBar(); undoState(); draw();

  return {
    destroy: () => {
      dead = true; cancelAnimationFrame(raf); freeze(false);
      el.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      el.removeEventListener('dblclick', onDbl, true);
      ['mousedown', 'touchstart', 'touchmove', 'mouseup', 'touchend', 'click'].forEach((t) => el.removeEventListener(t, block, { capture: true }));
      el.removeEventListener('mouseenter', enter); el.removeEventListener('mouseleave', leave);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDocDown, true);
      [cv, bar, tab, fly, sbar].forEach((x) => x.remove());
      el.querySelectorAll('.cdwinput').forEach((x) => x.remove());
      el.classList.remove('cdwon', 'cdraw', 'cdwhov', 'cdwgrab');
    },
    redraw: () => { sig = ''; },
    toggleBar: () => { prefs.open = !prefs.open; if (!prefs.open) setTool('cursor'); savePrefs(); renderBar(); fit(); },
    undo, redo,
    place: () => { sig = ''; },
  };
}
