'use client';
import { useEffect } from 'react';

export default function GoTransparency() {
  useEffect(() => { location.replace('/#/transparency'); }, []);
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0B1B27', color: '#fff', fontFamily: 'sans-serif' }}>
      <a href="/#/transparency" style={{ color: '#4DA8FF' }}>Open Callit Transparency →</a>
    </main>
  );
}
