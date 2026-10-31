'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import ElectricBorder from '@/components/rb/ElectricBorder';
import LetterGlitch from '@/components/rb/LetterGlitch';
import { drawCallerShare } from './techArt';
import { Decrypt, GRADE, gradeOf, pct, serial, useFinePointer, usePageLight, type CallerData } from './techKit';

/** Latest share picture per handle, so "Share card" can open the share sheet straight from the tap. */
export const CARD_ART = new Map<string, Blob>();

const hueOf = (s: string) => {
  let x = 0;
  for (const c of s) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return x % 360;
};

/**
 * A caller's card: a glitching character field (React Bits Letter Glitch) inside a live current
 * (React Bits Electric Border). Callerboard rank sets the current: amber top 3, cyan top 10, blue ranked.
 */
export default function CallerCard(d: CallerData) {
  const light = usePageLight();
  const fine = useFinePointer();
  const [avOk, setAvOk] = useState(true);
  const g = GRADE[gradeOf(d.rank)];
  const key = JSON.stringify(d);

  // The share picture is drawn once the page is idle, so the tap on "Share card" can open the share sheet at once.
  useEffect(() => {
    let live = true;
    const run = () =>
      drawCallerShare(d).then(b => {
        if (live && b) CARD_ART.set(d.handle, b);
      });
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const id = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 2500 }) : window.setTimeout(run, 900);
    return () => {
      live = false;
      if (w.cancelIdleCallback) w.cancelIdleCallback(id);
      else clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const name = d.name || d.handle;
  const calls = d.calls || 0;
  const cells: [string, string, string][] = [
    ['WIN RATE', d.win != null && calls ? `${Math.round(d.win)}%` : '—', ''],
    ['CALLS', String(calls), ''],
    ['BEST CALL', calls ? pct(d.best) : '—', calls && (d.best || 0) > 0 ? 'up' : ''],
    ['AVG RETURN', calls ? pct(d.avg) : '—', calls && d.avg ? (d.avg > 0 ? 'up' : 'down') : '']
  ];
  const h = hueOf(d.handle);

  return (
    <ElectricBorder
      className="tc"
      color={g.line}
      glowColor={g.glow}
      speed={0.75}
      chaos={0.42}
      thickness={1.2}
      strands={2}
      glow={0.6}
      intensity={0.8}
      arcs={0.7}
      flicker={0.4}
      borderRadius={18}
      theme={light ? 'light' : 'dark'}
    >
      <div
        className="tc-card"
        style={{ '--tc-line': g.line, '--tc-ink': g.ink } as CSSProperties}
        role="img"
        aria-label={`${name}'s Callit caller card${d.rank ? `, rank ${d.rank}` : ''}`}
      >
        <LetterGlitch
          className="tc-bg"
          glitchColors={g.glyphs}
          baseColor={g.ink}
          baseOpacity={0.26}
          fontSize={12}
          centerFade={0.55}
          interactive={fine}
        />
        <div className="tc-scrim" />
        <i className="tc-scan" aria-hidden="true" />
        <div className="t-hud" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="tc-ov" aria-hidden="true">
          <div className="tc-head">
            <span>CALLIT // CALLER</span>
            <span className="tc-rank">{d.rank ? `#${String(d.rank).padStart(2, '0')}` : 'NEW'}</span>
          </div>
          <div className="tc-av">
            <i className="tc-ring" />
            {d.avatar && avOk ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.avatar} alt="" onError={() => setAvOk(false)} />
            ) : (
              <span style={{ background: `linear-gradient(135deg, hsl(${h} 70% 52%), hsl(${(h + 40) % 360} 62% 30%))` }}>
                {name.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <Decrypt className="tc-name" text={name} />
          <span className="tc-handle">
            @{d.handle}
            {d.tier ? ` · ${d.tier.toUpperCase()}` : ''}
          </span>
          <div className="tc-stats">
            {cells.map(([lab, val, tone]) => (
              <div key={lab} className="tc-cell">
                <span>{lab}</span>
                <b className={tone}>{val}</b>
              </div>
            ))}
          </div>
          <div className="tc-foot">
            <span>CALLIT.BUZZ</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/mega-white.png" alt="" />
            <span>NO. {serial(d)}</span>
          </div>
        </div>
      </div>
    </ElectricBorder>
  );
}
