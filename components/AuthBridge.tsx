'use client';

import { useEffect, useRef, useState } from 'react';
import { usePrivy, useLogin, useLoginWithOAuth } from '@privy-io/react-auth';
import { useWallets } from '@privy-io/react-auth/solana';
import type { User } from '@privy-io/react-auth';
import type { CallitProfile, CallitNotification } from '@/lib/auth/types';
import { toHandle } from '@/lib/auth/handle';
import WalletSignIn, { type WalletSignInHandle } from '@/components/WalletSignIn';

/** Hands a session (or sign-out) to the UI engine, queueing it if the engine hasn't booted yet. */
function apply(p: CallitProfile | null, opts?: { isNew?: boolean }) {
  if (window.callitApplySession) window.callitApplySession(p, opts);
  else window.__callitPendingSession = { p, opts };
}

/** Pulls the user's real notifications into the UI. */
async function loadNotifs(token: string) {
  try {
    const r = await fetch('/api/notifications', { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) return;
    const j = (await r.json()) as { notifications: CallitNotification[] };
    window.callitSetNotifs?.(j.notifications);
  } catch { /* keep whatever is showing */ }
}

/** Profile built from the Privy user in the browser, used when our API can't be reached. */
function localProfile(user: User, wallet: string | null): CallitProfile {
  const x = user.twitter?.username || null;
  const emailLocal = (user.email?.address || user.google?.email || '').split('@')[0] || null;
  return {
    id: user.id, privy_id: user.id, handle: toHandle(x || emailLocal, wallet),
    display_name: user.twitter?.name || user.google?.name || null, bio: null, website: null,
    x_handle: x, avatar_url: null, banner_url: null, wallet_address: wallet,
  };
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
  const [resync, setResync] = useState(0);
  const walletFlow = useRef<WalletSignInHandle>(null);

  // Expose controls to the legacy engine.
  useEffect(() => {
    window.CallitAuth = {
      enabled: true,
      ready,
      authenticated,
      login: (via, opts) => {
        // Already signed in with Privy but the app lost the session: re-sync instead of
        // calling login(), which Privy ignores for an authenticated user.
        if (authenticated) { synced.current = ''; setResync((n) => n + 1); return; }
        if (via === 'Google') return void initOAuth({ provider: 'google' }).catch(() => login());
        if (via === 'X') return void initOAuth({ provider: 'twitter' }).catch(() => login());
        if (via === 'Email' && opts?.email) return login({ loginMethods: ['email'], prefill: { type: 'email', value: opts.email } });
        if (via === 'Email') return login({ loginMethods: ['email'] });
        if (via && ['Phantom', 'Solflare', 'Backpack', 'wallet'].includes(via)) return walletFlow.current?.start();
        login({ loginMethods: ['email', 'google', 'twitter'] });
      },
      logout: async () => {
        synced.current = '';
        await logout();
        apply(null);
        window.callitSetNotifs?.(null);
      },
      markRead: async (ids) => {
        const token = await getAccessToken();
        if (!token) return;
        await fetch('/api/notifications', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify(ids === 'all' ? { all: true } : { ids }),
        }).catch(() => {});
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

  // Privy's OAuth redirect leaves ?privy_oauth_* params in the URL; tidy them once signed in.
  useEffect(() => {
    if (!ready || !authenticated) return;
    const u = new URL(window.location.href);
    const keys = [...u.searchParams.keys()].filter((k) => k.startsWith('privy_'));
    if (!keys.length) return;
    keys.forEach((k) => u.searchParams.delete(k));
    window.history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
  }, [ready, authenticated]);

  // After sign-in (and again once the embedded wallet exists), load the profile.
  const walletKey = wallets.map((w) => w.address).join(',');
  useEffect(() => {
    if (!ready) return;
    if (!authenticated || !user) {
      if (synced.current) { synced.current = ''; apply(null); window.callitSetNotifs?.(null); }
      return;
    }
    const key = `${user.id}|${walletKey}`;
    if (synced.current === key) return;
    synced.current = key;
    (async () => {
      const wallet = wallets[0]?.address || null;
      try {
        const token = await getAccessToken();
        if (!token) throw new Error('no_access_token');
        const r = await fetch('/api/session', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
        if (!r.ok) throw new Error(`session_http_${r.status}`);
        const j = (await r.json()) as { profile: CallitProfile; isNew: boolean; persisted?: boolean; reason?: string };
        if (j.persisted === false) console.warn('[callit] profile not saved:', j.reason);
        // Fall back to the wallet the browser can see if the server hasn't got it yet.
        if (!j.profile.wallet_address && wallet) j.profile.wallet_address = wallet;
        apply(j.profile, { isNew: j.isNew });
        loadNotifs(token);
      } catch (e) {
        // Never strand a signed-in user: sign them into the UI from the Privy user directly.
        console.error('[callit] session sync failed, using local profile:', e);
        apply(localProfile(user, wallet));
      }
    })();
  }, [ready, authenticated, user, walletKey, wallets, getAccessToken, resync]);

  return <WalletSignIn ref={walletFlow} />;
}
