'use client';

/**
 * Private Withdraw, built on Privacy Cash (a zero-knowledge shielded pool on Solana mainnet).
 *
 * Two steps, and the user controls the gap between them:
 *  1. Shield: the user's Callit wallet deposits into Privacy Cash's shared pool. The user signs this.
 *     Their private balance is encrypted notes only they can read.
 *  2. Send privately: a zero-knowledge proof spends those notes and Privacy Cash's relayer pays any
 *     address. The Callit wallet signs nothing and appears nowhere in that payout.
 * Waiting between the two, and not sending the exact amount you shielded, is what stops anyone
 * matching them up.
 *
 * Keys: the private balance key comes from the wallet signing "Privacy Money account sign in",
 * the same message privacycash.org uses. So a user can always see and withdraw the same balance on
 * privacycash.org with the same wallet, even if Callit is down. It's kept in memory for this tab only.
 *
 * Callit never sees a wallet key: every signature goes through window.CallitWallet.
 * The SDK and its ~19MB of proving files load only when the Private tab is used.
 */

import { PRIVATE_TOKENS, PRIVATE_WS, type PrivateToken } from './config';

export class PrivateError extends Error {
  constructor(message: string, public stage: string, public raw?: unknown) {
    super(message);
    this.name = 'TxError'; // the engine shows TxError messages as-is
  }
}

/** Shown when shielding worked but the send didn't. The engine never offers Retry on this one. */
export const SHIELDED_MSG = 'Shielded and safe in your private balance. Send it from Withdraw → Private.';

/** Keep this much SOL in the wallet for fees when shielding SOL. */
export const SOL_FEE_RESERVE = 0.01;

const KEY_BASE = '/circuit2/transaction2';
const SIGN_MESSAGE = 'Privacy Money account sign in';

const b64ToBytes = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
const bytesToB64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
};

function wallet() {
  const w = window.CallitWallet;
  if (!w) throw new PrivateError('Wallet not ready. Refresh and try again.', 'sign');
  return w;
}

type Libs = {
  web3: typeof import('@solana/web3.js');
  pc: typeof import('privacycash/utils');
  lightWasm: import('@lightprotocol/hasher.rs').LightWasm;
};
let LIBS: Promise<Libs> | null = null;
function libs(): Promise<Libs> {
  if (!LIBS) {
    LIBS = (async () => {
      const [web3, pc, hasher] = await Promise.all([
        import('@solana/web3.js'),
        import('privacycash/utils'),
        import('@lightprotocol/hasher.rs'),
      ]);
      const lightWasm = await hasher.WasmFactory.getInstance();
      return { web3, pc, lightWasm };
    })();
    LIBS.catch(() => { LIBS = null; });
  }
  return LIBS;
}

let SESSION: { owner: string; enc: InstanceType<Libs['pc']['EncryptionService']> } | null = null;

function connection(l: Libs) {
  return new l.web3.Connection(`${window.location.origin}/api/privacy/rpc`, { commitment: 'confirmed', wsEndpoint: PRIVATE_WS });
}

/** True once the user has unlocked their private balance in this tab. */
export const isUnlocked = (owner: string) => !!SESSION && SESSION.owner === owner;

/** One signature (free, no transaction) derives the key that reads the private balance. */
async function unlock(owner: string, step: (m: string) => void) {
  const l = await libs();
  if (SESSION?.owner === owner) return { l, enc: SESSION.enc };
  step('Approve the private balance signature (free)…');
  const sig = b64ToBytes(await wallet().signMsg(SIGN_MESSAGE, owner));
  const enc = new l.pc.EncryptionService();
  enc.deriveEncryptionKeyFromSignature(sig);
  SESSION = { owner, enc };
  return { l, enc };
}

export type PrivateBalances = Record<string, { ui: number; token: PrivateToken }>;

/** Private (shielded) balances. Asks for the unlock signature the first time. */
export async function privateBalances(owner: string, step: (m: string) => void = () => {}): Promise<PrivateBalances> {
  const { l, enc } = await unlock(owner, step);
  const conn = connection(l);
  const publicKey = new l.web3.PublicKey(owner);
  const out: PrivateBalances = {};
  for (const t of PRIVATE_TOKENS) {
    if (t.native) {
      const utxos = await l.pc.getUtxos({ publicKey, connection: conn, encryptionService: enc, storage: localStorage });
      out[t.sym] = { ui: l.pc.getBalanceFromUtxos(utxos).lamports / 1e9, token: t };
    } else {
      const utxos = await l.pc.getUtxosSPL({ publicKey, connection: conn, encryptionService: enc, storage: localStorage, mintAddress: t.mint });
      out[t.sym] = { ui: l.pc.getBalanceFromUtxosSPL(utxos).base_units / 10 ** t.decimals, token: t };
    }
  }
  return out;
}

/** Public wallet balances for the tokens Private Withdraw supports. */
export async function walletBalances(owner: string): Promise<Record<string, number>> {
  const l = await libs();
  const conn = connection(l);
  const pk = new l.web3.PublicKey(owner);
  const out: Record<string, number> = {};
  out.SOL = (await conn.getBalance(pk, 'confirmed')) / 1e9;
  const r = await conn.getParsedTokenAccountsByOwner(pk, { programId: new l.web3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }).catch(() => null);
  for (const t of PRIVATE_TOKENS) {
    if (t.native) continue;
    out[t.sym] = (r?.value || [])
      .filter((a) => a.account.data.parsed?.info?.mint === t.mint)
      .reduce((s, a) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmount || 0), 0);
  }
  return out;
}

/** Live fee settings from the relayer: 0.35% plus a small flat rent fee per send. */
export async function feeInfo(): Promise<{ rate: number; rent: Record<string, number>; min: Record<string, number> }> {
  const r = await fetch('/api/privacy/relayer/config', { cache: 'no-store' });
  if (!r.ok) throw new PrivateError('Privacy Cash is unreachable right now. Try again shortly.', 'config');
  const j = (await r.json()) as { withdraw_fee_rate: number; rent_fees: Record<string, number>; minimum_withdrawal: Record<string, number> };
  return { rate: j.withdraw_fee_rate, rent: j.rent_fees || {}, min: j.minimum_withdrawal || {} };
}

const tok = (sym: string) => {
  const t = PRIVATE_TOKENS.find((x) => x.sym === sym);
  if (!t) throw new PrivateError('That token can’t be used privately.', 'validate');
  return t;
};

/** Moves `amount` (UI units) from the Callit wallet into the private balance. The user signs one transaction. */
export async function shield(p: { owner: string; sym: string; amount: number }, step: (m: string) => void): Promise<string> {
  const t = tok(p.sym);
  const { l, enc } = await unlock(p.owner, step);
  const conn = connection(l);
  const publicKey = new l.web3.PublicKey(p.owner);
  const transactionSigner = async (tx: import('@solana/web3.js').VersionedTransaction) => {
    step('Shielding… approve in your wallet');
    const signed = await wallet().signTx(bytesToB64(tx.serialize()), p.owner, 'solana:mainnet');
    return l.web3.VersionedTransaction.deserialize(b64ToBytes(signed));
  };
  step('Preparing your private deposit (this takes a few seconds)…');
  const common = { lightWasm: l.lightWasm, connection: conn, keyBasePath: KEY_BASE, publicKey, transactionSigner, storage: localStorage, encryptionService: enc };
  const r = t.native
    ? await l.pc.deposit({ ...common, amount_in_lamports: Math.floor(p.amount * 1e9) })
    : await l.pc.depositSPL({ ...common, mintAddress: t.mint, base_units: Math.floor(p.amount * 10 ** t.decimals) });
  return r.tx;
}

/** Pays `amount` (UI units) from the private balance to `to`. No wallet signature: a proof + Privacy Cash's relayer. */
export async function sendPrivately(
  p: { owner: string; sym: string; amount: number; to: string },
  step: (m: string) => void,
): Promise<{ tx: string; fee: number; partial: boolean }> {
  const t = tok(p.sym);
  const { l, enc } = await unlock(p.owner, step);
  const conn = connection(l);
  const publicKey = new l.web3.PublicKey(p.owner);
  let recipient: import('@solana/web3.js').PublicKey;
  try { recipient = new l.web3.PublicKey(p.to); } catch { throw new PrivateError('That isn’t a valid Solana address.', 'validate'); }
  step('Proving and sending privately… keep this tab open (up to a minute)');
  const referralId = (process.env.NEXT_PUBLIC_PRIVACYCASH_REFERRAL_ID || '').trim() || undefined;
  const common = { lightWasm: l.lightWasm, connection: conn, keyBasePath: KEY_BASE, publicKey, recipient, storage: localStorage, encryptionService: enc, referralId };
  if (t.native) {
    const r = await l.pc.withdraw({ ...common, amount_in_lamports: Math.floor(p.amount * 1e9) });
    return { tx: r.tx, fee: r.fee_in_lamports / 1e9, partial: r.isPartial };
  }
  const r = await l.pc.withdrawSPL({ ...common, mintAddress: t.mint, base_units: Math.floor(p.amount * 10 ** t.decimals) });
  return { tx: r.tx, fee: r.fee_base_units / 10 ** t.decimals, partial: r.isPartial };
}

/** Shield, then send straight away (faster, but easier to match by timing). */
export async function shieldAndSend(
  p: { owner: string; sym: string; amount: number; to: string },
  step: (m: string) => void,
): Promise<{ shieldTx: string; sendTx: string }> {
  const shieldTx = await shield(p, step);
  try {
    step('Waiting for the pool to see your deposit…');
    await new Promise((r) => setTimeout(r, 8000));
    let bal = 0;
    for (let i = 0; i < 10; i++) {
      bal = (await privateBalances(p.owner))[p.sym]?.ui || 0;
      if (bal >= p.amount * 0.999) break;
      await new Promise((r) => setTimeout(r, 4000));
    }
    if (bal <= 0) throw new Error('not indexed yet');
    const { tx } = await sendPrivately({ ...p, amount: Math.min(p.amount, bal) }, step);
    return { shieldTx, sendTx: tx };
  } catch (e) {
    throw new PrivateError(SHIELDED_MSG, 'send', e);
  }
}

/** Forget the private balance key (sign-out or wallet switch). */
export function resetPrivate() {
  SESSION = null;
}
