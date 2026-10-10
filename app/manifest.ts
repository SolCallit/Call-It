import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Callit',
    short_name: 'Callit',
    description: 'Call it. Get Paid. Crypto calls, tracked in public.',
    start_url: '/#/home',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0B1B27',
    theme_color: '#0B1B27',
    categories: ['finance', 'social'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
