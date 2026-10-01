'use client';

import { useEffect, useRef } from 'react';
import { usePrivy, useLogin, useLoginWithOAuth } from '@privy-io/react-auth';
import { useWallets } from '@privy-io/react-auth/solana';
import type { CallitProfile } from '@/lib/auth/types';

/** Hands a session (or sign-out) to the UI engine, queueing it if the engine hasn't booted yet. */
function apply(p: CallitProfile | null, opts?: { isNew?: boolean }) {
  if (window.callitApplySession) window.callitApplySession(p, opts);
  else window.__callitPendingSession = { p, opts };
}

/**
 * Connects Privy to the app: exposes login/logout to the UI and, once a user is
 * signed in, exchanges the Privy token for their Callit profile from our API.
 */
export default function AuthBridge() {
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { login } = useLogin();
  const { initOAuth } = useLoginWithOAuth();
  const synced = useRef<string>('');

  // Expose controls to the legacy engine.
  useEffect(() => {
    window.CallitAuth = {
      enabled: true,
      ready,
      authenticated,
      login: (via, opts) => {
        if (via === 'Google') return void initOAuth({ provider: 'google' }).catch(() => login());
        if (via === 'X') return void initOAuth({ provider: 'twitter' }).catch(() => login());
        if (via === 'Email' && opts?.email) return login({ loginMethods: ['email'], prefill: { type: 'email', value: opts.email } });
        if (via && ['Phantom', 'Solflare', 'Backpack', 'wallet'].includes(via)) return login({ loginMethods: ['wallet'], walletChainType: 'solana-only' });
        login();
      },
      logout: async () => {
        synced.current = '';
        await logout();
        apply(null);
      },
      saveProfile: async (patch) => {
        const token = await getAccessToken();
        if (!token) return null;
        const r = await fetch('/api/profile', { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(patch) });
        if (!r.ok) return null;
        const j = (await r.json()) as { profile: CallitProfile };
        return j.profile;
      },
    };
    window.callitAuthChanged?.();
  }, [ready, authenticated, login, initOAuth, logout, getAccessToken]);

  // After sign-in (and again once the embedded wallet exists), load the profile.
  const walletKey = wallets.map((w) => w.address).join(',');
  useEffect(() => {
    if (!ready) return;
    if (!authenticated || !user) {
      if (synced.current) { synced.current = ''; apply(null); }
      return;
    }
    const key = `${user.id}|${walletKey}`;
    if (synced.current === key) return;
    synced.current = key;
    (async () => {
      const token = await getAccessToken();
      if (!token) return;
      const r = await fetch('/api/session', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) { synced.current = ''; return; }
      const j = (await r.json()) as { profile: CallitProfile; isNew: boolean };
      // Fall back to the wallet the browser can see if the server hasn't got it yet.
      if (!j.profile.wallet_address && wallets[0]) j.profile.wallet_address = wallets[0].address;
      apply(j.profile, { isNew: j.isNew });
    })();
  }, [ready, authenticated, user, walletKey, wallets, getAccessToken]);

  return null;
}
