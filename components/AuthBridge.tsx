'use client';

import { useEffect, useRef, useState } from 'react';
import { usePrivy, useLogin, useLoginWithOAuth } from '@privy-io/react-auth';
import { useCreateWallet, useExportWallet, useSignMessage, useSignTransaction, useWallets } from '@privy-io/react-auth/solana';
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
  const { wallets, ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const creating = useRef(false);
  const { login } = useLogin();
  const { initOAuth } = useLoginWithOAuth();
  const synced = useRef<string>('');
  const [resync, setResync] = useState(0);
  const walletFlow = useRef<WalletSignInHandle>(null);
  const { signTransaction } = useSignTransaction();
  const { signMessage } = useSignMessage();
  const { exportWallet } = useExportWallet();

  // Expose the user's wallet to the engine: real balances, swaps and withdrawals.
  // The engine only ever gets back signed bytes; keys stay in Privy / Phantom / Solflare.
  useEffect(() => {
    const b64ToBytes = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
    const bytesToB64 = (u: Uint8Array) => {
      let s = '';
      for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
      return btoa(s);
    };
    window.CallitWallet = {
      addresses: authenticated ? wallets.map((w) => w.address) : [],
      token: () => getAccessToken(),
      signTx: async (tx, owner) => {
        if (!authenticated || !wallets.length) throw new Error('No wallet connected. Sign in again.');
        // Sign with the exact wallet the transaction was built for. Falling back to another
        // wallet produces a signature the network rejects, so say what's wrong instead.
        const w = owner ? wallets.find((x) => x.address === owner) : wallets[0];
        if (!w) throw new Error(`Wallet ${owner!.slice(0, 4)}…${owner!.slice(-4)} isn't connected in this browser. Reconnect it, or sign in again.`);
        try {
          const { signedTransaction } = await signTransaction({ transaction: b64ToBytes(tx), wallet: w, chain: 'solana:mainnet' });
          return bytesToB64(signedTransaction);
        } catch (e) {
          console.error('[callit] sign failed', w.address, e);
          throw e; // the wallet client turns this into a readable message and logs it
        }
      },
      // Signs a plain-text message (Jupiter order login). Returns the signature as base64.
      signMsg: async (text, owner) => {
        const w = (owner && wallets.find((x) => x.address === owner)) || wallets[0];
        if (!authenticated || !w) throw new Error('No wallet connected. Sign in again.');
        const { signature } = await signMessage({ message: new TextEncoder().encode(text), wallet: w });
        return bytesToB64(signature);
      },
      embedded: authenticated ? wallets.filter((w) => (w as { isPrivyWallet?: boolean }).isPrivyWallet).map((w) => w.address) : [],
      // Privy shows the private key in its own isolated window; the key never reaches Callit's code.
      exportKey: async (address) => {
        if (!authenticated) throw new Error('Sign in first.');
        await exportWallet(address ? { address } : undefined);
      },
    };
    window.callitWalletChanged?.();
  }, [authenticated, wallets, signTransaction, signMessage, getAccessToken, exportWallet]);

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
        const j = (await r.json().catch(() => ({}))) as { profile?: CallitProfile; error?: string };
        if (!r.ok) throw new Error(j.error && !/^[a-z_]+$/.test(j.error) ? j.error : 'Couldn’t save your profile. Try again.');
        return j.profile || null;
      },
      refreshNotifs: () => {
        getAccessToken().then((t) => { if (t) loadNotifs(t); }).catch(() => {});
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

  // Accounts created before Solana wallets were switched on (or where creation was
  // interrupted) have no wallet, which leaves Deposit stuck on "still being set up".
  // Create the embedded Solana wallet for them once; the sync below then picks it up.
  useEffect(() => {
    if (!ready || !authenticated || !user || !walletsReady || wallets.length || creating.current) return;
    const hasSol = (user.linkedAccounts || []).some(
      (a) => a.type === 'wallet' && (a as { chainType?: string }).chainType === 'solana',
    );
    if (hasSol) return;
    creating.current = true;
    createWallet().catch((e) => {
      console.error('[callit] could not create Solana wallet:', e);
      creating.current = false;
    });
  }, [ready, authenticated, user, walletsReady, wallets.length, createWallet]);

  // After sign-in (and again once the embedded wallet exists), load the profile.
  const walletKey = wallets.map((w) => w.address).join(',');
  useEffect(() => {
    if (!ready) return;
    if (!authenticated || !user) {
      // Also clears a session the engine reopened from cache if Privy says it has expired.
      if (synced.current || window.__callitRestored) { synced.current = ''; apply(null); window.callitSetNotifs?.(null); }
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

  // Keep notifications fresh: every 30s while the tab is visible, and right away when it comes back.
  useEffect(() => {
    if (!ready || !authenticated) return;
    const pull = () => { if (!document.hidden) getAccessToken().then((t) => { if (t) loadNotifs(t); }).catch(() => {}); };
    const iv = setInterval(pull, 30_000);
    document.addEventListener('visibilitychange', pull);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', pull); };
  }, [ready, authenticated, getAccessToken]);

  return <WalletSignIn ref={walletFlow} />;
}
