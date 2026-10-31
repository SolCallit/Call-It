'use client';

import ElectricBorder from '@/components/rb/ElectricBorder';
import FaultyTerminal from '@/components/rb/FaultyTerminal';
import Counter from '@/components/rb/Counter';
import { shortAddr, useFinePointer, usePageLight } from './techKit';

export interface WalletCardProps {
  name: string;
  addr: string;
  total: number;
  d24: number;
  p24: number;
}

const signed = (n: number, digits = 2) =>
  `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

/**
 * The Callit card at the top of the wallet: a dark terminal screen (React Bits Faulty Terminal) inside a live
 * current (React Bits Electric Border), with a rolling balance (React Bits Counter). Tap it and the screen glitches.
 */
export default function WalletCard({ name, addr, total, d24, p24 }: WalletCardProps) {
  const light = usePageLight();
  const fine = useFinePointer();
  const up = d24 >= 0;
  return (
    <ElectricBorder
      className="tw"
      color="#4DA8FF"
      glowColor="#2f7dff"
      speed={0.7}
      chaos={0.4}
      thickness={1.2}
      strands={2}
      glow={0.55}
      intensity={0.75}
      arcs={0.6}
      flicker={0.35}
      borderRadius={20}
      theme={light ? 'light' : 'dark'}
    >
      <div className="tw-card">
        <FaultyTerminal
          className="tw-bg"
          tint="#4DA8FF"
          brightness={0.55}
          scale={1.4}
          mouseReact={fine}
          mouseStrength={0.12}
          dpr={1.5}
        />
        <div className="tw-scrim" />
        <div className="t-hud" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="tw-ov">
          <div className="tw-head">
            <span className="tw-logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mega-white.png" alt="" />
            </span>
            <b>Callit</b>
            <span className="tw-net">SOLANA · MAINNET</span>
          </div>
          <div className="tw-lab">
            PORTFOLIO
            <span className="tw-live">
              <i />
              LIVE
            </span>
          </div>
          <div className="tw-val">
            <Counter value={Math.round(total * 100) / 100} prefix="$" decimals={2} fontSize="10.7cqw" fontWeight={800} textColor="#ffffff" />
          </div>
          <div className={`tw-chg ${up ? 'up' : 'down'}`}>
            {signed(d24).replace(/^([+−])/, '$1$')} ({signed(p24)}%)<span>24H</span>
          </div>
          <div className="tw-foot">
            <span className="tw-name">{(name || 'Callit caller').toUpperCase()}</span>
            <span>{shortAddr(addr)}</span>
          </div>
        </div>
      </div>
    </ElectricBorder>
  );
}
