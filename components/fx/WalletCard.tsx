'use client';

import { useEffect, useState } from 'react';
import HoloCard from '@/components/rb/HoloCard';
import Counter from '@/components/rb/Counter';
import { drawWalletArt } from './cardArt';

export interface WalletCardProps {
  name: string;
  addr: string;
  total: number;
  d24: number;
  p24: number;
}

const signed = (n: number, digits = 2) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

/** The Callit card at the top of the wallet: holographic foil (React Bits Holo Card) with a live, rolling balance (React Bits Counter). */
export default function WalletCard({ name, addr, total, d24, p24 }: WalletCardProps) {
  const [art, setArt] = useState<string>();

  useEffect(() => {
    let live = true;
    drawWalletArt({ name, addr }).then(u => {
      if (live) setArt(u);
    });
    return () => {
      live = false;
    };
  }, [name, addr]);

  const up = d24 >= 0;
  return (
    <HoloCard
      image={art}
      preset="swirl"
      intensity={0.5}
      glare={0.4}
      edgeSparkle={0.45}
      width={430}
      radius={22}
      tiltMax={9}
      hoverScale={1.02}
      alt="Your Callit card"
      className="cwc"
      style={{ ['--hc-ratio' as string]: 856 / 540 }}
    >
      <div className="cwc-ov">
        <div className="cwc-lab">
          Portfolio
          <span className="cwc-live">
            <i />
            Live
          </span>
        </div>
        <div className="cwc-val">
          <Counter value={Math.round(total * 100) / 100} prefix="$" decimals={2} fontSize="10.5cqw" fontWeight={800} textColor="#ffffff" />
        </div>
        <div className={`cwc-chg ${up ? 'up' : 'down'}`}>
          {signed(d24).replace(/^([+−])/, '$1$')} ({signed(p24)}%)<span>today</span>
        </div>
      </div>
    </HoloCard>
  );
}
