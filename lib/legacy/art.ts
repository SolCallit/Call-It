/*
 * Callit wallet art: original scenes drawn in code (no image files, no network).
 * Each scene is an SVG string sized to cover its card. The scene shown on the
 * wallet changes every time someone signs in, and stays put for the session.
 */

type Rand = () => number;
const rng = (seed: number): Rand => {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const f = (n: number) => Math.round(n * 10) / 10;

/** Blue-first palettes so every scene sits well on Callit's navy. */
const PAL: [string, string, string][] = [
  ['#4DA8FF', '#9B7BFF', '#5EEAD4'],
  ['#38BDF8', '#6366F1', '#3DDC97'],
  ['#60A5FA', '#C084FC', '#22D3EE'],
  ['#4DA8FF', '#F472B6', '#FBBF24'],
];

let uid = 0;
type Scene = (r: Rand, c: [string, string, string], id: string) => string;

const stars = (r: Rand, n: number, x0 = 0) =>
  Array.from({ length: n }, () => {
    const s = r() < 0.15 ? 1.6 : 0.9;
    return `<circle cx="${f(x0 + r() * (400 - x0))}" cy="${f(r() * 220)}" r="${s}" fill="#fff" opacity="${f(0.25 + r() * 0.55)}"/>`;
  }).join('');

/** Megaphone signal: sound waves rolling out from a call. */
const signal: Scene = (r, [a, b, c], id) => {
  const cx = 372, cy = 118;
  const arcs = Array.from({ length: 10 }, (_, i) => {
    const R = 34 + i * 30, sp = 0.95 - i * 0.03;
    const x1 = cx - R * Math.cos(sp), y1 = cy - R * Math.sin(sp), y2 = cy + R * Math.sin(sp);
    return `<path d="M${f(x1)} ${f(y1)}A${R} ${R} 0 0 0 ${f(x1)} ${f(y2)}" stroke="url(#${id}g)" stroke-width="${f(2.6 - i * 0.18)}" opacity="${f(0.95 - i * 0.08)}" fill="none" stroke-linecap="round"/>`;
  }).join('');
  const dots = Array.from({ length: 16 }, () => {
    const R = 50 + r() * 280, t = (r() - 0.5) * 1.6;
    return `<circle cx="${f(cx - R * Math.cos(t))}" cy="${f(cy + R * Math.sin(t))}" r="${f(1 + r() * 2.2)}" fill="${r() < 0.5 ? c : a}" opacity="${f(0.5 + r() * 0.5)}"/>`;
  }).join('');
  return `<defs><linearGradient id="${id}g" x1="1" x2="0"><stop offset="0" stop-color="${a}"/><stop offset=".6" stop-color="${b}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient>
  <radialGradient id="${id}h"><stop offset="0" stop-color="${a}" stop-opacity=".9"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient></defs>
  <circle cx="${cx}" cy="${cy}" r="70" fill="url(#${id}h)" opacity=".55"/>${arcs}${dots}`;
};

/** Aurora: soft ribbons of light. */
const aurora: Scene = (r, [a, b, c], id) => {
  const ribbon = (y: number, amp: number, col: string, w: number, o: number) => {
    const p = r() * 6;
    let d = `M-20 ${y}`;
    for (let x = 0; x <= 440; x += 40) d += ` L${x} ${f(y + Math.sin(x / 70 + p) * amp)}`;
    return `<path d="${d}" stroke="${col}" stroke-width="${w}" fill="none" opacity="${o}" stroke-linecap="round" filter="url(#${id}b)"/>`;
  };
  return `<defs><filter id="${id}b" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="14"/></filter></defs>
  ${stars(r, 26, 120)}${ribbon(70, 26, b, 46, 0.7)}${ribbon(110, 32, a, 38, 0.8)}${ribbon(150, 22, c, 30, 0.6)}${ribbon(95, 18, '#fff', 4, 0.35)}`;
};

/** Candle skyline: a city built from candles, under a coin moon. */
const skyline: Scene = (r, [a, b, c], id) => {
  const row = (base: number, n: number, hMax: number, o: number, col: string) => {
    let x = 110, out = '';
    for (let i = 0; i < n && x < 410; i++) {
      const w = 8 + r() * 10, h = 20 + r() * hMax, up = r() < 0.62;
      out += `<line x1="${f(x + w / 2)}" x2="${f(x + w / 2)}" y1="${f(base - h - 10 - r() * 14)}" y2="${base}" stroke="${up ? col : '#FF6B8A'}" stroke-width="1.2" opacity="${o}"/>`;
      out += `<rect x="${f(x)}" y="${f(base - h)}" width="${f(w)}" height="${f(h)}" rx="2" fill="${up ? col : '#FF6B8A'}" opacity="${o}"/>`;
      x += w + 5 + r() * 6;
    }
    return out;
  };
  return `<defs><radialGradient id="${id}m" cx=".4" cy=".35"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>
  <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}" stop-opacity="0"/><stop offset="1" stop-color="${a}" stop-opacity=".35"/></linearGradient></defs>
  ${stars(r, 30, 100)}<circle cx="330" cy="62" r="30" fill="url(#${id}m)" opacity=".9"/><circle cx="330" cy="62" r="42" fill="none" stroke="${a}" stroke-width="1" opacity=".4"/>
  <circle cx="330" cy="62" r="56" fill="none" stroke="${a}" stroke-width=".7" opacity=".2"/>
  ${row(230, 30, 50, 0.26, b)}${row(232, 26, 78, 0.5, c)}<rect x="0" y="150" width="400" height="80" fill="url(#${id}f)"/>`;
};

/** Orbit: coins circling a glowing core. */
const orbit: Scene = (r, [a, b, c], id) => {
  const cx = 338, cy = 70;
  const rings = [64, 102, 142, 186].map((R, i) => {
    const t = (r() * 360) | 0;
    const dx = R * Math.cos(t * Math.PI / 180), dy = R * 0.36 * Math.sin(t * Math.PI / 180);
    return `<ellipse cx="${cx}" cy="${cy}" rx="${R}" ry="${f(R * 0.36)}" fill="none" stroke="${i % 2 ? b : a}" stroke-width="1.1" opacity="${f(0.7 - i * 0.12)}"/>
    <circle cx="${f(cx + dx)}" cy="${f(cy + dy)}" r="${f(4.5 - i * 0.6)}" fill="${[c, a, '#fff', b][i]}"/><circle cx="${f(cx + dx)}" cy="${f(cy + dy)}" r="${f(11 - i)}" fill="${[c, a, '#fff', b][i]}" opacity=".18"/>`;
  }).join('');
  return `<defs><radialGradient id="${id}s" cx=".35" cy=".3"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>
  <radialGradient id="${id}h"><stop offset="0" stop-color="${b}" stop-opacity=".7"/><stop offset="1" stop-color="${b}" stop-opacity="0"/></radialGradient></defs>
  ${stars(r, 22, 140)}<circle cx="${cx}" cy="${cy}" r="90" fill="url(#${id}h)"/><g transform="rotate(-12 ${cx} ${cy})">${rings}</g><circle cx="${cx}" cy="${cy}" r="26" fill="url(#${id}s)"/>`;
};

/** Caller constellation: a network of callers, one lighting up. */
const constellation: Scene = (r, [a, b, c], id) => {
  const pts = Array.from({ length: 15 }, () => [150 + r() * 245, 14 + r() * 192]);
  let lines = '';
  pts.forEach((p, i) => pts.forEach((q, j) => {
    if (j <= i) return;
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < 92) lines += `<line x1="${f(p[0])}" y1="${f(p[1])}" x2="${f(q[0])}" y2="${f(q[1])}" stroke="${a}" stroke-width="1" opacity="${f(0.75 - d / 140)}"/>`;
  }));
  const [hx, hy] = pts[0];
  const nodes = pts.map(([x, y], i) => `<circle cx="${f(x)}" cy="${f(y)}" r="${i ? f(1.8 + r() * 2) : 5}" fill="${i ? (r() < 0.4 ? c : '#fff') : a}" opacity="${i ? 0.85 : 1}"/>`).join('');
  const pulse = [14, 26, 40].map((R, i) => `<circle cx="${f(hx)}" cy="${f(hy)}" r="${R}" fill="none" stroke="${b}" stroke-width="1.2" opacity="${f(0.6 - i * 0.17)}"/>`).join('');
  return `${stars(r, 18, 120)}${lines}${pulse}${nodes}`;
};

/** Topo: contour lines, like a map of the trenches. */
const topo: Scene = (r, [a, b], id) => {
  const cx = 330, cy = 70, ph = r() * 6;
  const ring = (R: number) => {
    let d = '';
    for (let k = 0; k <= 48; k++) {
      const t = (k / 48) * Math.PI * 2;
      const rr = R * (1 + 0.16 * Math.sin(3 * t + ph) + 0.08 * Math.sin(5 * t + ph * 2));
      d += `${k ? 'L' : 'M'}${f(cx + rr * Math.cos(t) * 1.25)} ${f(cy + rr * Math.sin(t))}`;
    }
    return d + 'Z';
  };
  return `<defs><linearGradient id="${id}t" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
  ${Array.from({ length: 11 }, (_, i) => `<path d="${ring(16 + i * 18)}" fill="none" stroke="url(#${id}t)" stroke-width="${i % 3 ? 0.9 : 1.6}" opacity="${f(0.85 - i * 0.06)}"/>`).join('')}
  <circle cx="${cx}" cy="${cy}" r="3.5" fill="#fff"/>`;
};

/** Horizon: sunset sun over a neon grid. */
const horizon: Scene = (r, [a, b, c], id) => {
  const hy = 150;
  const vert = Array.from({ length: 15 }, (_, i) => {
    const x = -140 + i * 50;
    return `<line x1="${f(280 + (x - 280) * 0.08)}" y1="${hy}" x2="${x}" y2="230" stroke="${a}" stroke-width="1" opacity=".55"/>`;
  }).join('');
  const hor = [0, 6, 14, 26, 44, 70].map((d) => `<line x1="0" x2="400" y1="${hy + d}" y2="${hy + d}" stroke="${a}" stroke-width="1" opacity="${f(0.3 + d / 140)}"/>`).join('');
  const cuts = [0, 1, 2, 3].map((i) => `<rect x="230" y="${108 + i * 10}" width="110" height="${2 + i * 1.4}" style="fill:var(--art-cut,#0B1B27)"/>`).join('');
  return `<defs><linearGradient id="${id}u" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FBBF24"/><stop offset=".5" stop-color="#F472B6"/><stop offset="1" stop-color="${b}"/></linearGradient>
  <radialGradient id="${id}g"><stop offset="0" stop-color="#F472B6" stop-opacity=".55"/><stop offset="1" stop-color="#F472B6" stop-opacity="0"/></radialGradient></defs>
  ${stars(r, 22, 120)}<circle cx="285" cy="110" r="88" fill="url(#${id}g)"/><circle cx="285" cy="110" r="46" fill="url(#${id}u)"/>${cuts}
  <rect x="0" y="${hy}" width="400" height="80" style="fill:var(--art-cut,#0B1B27)" opacity=".55"/>${vert}${hor}<line x1="0" x2="400" y1="${hy}" y2="${hy}" stroke="${c}" stroke-width="1.6"/>`;
};

const SCENES: [string, Scene][] = [
  ['signal', signal], ['aurora', aurora], ['skyline', skyline], ['orbit', orbit],
  ['constellation', constellation], ['topo', topo], ['horizon', horizon],
];
export const ART_COUNT = SCENES.length;

/** One scene as an absolutely-positioned SVG layer. `slot` lets several cards share a login's art without repeating. */
export function walletArt(seed: number, slot = 0, cls = 'art'): string {
  const n = ((seed + slot * 3) % SCENES.length + SCENES.length) % SCENES.length;
  const [name, draw] = SCENES[n];
  const id = `wa${uid++}`;
  const pal = PAL[(seed + slot) % PAL.length];
  return `<svg class="${cls} art-${name}" viewBox="0 0 400 220" preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false"><g class="artg">${draw(rng(seed * 7919 + slot * 104729 + 1), pal, id)}</g></svg>`;
}

/** Which art this session shows. A new sign-in moves to the next scene. */
const KEY = 'callit.art';
let current: number | null = null;
export function artSeed(): number {
  if (current != null) return current;
  try { current = Number(localStorage.getItem(KEY)) || 0; } catch { current = 0; }
  return current;
}
export function nextArtOnLogin(): void {
  try {
    if (sessionStorage.getItem(KEY)) return; // already moved on this visit
    sessionStorage.setItem(KEY, '1');
    current = (artSeed() + 1 + Math.floor(Math.random() * (SCENES.length - 1))) % 997;
    localStorage.setItem(KEY, String(current));
  } catch { current = (artSeed() + 1) % 997; }
}
