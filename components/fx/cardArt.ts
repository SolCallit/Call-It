/**
 * Canvas art for Callit's holographic cards (React Bits Holo Card renders the foil on top).
 * - Caller card: a trading card per caller (front + back), rarity from Callerboard rank.
 * - Callit card: the wallet's credit-card style card (live numbers are an HTML overlay, not baked in).
 */

export type Rarity = 'gold' | 'stars' | 'cosmos' | 'glitter';

export interface CallerData {
  handle: string;
  name: string;
  avatar?: string | null;
  rank?: number | null;
  tier?: string | null;
  win?: number | null;
  calls?: number | null;
  best?: number | null;
  avg?: number | null;
}

export interface WalletArtData {
  name: string;
  addr: string;
}

const FB = "'Bricolage Grotesque', 'Schibsted Grotesk', system-ui, sans-serif";
const FS = "'Schibsted Grotesk', system-ui, sans-serif";

/** Top 3 gold, top 10 stars, ranked cosmos, everyone else glitter. */
export const rarity = (rank?: number | null): Rarity => (rank && rank <= 3 ? 'gold' : rank && rank <= 10 ? 'stars' : rank ? 'cosmos' : 'glitter');

const PAL: Record<Rarity, { a: string; b: string; ac: string; ring: string }> = {
  gold: { a: '#5c400d', b: '#160e03', ac: '#ffd166', ring: 'rgba(255,209,102,.6)' },
  stars: { a: '#1d4f86', b: '#07121d', ac: '#9ccaff', ring: 'rgba(156,202,255,.55)' },
  cosmos: { a: '#3b2d86', b: '#0b0a1f', ac: '#c4b5fd', ring: 'rgba(196,181,253,.55)' },
  glitter: { a: '#173b5e', b: '#07121d', ac: '#8fb3d6', ring: 'rgba(143,179,214,.5)' }
};

let fontsReady: Promise<unknown> | null = null;
const fonts = () =>
  (fontsReady ||= Promise.all(
    [`800 64px ${FB}`, `700 28px ${FS}`, `600 28px ${FS}`, `800 28px ${FS}`].map(f => document.fonts?.load(f).catch(() => null))
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

const hueOf = (s: string) => {
  let x = 0;
  for (const c of s) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return x % 360;
};

const pct = (n?: number | null) => {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  return (n >= 0 ? '+' : '−') + (a >= 1000 ? Math.round(a).toLocaleString('en-US') : a >= 100 ? Math.round(a) : a.toFixed(1)) + '%';
};

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d') as CanvasRenderingContext2D] as const;
}

function box(x: CanvasRenderingContext2D, l: number, t: number, w: number, h: number, r: number) {
  x.beginPath();
  x.roundRect(l, t, w, h, r);
}

function spaced(x: CanvasRenderingContext2D, text: string, l: number, t: number, px: number) {
  const ls = (x as CanvasRenderingContext2D & { letterSpacing?: string });
  const prev = ls.letterSpacing;
  ls.letterSpacing = `${px}px`;
  x.fillText(text, l, t);
  ls.letterSpacing = prev ?? '0px';
}

function fitText(x: CanvasRenderingContext2D, text: string, weight: number, family: string, size: number, max: number, min = 26) {
  let s = size;
  x.font = `${weight} ${s}px ${family}`;
  while (x.measureText(text).width > max && s > min) {
    s -= 2;
    x.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

function texture(x: CanvasRenderingContext2D, w: number, h: number, kind: 'lines' | 'rings') {
  x.save();
  x.globalAlpha = 0.05;
  x.strokeStyle = '#ffffff';
  x.lineWidth = 2;
  if (kind === 'lines') {
    for (let k = -h; k < w + h; k += 22) {
      x.beginPath();
      x.moveTo(k, 0);
      x.lineTo(k - h * 0.7, h);
      x.stroke();
    }
  } else {
    for (let r = 30; r < w * 1.6; r += 26) {
      x.beginPath();
      x.arc(w * 1.08, -h * 0.12, r, 0, Math.PI * 2);
      x.stroke();
    }
  }
  x.restore();
}

/** Front of a caller's card: avatar, name, rank and four numbers from the Callerboard. */
export async function drawCallerFront(d: CallerData): Promise<string> {
  await fonts();
  const W = 630, H = 880;
  const [c, x] = canvas(W, H);
  const P = PAL[rarity(d.rank)];
  const g = x.createRadialGradient(W / 2, 0, 40, W / 2, 0, H * 1.05);
  g.addColorStop(0, P.a);
  g.addColorStop(1, P.b);
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  texture(x, W, H, 'lines');
  x.strokeStyle = 'rgba(255,255,255,.14)';
  x.lineWidth = 2;
  box(x, 18, 18, W - 36, H - 36, 22);
  x.stroke();

  x.textBaseline = 'middle';
  x.fillStyle = P.ac;
  x.font = `800 22px ${FS}`;
  spaced(x, 'CALLIT · CALLER', 44, 63, 4);
  const rk = d.rank ? `#${d.rank}` : 'NEW';
  x.font = `800 26px ${FS}`;
  const rw = x.measureText(rk).width + 36;
  box(x, W - 44 - rw, 41, rw, 44, 22);
  x.fillStyle = 'rgba(255,255,255,.08)';
  x.fill();
  x.strokeStyle = P.ring;
  x.lineWidth = 2;
  x.stroke();
  x.fillStyle = P.ac;
  x.fillText(rk, W - 44 - rw + 18, 64);

  const cx = W / 2, cy = 238, r = 118;
  x.save();
  x.shadowColor = P.ring;
  x.shadowBlur = 60;
  x.beginPath();
  x.arc(cx, cy, r + 9, 0, Math.PI * 2);
  x.fillStyle = 'rgba(255,255,255,.12)';
  x.fill();
  x.restore();
  const av = await loadImg(d.avatar);
  x.save();
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
  x.clip();
  if (av) {
    const s = Math.max((2 * r) / av.naturalWidth, (2 * r) / av.naturalHeight);
    x.drawImage(av, cx - (av.naturalWidth * s) / 2, cy - (av.naturalHeight * s) / 2, av.naturalWidth * s, av.naturalHeight * s);
  } else {
    const h = hueOf(d.handle);
    const gg = x.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    gg.addColorStop(0, `hsl(${h} 70% 56%)`);
    gg.addColorStop(1, `hsl(${(h + 40) % 360} 62% 34%)`);
    x.fillStyle = gg;
    x.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    x.fillStyle = '#ffffff';
    x.font = `800 92px ${FB}`;
    x.textAlign = 'center';
    x.fillText((d.name || d.handle).slice(0, 2).toUpperCase(), cx, cy + 4);
    x.textAlign = 'left';
  }
  x.restore();

  x.textAlign = 'center';
  x.fillStyle = '#ffffff';
  fitText(x, d.name || d.handle, 800, FB, 62, W - 96);
  x.fillText(d.name || d.handle, W / 2, 410);
  x.fillStyle = 'rgba(205,222,238,.88)';
  fitText(x, `@${d.handle}${d.tier ? ` · ${d.tier}` : ''}`, 600, FS, 27, W - 96, 18);
  x.fillText(`@${d.handle}${d.tier ? ` · ${d.tier}` : ''}`, W / 2, 458);
  x.textAlign = 'left';

  const cells: [string, string, boolean][] = [
    ['Win rate', d.win != null && d.calls ? `${Math.round(d.win)}%` : '—', false],
    ['Calls', String(d.calls || 0), false],
    ['Best call', d.calls ? pct(d.best) : '—', !!d.calls && (d.best || 0) > 0],
    ['Avg return', d.calls ? pct(d.avg) : '—', !!d.calls && (d.avg || 0) > 0]
  ];
  const cw = (W - 88 - 16) / 2;
  cells.forEach(([lab, val, up], i) => {
    const l = 44 + (i % 2) * (cw + 16), t = 506 + Math.floor(i / 2) * 132;
    box(x, l, t, cw, 116, 20);
    x.fillStyle = 'rgba(255,255,255,.07)';
    x.fill();
    x.strokeStyle = 'rgba(255,255,255,.13)';
    x.lineWidth = 1.5;
    x.stroke();
    x.textBaseline = 'alphabetic';
    x.fillStyle = 'rgba(175,196,216,.92)';
    x.font = `600 21px ${FS}`;
    x.fillText(lab, l + 20, t + 38);
    x.fillStyle = up ? '#3DDC97' : '#ffffff';
    fitText(x, val, 800, FB, 44, cw - 36);
    x.fillText(val, l + 18, t + 92);
  });

  x.textBaseline = 'middle';
  x.fillStyle = 'rgba(160,184,206,.88)';
  x.font = `800 21px ${FS}`;
  spaced(x, 'CALLIT.BUZZ', 44, H - 50, 2);
  x.textAlign = 'right';
  x.fillText(`No. ${String(d.rank || ((hueOf(d.handle) * 7919) % 9999)).padStart(4, '0')}`, W - 44, H - 50);
  x.textAlign = 'left';
  const lg = await logo();
  if (lg) x.drawImage(lg, W / 2 - 18, H - 68, 36, 36);
  return c.toDataURL('image/jpeg', 0.92);
}

/** Back of the caller card: the brand, the slogan and the caller's handle. */
export async function drawCallerBack(d: CallerData): Promise<string> {
  await fonts();
  const W = 630, H = 880;
  const [c, x] = canvas(W, H);
  const P = PAL[rarity(d.rank)];
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#0f2740');
  g.addColorStop(1, '#060d16');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  texture(x, W, H, 'rings');
  x.strokeStyle = P.ring;
  x.lineWidth = 3;
  box(x, 22, 22, W - 44, H - 44, 22);
  x.stroke();
  box(x, W / 2 - 100, 190, 200, 200, 52);
  x.fillStyle = '#0B1B27';
  x.fill();
  x.strokeStyle = 'rgba(77,168,255,.45)';
  x.lineWidth = 3;
  x.stroke();
  const lg = await logo();
  if (lg) x.drawImage(lg, W / 2 - 64, 226, 128, 128);
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillStyle = '#ffffff';
  x.font = `800 76px ${FB}`;
  x.fillText('Call it.', W / 2, 500);
  const gt = x.createLinearGradient(0, 540, 0, 620);
  gt.addColorStop(0, '#bfe2ff');
  gt.addColorStop(1, '#4DA8FF');
  x.fillStyle = gt;
  x.fillText('Get Paid.', W / 2, 584);
  x.fillStyle = 'rgba(205,222,238,.9)';
  fitText(x, `@${d.handle}`, 700, FS, 30, W - 120, 18);
  x.fillText(`@${d.handle}`, W / 2, 680);
  x.fillStyle = P.ac;
  x.font = `800 22px ${FS}`;
  x.fillText('CALLIT.BUZZ', W / 2, H - 64);
  return c.toDataURL('image/jpeg', 0.9);
}

/** The Callit card on the wallet. Balance, change and Live are live HTML on top, so the art never goes stale. */
export async function drawWalletArt(d: WalletArtData): Promise<string> {
  await fonts();
  const W = 856, H = 540;
  const [c, x] = canvas(W, H);
  const g = x.createRadialGradient(W * 1.0, 0, 30, W * 0.9, 0, W * 1.15);
  g.addColorStop(0, '#3d74de');
  g.addColorStop(0.35, '#18406f');
  g.addColorStop(0.7, '#0b1b2c');
  g.addColorStop(1, '#060e18');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  texture(x, W, H, 'rings');
  x.textBaseline = 'middle';
  box(x, 48, 40, 64, 64, 18);
  x.fillStyle = '#0B1B27';
  x.fill();
  x.strokeStyle = 'rgba(255,255,255,.2)';
  x.lineWidth = 2;
  x.stroke();
  const lg = await logo();
  if (lg) x.drawImage(lg, 59, 51, 42, 42);
  x.fillStyle = '#ffffff';
  x.font = `800 44px ${FB}`;
  x.fillText('Callit', 128, 74);
  x.fillStyle = 'rgba(207,227,255,.92)';
  x.font = `800 22px ${FS}`;
  x.textAlign = 'right';
  spaced(x, 'SOLANA', W - 48, 74, 5);
  x.textAlign = 'left';
  const cg = x.createLinearGradient(52, 140, 144, 210);
  cg.addColorStop(0, '#f4dc9f');
  cg.addColorStop(1, '#b8893c');
  box(x, 52, 136, 88, 66, 13);
  x.fillStyle = cg;
  x.fill();
  x.strokeStyle = 'rgba(70,45,10,.45)';
  x.lineWidth = 2;
  box(x, 70, 150, 52, 38, 7);
  x.stroke();
  x.beginPath();
  x.moveTo(96, 136);
  x.lineTo(96, 150);
  x.moveTo(96, 188);
  x.lineTo(96, 202);
  x.stroke();
  x.fillStyle = 'rgba(219,232,246,.95)';
  const nm = (d.name || 'Callit caller').toUpperCase();
  fitText(x, nm, 800, FS, 26, W * 0.5, 16);
  spaced(x, nm, 52, H - 52, 3);
  x.textAlign = 'right';
  x.font = `800 26px ${FS}`;
  const a = d.addr ? `${d.addr.slice(0, 4)} •••• ${d.addr.slice(-4)}` : '';
  spaced(x, a, W - 48, H - 52, 3);
  x.textAlign = 'left';
  return c.toDataURL('image/jpeg', 0.92);
}
