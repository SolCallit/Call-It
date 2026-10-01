import type { Metadata, Viewport } from 'next';
import './globals.css';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://call-it-chi.vercel.app';

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
  themeColor: '#0B1B27',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Schibsted+Grotesk:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
