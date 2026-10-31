'use client';

import { useEffect, useState } from 'react';
import HoloCard from '@/components/rb/HoloCard';
import { drawCallerBack, drawCallerFront, rarity, type CallerData } from './cardArt';

/** Latest front art per handle, so "Share card" can send the picture without redrawing it. */
export const CARD_ART = new Map<string, string>();

/** A caller's holographic trading card (React Bits Holo Card). Gold for the top 3, stars for the top 10. Tap to flip. */
export default function CallerCard({ width = 300, ...d }: CallerData & { width?: number }) {
  const [front, setFront] = useState<string>();
  const [back, setBack] = useState<string>();
  const key = JSON.stringify(d);

  useEffect(() => {
    let live = true;
    drawCallerFront(d).then(u => {
      if (!live) return;
      setFront(u);
      CARD_ART.set(d.handle, u);
    });
    drawCallerBack(d).then(u => {
      if (live) setBack(u);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const r = rarity(d.rank);
  return (
    <HoloCard
      image={front}
      backImage={back}
      preset={r}
      width={width}
      radius={18}
      intensity={r === 'glitter' ? 0.6 : r === 'gold' ? 0.68 : 0.8}
      glare={0.45}
      tiltMax={14}
      alt={`${d.name || d.handle}'s Callit caller card`}
      className="ccard"
    />
  );
}
