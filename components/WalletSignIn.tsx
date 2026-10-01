'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { useConnectWallet, useLoginWithSiws, usePrivy } from '@privy-io/react-auth';
import { useWallets } from '@privy-io/react-auth/solana';

export type WalletSignInHandle = { start: () => void };

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const toB64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
};
const isRejection = (e: unknown) => /reject|denied|cancel|declin/i.test(String((e as Error)?.message ?? e));

/**
 * Sign-in with a Solana wallet in two explicit steps:
 *   1. connect the wallet (Privy modal)
 *   2. the user taps "Sign message", and that tap calls the wallet's signMessage directly.
 *
 * Mobile wallet browsers (Phantom, Solflare) only open the signing sheet when the
 * request comes straight from a user tap. Privy's one-shot modal fires the signature
 * right after connecting, with no tap in between, so on mobile it fails with
 * "Could not log in with wallet". Splitting the steps fixes that.
 */
const WalletSignIn = forwardRef<WalletSignInHandle>(function WalletSignIn(_, ref) {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { generateSiwsMessage, loginWithSiws } = useLoginWithSiws();
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const wanted = useRef(false);

  const { connectWallet } = useConnectWallet({
    onSuccess: ({ wallet }) => {
      if (!wanted.current) return;
      wanted.current = false;
      setErr('');
      setAddress(wallet.address);
    },
  });

  useImperativeHandle(ref, () => ({
    start: () => {
      wanted.current = true;
      // A wallet is already connected (e.g. inside Phantom's browser): go straight to signing.
      if (wallets[0] && !authenticated) {
        wanted.current = false;
        setErr('');
        setAddress(wallets[0].address);
        return;
      }
      connectWallet({ walletChainType: 'solana-only', description: 'Then sign a free message to prove it’s yours. No transaction, no fees.' });
    },
  }), [connectWallet, wallets, authenticated]);

  // Close once signed in.
  useEffect(() => { if (authenticated) setAddress(null); }, [authenticated]);

  const sign = useCallback(async () => {
    if (!address) return;
    const w = wallets.find((x) => x.address === address);
    if (!w) { setErr('Wallet disconnected. Connect it again.'); return; }
    setBusy(true); setErr('');
    try {
      const message = await generateSiwsMessage({ address });
      const { signature } = await w.signMessage({ message: new TextEncoder().encode(message) });
      await loginWithSiws({
        message,
        signature: toB64(signature),
        walletClientType: w.standardWallet.name.toLowerCase(),
        connectorType: 'injected',
      });
    } catch (e) {
      console.error('[callit] wallet sign-in failed:', e);
      setErr(isRejection(e) ? 'You cancelled the signature. Tap Sign message to try again.' : 'Couldn’t verify your wallet. Tap Sign message to try again.');
    } finally {
      setBusy(false);
    }
  }, [address, wallets, generateSiwsMessage, loginWithSiws]);

  const cancel = useCallback(async () => {
    const w = wallets.find((x) => x.address === address);
    setAddress(null); setErr('');
    try { await w?.disconnect(); } catch { /* ignore */ }
  }, [address, wallets]);

  if (!address || authenticated) return null;
  return (
    <div className="wsi-back" role="dialog" aria-modal="true" aria-labelledby="wsi-t" onClick={(e) => { if (e.target === e.currentTarget && !busy) cancel(); }}>
      <div className="wsi">
        <span className="mark wsi-mark" aria-hidden="true" />
        <h2 id="wsi-t">Confirm it’s your wallet</h2>
        <p className="wsi-sub">Sign a free message from <b className="num">{short(address)}</b> to sign in. This is not a transaction and costs nothing.</p>
        {err && <p className="wsi-err" role="alert">{err}</p>}
        <button className="btn primary block wsi-go" onClick={sign} disabled={busy}>{busy ? 'Check your wallet…' : 'Sign message'}</button>
        <button className="btn ghost block" onClick={cancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
});

export default WalletSignIn;
