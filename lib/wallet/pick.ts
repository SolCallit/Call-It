/**
 * Which wallet signs. One address can be connected twice: as the user's Privy wallet and in
 * Phantom/Solflare (when the Privy key was imported there). Privy always lists its own wallet
 * first, so signing in with Phantom still popped Privy's window. The rule: sign with the wallet
 * app they signed in with, when it holds that address; otherwise use the Privy wallet.
 */

type Signable = { address: string; standardWallet?: { name?: string; isPrivyWallet?: boolean } };
type Signer = { address: string; name: string };

const KEY = 'callit.signer';

/** Called after a wallet sign-in ("Phantom", "Solflare"…). */
export function rememberSigner(address: string, name: string) {
  try { localStorage.setItem(KEY, JSON.stringify({ address, name })); } catch { /* private mode */ }
}

/** Called on email / Google / X sign-in and on sign-out. */
export function forgetSigner() {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}

function signer(): Signer | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && typeof v.address === 'string' && typeof v.name === 'string' ? v : null;
  } catch { return null; }
}

/** The wallet that should sign for `owner`, or undefined if it isn't connected here. */
export function pickWallet<T extends Signable>(wallets: T[], owner?: string, via: Signer | null = signer()): T | undefined {
  if (!owner) return wallets[0];
  const same = wallets.filter((w) => w.address === owner);
  if (via && via.address === owner) {
    const ext = same.find((w) => !w.standardWallet?.isPrivyWallet && w.standardWallet?.name === via.name);
    if (ext) return ext;
  }
  return same[0];
}
