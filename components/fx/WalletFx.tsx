'use client';

import FaultyTerminal from '@/components/rb/FaultyTerminal';
import { useFinePointer } from './techKit';

/**
 * The moving screen behind the wallet panels (Portfolio, Earnings, Keys): React Bits Faulty Terminal in navy.
 * The panel's own content sits on top; tapping the panel makes the screen glitch.
 */
export default function WalletFx({ kind = 'pf' }: { kind?: string }) {
  const fine = useFinePointer();
  return (
    <FaultyTerminal
      className="wfx-screen"
      tint={kind === 'earn' ? '#3DDC97' : '#4DA8FF'}
      glyphs={kind === 'keys' ? 'characters' : kind === 'earn' ? 'dots' : 'blocks'}
      brightness={kind === 'pf' ? 0.6 : 0.45}
      scale={1.5}
      gridMul={[2, 1]}
      mouseReact={fine}
      mouseStrength={0.12}
      vignette={0.4}
      dpr={1.5}
    />
  );
}
