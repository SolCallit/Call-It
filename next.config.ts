import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The commit this build came from, shown in the footer so anyone can match the live site to the public code.
  env: {
    NEXT_PUBLIC_BUILD_SHA: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7),
    // Private Withdraw: the Privacy Cash SDK reaches its relayer through Callit's same-origin proxy.
    NEXT_PUBLIC_RELAYER_API_URL: '/api/privacy/relayer',
  },
  // Old address -> callit.buzz. Pages only: /api keeps answering on both hosts so webhooks and
  // crons pointed at the old URL keep working. Switched on with REDIRECT_OLD_HOST=1 once Privy
  // allows the new domain (otherwise people would land where sign-in fails).
  async redirects() {
    if (process.env.REDIRECT_OLD_HOST !== '1') return [];
    const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.callit.buzz').replace(/\/$/, '');
    return [{ source: '/:path((?!api/).*)', has: [{ type: 'host', value: 'call-it-chi.vercel.app' }], destination: `${site}/:path`, permanent: false }];
  },
  async headers() {
    return [
      {
        // Browser security headers (clickjacking, MIME sniffing, HTTPS-only, referrer leaks).
        // The CSP only blocks other sites from framing Callit; it doesn't restrict scripts.
        source: '/(.*)',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
