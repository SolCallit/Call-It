'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { defaultSolanaRpcsPlugin, toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { PRIVY_APP_ID } from '@/lib/config';
import AuthBridge from '@/components/AuthBridge';

const WALLET_CONFIRM = process.env.NEXT_PUBLIC_WALLET_CONFIRM === '1';
const solanaConnectors = toSolanaWalletConnectors({ shouldAutoConnect: true });
// Privy's "Confirm transaction" window reads the chain (fee, balance, lookup tables) through an
// RPC. With none configured it throws while drawing, which took the whole page down on every
// embedded-wallet buy ("This page couldn't load"). Privy hosts one for exactly this window.
const plugins = [defaultSolanaRpcsPlugin()];

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
        embeddedWallets: {
          solana: { createOnLogin: 'users-without-wallets' },
          ethereum: { createOnLogin: 'off' },
          // In-app wallets sign straight away: the user already confirmed on Callit's own button
          // (amount and token shown there). NEXT_PUBLIC_WALLET_CONFIRM=1 brings Privy's window back.
          // Phantom / Solflare / Backpack still ask in their own app.
          showWalletUIs: WALLET_CONFIRM,
        },
        externalWallets: { solana: { connectors: solanaConnectors } },
        plugins,
      }}
    >
      <AuthBridge />
    </PrivyProvider>
  );
}
