import type { Metadata, Viewport } from 'next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';
import './v6.css';
import './v7.css';
import './v8.css';
import './v9.css';
import './v10.css';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.callit.buzz';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: 'Callit',
  description: 'Call it. Get Paid. Crypto calls, tracked in public.',
  applicationName: 'Callit',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Callit', statusBarStyle: 'black-translucent' },
  openGraph: {
    title: 'Callit',
    description: 'Call it. Get Paid. Crypto calls, tracked in public.',
    url: SITE,
    siteName: 'Callit',
    images: [{ url: '/og.png', width: 1200, height: 630 }],
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: 'Callit', description: 'Call it. Get Paid.', images: ['/og.png'] },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Android Chrome: the page shrinks above the keyboard instead of being covered by it.
  interactiveWidget: 'resizes-content',
  themeColor: '#0B1B27',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Fonts must never hold up first paint: on a slow connection a blocking stylesheet from another
            host kept the launch screen up for seconds. It loads as print (non-blocking), then switches on. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          id="gfonts"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Schibsted+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap"
          rel="stylesheet"
          media="print"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: "(function(){var l=document.getElementById('gfonts');if(!l)return;var on=function(){l.media='all'};l.addEventListener('load',on);if(l.sheet)on()})()",
          }}
        />
        <noscript>
          <link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        </noscript>
      </head>
      <body>{children}<SpeedInsights /><Analytics /></body>
    </html>
  );
}
