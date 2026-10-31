'use client';

/* Shared bits for Callit's dark tech cards (wallet card + caller card). */
import { useEffect, useState } from 'react';

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

export type Grade = 'gold' | 'cyan' | 'blue' | 'base';

/** Callerboard rank sets the card's current: amber for the top 3, cyan for the top 10, blue for everyone ranked. */
export const gradeOf = (rank?: number | null): Grade => (rank && rank <= 3 ? 'gold' : rank && rank <= 10 ? 'cyan' : rank ? 'blue' : 'base');

export const GRADE: Record<Grade, { line: string; glow: string; glyphs: string[]; ink: string }> = {
  gold: { line: '#FFC24D', glow: '#ff8a1c', glyphs: ['#3b2a0a', '#FFC24D', '#fff0c4'], ink: '#ffd98a' },
  cyan: { line: '#5CE1FF', glow: '#1fa8ff', glyphs: ['#0c3446', '#5CE1FF', '#dcfbff'], ink: '#a6efff' },
  blue: { line: '#4DA8FF', glow: '#2f7dff', glyphs: ['#123a63', '#4DA8FF', '#9fe8ff'], ink: '#9fd0ff' },
  base: { line: '#4DA8FF', glow: '#2a63c9', glyphs: ['#10304f', '#3b8be0', '#8cc8ff'], ink: '#8fb6db' }
};

export const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
export const DISPLAY = "'Bricolage Grotesque', 'Schibsted Grotesk', system-ui, sans-serif";

export const pct = (n?: number | null) => {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  return (n >= 0 ? '+' : '−') + (a >= 1000 ? Math.round(a).toLocaleString('en-US') : a >= 100 ? Math.round(a) : a.toFixed(1)) + '%';
};

export const shortAddr = (a?: string | null) => (a && a.length > 10 ? `${a.slice(0, 4)}····${a.slice(-4)}` : a || '');

export const serial = (d: CallerData) => {
  let x = 0;
  for (const c of d.handle) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return String(d.rank || (x % 9999) + 1).padStart(4, '0');
};

/** True when the page is in light theme (the app's toggle, else the phone's setting). */
export function usePageLight() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const read = () => {
      const t = root.dataset.theme;
      setLight(t === 'light' || (t !== 'dark' && !mq.matches));
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    mq.addEventListener('change', read);
    return () => {
      mo.disconnect();
      mq.removeEventListener('change', read);
    };
  }, []);
  return light;
}

/** Mouse/trackpad (not touch): only then do the backgrounds follow the pointer. */
export function useFinePointer() {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    setFine(window.matchMedia('(pointer: fine)').matches);
  }, []);
  return fine;
}

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=<>/';

/** Text that decrypts into place once, left to right. Screen readers get the real text straight away. */
export function Decrypt({ text, ms = 900, className }: { text: string; ms?: number; className?: string }) {
  const [out, setOut] = useState(text);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setOut(text);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const n = Math.floor(k * text.length);
      let s = text.slice(0, n);
      for (let i = n; i < text.length; i++) s += text[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      setOut(s);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, ms]);
  return (
    <span className={className}>
      <span aria-hidden="true">{out}</span>
      <span className="sr">{text}</span>
    </span>
  );
}
