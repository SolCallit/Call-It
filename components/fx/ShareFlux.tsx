'use client';

import FluxLines from '@/components/rb/FluxLines';

/** Live background for the "Flux" share card styles (React Bits Flux Lines on navy). */
const LOOKS: Record<string, string[]> = {
  flux: ['#e3f3ff', '#7cc4ff', '#ffffff'],
  fluxblue: ['#123a63', '#4DA8FF', '#bfe6ff']
};

export default function ShareFlux({ v = 'flux' }: { v?: string }) {
  return (
    <FluxLines
      className="xflux"
      colors={LOOKS[v] || LOOKS.flux}
      glow={2}
      rimWidth={0.23}
      lineWidth={1}
      flowDirection="down"
      mouseInteraction
      clickSwirl
      scale={1.65}
      shimmer={1.4}
      backgroundColor="#06101b"
      dpr={1.5}
    />
  );
}
