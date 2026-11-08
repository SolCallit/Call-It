'use client';

import dynamic from 'next/dynamic';
import { PRIVY_APP_ID } from '@/lib/config';
import WalletGuard from '@/components/WalletGuard';

// Privy (and its wallet SDKs) is the heaviest part of the bundle. It loads in its own chunk next to the
// app instead of wrapping it, so the feed and landing paint first and sign-in wakes up a moment later.
const PrivyLayer = dynamic(() => import('@/components/PrivyLayer'), { ssr: false });
if (typeof window !== 'undefined' && PRIVY_APP_ID) window.__callitRealAuth = true;

/** App-wide providers. */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {PRIVY_APP_ID ? <WalletGuard><PrivyLayer /></WalletGuard> : null}
    </>
  );
}
