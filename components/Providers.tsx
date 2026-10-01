'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { PRIVY_APP_ID } from '@/lib/config';
import AuthBridge from '@/components/AuthBridge';

const solanaConnectors = toSolanaWalletConnectors({ shouldAutoConnect: true });
if (typeof window !== 'undefined' && PRIVY_APP_ID) window.__callitRealAuth = true;

/** App-wide providers: Privy auth + embedded Solana wallets. */
export default function Providers({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) return <>{children}</>;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['email', 'google', 'twitter', 'wallet'],
        appearance: {
          theme: 'dark',
          accentColor: '#4DA8FF',
          logo: '/icon-192.png',
          landingHeader: 'Sign in to Callit',
          loginMessage: 'Call it. Get Paid.',
          walletChainType: 'solana-only',
          showWalletLoginFirst: false,
        },
        embeddedWallets: { solana: { createOnLogin: 'users-without-wallets' }, ethereum: { createOnLogin: 'off' } },
        externalWallets: { solana: { connectors: solanaConnectors } },
      }}
    >
      <AuthBridge />
      {children}
    </PrivyProvider>
  );
}
