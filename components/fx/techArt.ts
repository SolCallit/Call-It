/**
 * The shareable picture of a caller card (what "Share card" sends): a still of the live card, drawn on a 2D canvas
 * so it works on every phone. Layout mirrors .tc-* in app/v10.css, 1cqw = 9px.
 */
import { DISPLAY, GRADE, MONO, gradeOf, pct, serial, type CallerData } from './techKit';

const W = 900;
const H = 1260;
const U = W / 100;

let fontsReady: Promise<unknown> | null = null;
const fonts = () =>
  (fontsReady ||= Promise.all(
    [`800 76px ${DISPLAY}`, `500 30px ${MONO}`, `600 28px ${MONO}`, `700 30px ${MONO}`].map(f => document.fonts?.load(f).catch(() => null))
  ));

const loadImg = (src?: string | null): Promise<HTMLImageElement | null> =>
  new Promise(res => {
    if (!src) return res(null);
    const i = new Image();
    if (!src.startsWith('data:')) i.crossOrigin = 'anonymous';
    i.decoding = 'async';
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });

let logoImg: Promise<HTMLImageElement | null> | null = null;
const logo = () => (logoImg ||= loadImg('/mega-white.png'));

function seeded(s: string) {
  let a = 2166136261;
  for (const c of s) a = Math.imul(a ^ c.charCodeAt(0), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

function spaced(x: CanvasRenderingContext2D, text: string, l: number, t: number, px: number) {
  const ls = x as CanvasRenderingContext2D & { letterSpacing?: string };
  const prev = ls.letterSpacing;
  ls.letterSpacing = `${px}px`;
  x.fillText(text, l, t);
  ls.letterSpacing = prev ?? '0px';
}

function fit(x: CanvasRenderingContext2D, text: string, weight: number, family: string, size: number, max: number, min = 24) {
  let s = size;
  x.font = `${weight} ${s}px ${family}`;
  while (x.measureText(text).width > max && s > min) {
    s -= 2;
    x.font = `${weight} ${s}px ${family}`;
  }
}

/** Points every ~5px around a rounded rectangle, with outward normals. */
function perimeter(l: number, t: number, w: number, h: number, r: number) {
  const pts: { x: number; y: number; nx: number; ny: number }[] = [];
  const line = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 5));
    for (let i = 0; i < n; i++) pts.push({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n, nx, ny });
  };
  const arc = (cx: number, cy: number, a0: number) => {
    const n = Math.max(2, Math.round((r * Math.PI) / 2 / 5));
    for (let i = 0; i < n; i++) {
      const a = a0 + ((Math.PI / 2) * i) / n;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) });
    }
  };
  line(l + r, t, l + w - r, t, 0, -1);
  arc(l + w - r, t + r, -Math.PI / 2);
  line(l + w, t + r, l + w, t + h - r, 1, 0);
  arc(l + w - r, t + h - r, 0);
  line(l + w - r, t + h, l + r, t + h, 0, 1);
  arc(l + r, t + h - r, Math.PI / 2);
  line(l, t + h - r, l, t + r, -1, 0);
  arc(l + r, t + r, Math.PI);
  return pts;
}

/** A still of the Electric Border: a few jittering strands around the card with a soft glow. */
function current(x: CanvasRenderingContext2D, line: string, glow: string, rnd: () => number) {
  const pts = perimeter(16, 16, W - 32, H - 32, 40);
  const strand = (amp: number, width: number, color: string, blur: number, alpha: number) => {
    const f1 = 0.018 + rnd() * 0.01, f2 = 0.07 + rnd() * 0.05, p1 = rnd() * 9, p2 = rnd() * 9;
    x.beginPath();
    pts.forEach((p, i) => {
      const s = i * 5;
      const o = amp * (Math.sin(s * f1 + p1) * 0.55 + Math.sin(s * f2 + p2) * 0.3 + (rnd() - 0.5) * 0.5);
      const px = p.x + p.nx * o, py = p.y + p.ny * o;
      if (i) x.lineTo(px, py);
      else x.moveTo(px, py);
    });
    x.closePath();
    x.save();
    x.globalAlpha = alpha;
    x.shadowColor = glow;
    x.shadowBlur = blur;
    x.strokeStyle = color;
    x.lineWidth = width;
    x.lineJoin = 'round';
    x.stroke();
    x.restore();
  };
  strand(7, 7, rgba(glow, 0.5), 46, 0.9);
  strand(6, 2.4, line, 22, 0.75);
  strand(4, 2.2, line, 18, 0.85);
  strand(2, 1.6, '#eef7ff', 10, 0.95);
}

/** The shareable caller card, as a JPEG blob. */
export async function drawCallerShare(d: CallerData): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  await fonts();
  const g = GRADE[gradeOf(d.rank)];
  const rnd = seeded(d.handle);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  if (!x) return null;

  // Ground and the character field (a still of Letter Glitch).
  x.fillStyle = '#04080f';
  x.fillRect(0, 0, W, H);
  const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$&*()-_+=/[]{};:<>.,0123456789';
  x.font = `500 21px ${MONO}`;
  x.textBaseline = 'middle';
  x.textAlign = 'center';
  for (let row = 0; row < 48; row++) {
    for (let col = 0; col < 54; col++) {
      const px = 9 + col * 16.6, py = 14 + row * 26.2;
      const dx = (px - W / 2) / (W / 2), dy = (py - H * 0.45) / (H / 2);
      const edge = Math.min(1, Math.hypot(dx, dy));
      const hot = rnd() < 0.05 + edge * 0.06;
      const k = hot ? 1 + ((rnd() * (g.glyphs.length - 1)) | 0) : 0;
      x.fillStyle = hot ? g.glyphs[k] : g.ink;
      x.globalAlpha = hot ? 0.35 + edge * 0.5 : 0.07 + edge * 0.1;
      x.fillText(CH[(rnd() * CH.length) | 0], px, py);
    }
  }
  x.globalAlpha = 1;
  x.textAlign = 'left';

  // Scrim (keeps the middle calm and the text readable) and scanlines.
  const sc = x.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.42, H * 0.75);
  sc.addColorStop(0, 'rgba(3,7,13,.9)');
  sc.addColorStop(0.55, 'rgba(3,7,13,.66)');
  sc.addColorStop(1, 'rgba(3,7,13,.35)');
  x.fillStyle = sc;
  x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(255,255,255,.022)';
  for (let y = 0; y < H; y += 4) x.fillRect(0, y, W, 1);

  // HUD corners.
  x.strokeStyle = rgba(g.line, 0.7);
  x.lineWidth = 2.5;
  const cn = 3.2 * U, cl = 4.4 * U;
  [
    [cn, cn, 1, 1],
    [W - cn, cn, -1, 1],
    [cn, H - cn, 1, -1],
    [W - cn, H - cn, -1, -1]
  ].forEach(([px, py, sx, sy]) => {
    x.beginPath();
    x.moveTo(px, py + sy * cl);
    x.lineTo(px, py);
    x.lineTo(px + sx * cl, py);
    x.stroke();
  });

  // Head: kicker and rank chip.
  const P = 7 * U;
  x.textBaseline = 'middle';
  x.fillStyle = g.ink;
  x.font = `600 ${3.1 * U}px ${MONO}`;
  spaced(x, 'CALLIT // CALLER', P, P + 2.5 * U, 0.24 * 3.1 * U);
  const rk = d.rank ? `#${String(d.rank).padStart(2, '0')}` : 'NEW';
  x.font = `700 ${3.4 * U}px ${MONO}`;
  const rw = x.measureText(rk).width + 4.4 * U + 0.08 * 3.4 * U * rk.length;
  x.beginPath();
  x.roundRect(W - P - rw, P - 0.4 * U, rw, 5.8 * U, 1.4 * U);
  x.fillStyle = 'rgba(3,8,15,.7)';
  x.fill();
  x.strokeStyle = rgba(g.line, 0.6);
  x.lineWidth = 2;
  x.stroke();
  x.fillStyle = '#ffffff';
  spaced(x, rk, W - P - rw + 2.2 * U, P + 2.5 * U, 0.08 * 3.4 * U);

  // Avatar with its ring.
  const cx = W / 2, cy = 35 * U, r = 16 * U;
  x.save();
  x.shadowColor = g.glow;
  x.shadowBlur = 50;
  x.strokeStyle = rgba(g.line, 0.85);
  x.lineWidth = 0.6 * U;
  for (let k = 0; k < 4; k++) {
    x.beginPath();
    x.arc(cx, cy, r + 3 * U, k * (Math.PI / 2) + 0.15, k * (Math.PI / 2) + 0.95);
    x.stroke();
  }
  x.restore();
  x.strokeStyle = rgba(g.line, 0.22);
  x.lineWidth = 2;
  x.beginPath();
  x.arc(cx, cy, r + 5.6 * U, 0, Math.PI * 2);
  x.stroke();
  const av = await loadImg(d.avatar);
  x.save();
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
  x.clip();
  if (av) {
    const s = Math.max((2 * r) / av.naturalWidth, (2 * r) / av.naturalHeight);
    x.drawImage(av, cx - (av.naturalWidth * s) / 2, cy - (av.naturalHeight * s) / 2, av.naturalWidth * s, av.naturalHeight * s);
  } else {
    let hh = 0;
    for (const ch of d.handle) hh = (hh * 31 + ch.charCodeAt(0)) >>> 0;
    hh %= 360;
    const gg = x.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    gg.addColorStop(0, `hsl(${hh} 70% 52%)`);
    gg.addColorStop(1, `hsl(${(hh + 40) % 360} 62% 30%)`);
    x.fillStyle = gg;
    x.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    x.fillStyle = '#ffffff';
    x.font = `800 ${11 * U}px ${DISPLAY}`;
    x.textAlign = 'center';
    x.fillText((d.name || d.handle).slice(0, 2).toUpperCase(), cx, cy + U * 0.4);
    x.textAlign = 'left';
  }
  x.restore();
  x.strokeStyle = 'rgba(255,255,255,.18)';
  x.lineWidth = 2;
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
  x.stroke();

  // Name and handle.
  const name = d.name || d.handle;
  x.textAlign = 'center';
  x.fillStyle = '#ffffff';
  fit(x, name, 800, DISPLAY, 8.4 * U, 86 * U);
  x.save();
  x.shadowColor = rgba(g.line, 0.45);
  x.shadowBlur = 24;
  x.fillText(name, W / 2, 61.6 * U);
  x.restore();
  const hd = `@${d.handle}${d.tier ? ` · ${d.tier.toUpperCase()}` : ''}`;
  x.fillStyle = '#9fb6cc';
  fit(x, hd, 500, MONO, 3.3 * U, 86 * U, 18);
  x.fillText(hd, W / 2, 69.5 * U);
  x.textAlign = 'left';

  // Stats.
  const calls = d.calls || 0;
  const cells: [string, string, string][] = [
    ['WIN RATE', d.win != null && calls ? `${Math.round(d.win)}%` : '—', '#ffffff'],
    ['CALLS', String(calls), '#ffffff'],
    ['BEST CALL', calls ? pct(d.best) : '—', calls && (d.best || 0) > 0 ? '#3DDC97' : '#ffffff'],
    ['AVG RETURN', calls ? pct(d.avg) : '—', calls && d.avg ? (d.avg > 0 ? '#3DDC97' : '#FF6B8A') : '#ffffff']
  ];
  const cw = (86 * U - 2.4 * U) / 2, chh = 20 * U, top = 82 * U;
  cells.forEach(([lab, val, col], i) => {
    const l = P + (i % 2) * (cw + 2.4 * U), t = top + Math.floor(i / 2) * (chh + 2.4 * U);
    x.beginPath();
    x.roundRect(l, t, cw, chh, 2.4 * U);
    x.fillStyle = 'rgba(3,8,15,.66)';
    x.fill();
    x.strokeStyle = rgba(g.line, 0.24);
    x.lineWidth = 2;
    x.stroke();
    x.textBaseline = 'alphabetic';
    x.fillStyle = '#7f97ad';
    x.font = `600 ${2.7 * U}px ${MONO}`;
    spaced(x, lab, l + 3 * U, t + 6.2 * U, 0.16 * 2.7 * U);
    x.fillStyle = col;
    fit(x, val, 800, DISPLAY, 7 * U, cw - 6 * U);
    x.fillText(val, l + 3 * U, t + chh - 3.4 * U);
  });

  // Footer.
  x.textBaseline = 'middle';
  x.fillStyle = '#8fa6ba';
  x.font = `600 ${2.8 * U}px ${MONO}`;
  const fy = 131 * U;
  spaced(x, 'CALLIT.BUZZ', P, fy, 0.2 * 2.8 * U);
  const no = `NO. ${serial(d)}`;
  const nw = x.measureText(no).width + 0.2 * 2.8 * U * no.length;
  spaced(x, no, W - P - nw, fy, 0.2 * 2.8 * U);
  const lg = await logo();
  if (lg) x.drawImage(lg, W / 2 - 2.5 * U, fy - 2.5 * U, 5 * U, 5 * U);

  current(x, g.line, g.glow, rnd);

  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.92));
}
