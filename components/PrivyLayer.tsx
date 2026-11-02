'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { PRIVY_APP_ID } from '@/lib/config';
import AuthBridge from '@/components/AuthBridge';

const solanaConnectors = toSolanaWalletConnectors({ shouldAutoConnect: true });

/** Privy auth + embedded Solana wallets. Loaded after the app shell so it never blocks first paint. */
export default function PrivyLayer() {
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
    </PrivyProvider>
  );
}
