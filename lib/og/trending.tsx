import { ImageResponse } from 'next/og';
import type { LiveToken } from '@/lib/market/sources';

const money = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`);
const pct = (v: number) => `${v >= 0 ? '' : '−'}${Math.abs(v) >= 1000 ? Math.round(Math.abs(v)).toLocaleString('en-US') : Math.abs(v).toFixed(1)}%`;

/** Renders the Top gainers card. `logo` is an absolute URL or data URI of the white megaphone. */
export function trendingCard(o: { top: LiveToken[]; icons: (string | null)[]; tf: string; key: 'h1' | 'h6' | 'h24'; logo: string; bold: ArrayBuffer | null; mono: ArrayBuffer | null; headers?: Record<string, string> }) {
  const { top, icons, tf, key, bold, mono } = o;
  const fonts = [bold && { name: 'G', data: bold, weight: 700 as const }, mono && { name: 'M', data: mono, weight: 700 as const }].filter(Boolean) as { name: string; data: ArrayBuffer; weight: 700 }[];
  const day = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const W = 1600, H = 1250, GAP = 36, PAD = 56, CW = (W - PAD * 2 - GAP * 2) / 3, CH = 330;
  const tile: React.CSSProperties = { width: CW, height: CH, borderRadius: 34, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '34px 36px', border: '2px solid rgba(255,255,255,0.14)' };

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', padding: PAD, color: '#fff', fontFamily: 'G',
        background: 'radial-gradient(90% 70% at 0% 0%, #12345A 0%, rgba(11,27,39,0) 60%), radial-gradient(80% 70% at 100% 100%, #0E4D3A 0%, rgba(11,27,39,0) 60%), #060E16' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: GAP }}>
          <div style={{ ...tile, background: 'linear-gradient(160deg, #0F2233 0%, #070F17 100%)' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 58, lineHeight: 1, letterSpacing: -1, whiteSpace: 'nowrap' }}>TOP GAINERS</span>
              <span style={{ fontSize: 58, lineHeight: 1.15, color: '#3DDC97' }}>{tf.toUpperCase()}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <img src={o.logo} width={52} height={52} alt="" />
              <span style={{ fontSize: 42 }}>Callit</span>
              <span style={{ fontFamily: 'M', fontSize: 18, color: '#8FA6BA', marginLeft: 6, marginTop: 8 }}>ON SOLANA</span>
            </div>
          </div>
          {top.map((t, i) => (
            <div key={t.mint} style={{ ...tile, background: 'linear-gradient(135deg, #17365A 0%, #123049 45%, #0F4A3A 100%)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
                <div style={{ width: 132, height: 132, borderRadius: 999, padding: 5, display: 'flex', background: 'linear-gradient(135deg, #4DA8FF, #3DDC97)' }}>
                  {icons[i]
                    ? <img src={icons[i] as string} width={122} height={122} style={{ borderRadius: 999, border: '4px solid #0B1B27' }} alt="" />
                    : <div style={{ width: 122, height: 122, borderRadius: 999, background: '#1E3A54', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>{t.sym.slice(0, 2).toUpperCase()}</div>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontSize: t.sym.length > 10 ? 28 : t.sym.length > 7 ? 34 : 44, lineHeight: 1.05 }}>${t.sym.toUpperCase()}</span>
                  <span style={{ fontFamily: 'M', fontSize: 20, color: '#8FA6BA', marginTop: 8 }}>MC {money(t.mc || 0)}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, color: '#3DDC97' }}>
                <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#3DDC97" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg>
                <span style={{ fontSize: 68, lineHeight: 1, letterSpacing: -1 }}>{pct(t.chg[key] as number)}</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <img src={o.logo} width={44} height={44} alt="" />
            <span style={{ fontSize: 34 }}>CALLIT</span>
            <span style={{ fontFamily: 'M', fontSize: 20, color: '#8FA6BA', marginLeft: 8 }}>Call it. Get paid.</span>
          </div>
          <span style={{ fontFamily: 'M', fontSize: 22, color: '#8FA6BA' }}>{day} · callit.buzz</span>
        </div>
      </div>
    ),
    { width: W, height: H, fonts: fonts.length ? fonts : undefined, headers: o.headers },
  );
}
