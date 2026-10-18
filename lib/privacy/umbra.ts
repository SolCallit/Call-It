'use client';

/**
 * Private Withdraw, built on Umbra (Arcium's shielded pool on Solana).
 *
 * How a private withdrawal works:
 *  1. Shield: tokens move from the user's Callit wallet into Umbra's shared pool as a
 *     "note" that can only be released to the address the user typed. The user signs this.
 *     The destination is encrypted inside the note; nobody watching sees where it will go.
 *  2. Release: a zero-knowledge proof spends the note. The release is signed by a fresh
 *     throwaway key and broadcast by Umbra's relayer, so the Callit wallet never appears in
 *     the transaction that pays the destination.
 *
 * What stays visible on-chain: that the Callit wallet shielded an amount, and that the
 * destination received an amount. Waiting between shield and release, and using round
 * amounts, is what stops anyone matching the two.
 *
 * Callit never sees a key. Every Callit-wallet signature goes through window.CallitWallet
 * (Privy / Phantom / Solflare). The Umbra secret is derived from one message signature and
 * kept in memory only for this tab.
 *
 * The SDK is large, so everything here is loaded on demand when the Private tab opens.
 */

import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getAddressDecoder,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Instruction,
  type Transaction,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getSyncNativeInstruction,
} from '@solana-program/token';
import type { IUmbraClient, IUmbraSigner } from '@umbra-privacy/sdk';
import { privateConfig, type PrivateConfig, type PrivateToken, WSOL_MINT } from './config';

const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

/** Keep this much SOL in the wallet for network fees when shielding SOL. */
export const SOL_FEE_RESERVE = 0.01;

export class PrivateError extends Error {
  constructor(message: string, public stage: string, public raw?: unknown) {
    super(message);
    this.name = 'TxError'; // the engine shows TxError messages as-is
  }
}

function cfgOrThrow(): PrivateConfig {
  const c = privateConfig();
  if (!c) throw new PrivateError('Private withdraw is turned off.', 'config');
  return c;
}

const toB64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
};
const fromB64 = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));

function wallet() {
  const w = window.CallitWallet;
  if (!w) throw new PrivateError('Wallet not ready. Refresh and try again.', 'sign');
  return w;
}

/** Umbra signer backed by the user's own wallet through the Callit wallet bridge. */
function bridgeSigner(owner: string, chain: 'solana:mainnet' | 'solana:devnet'): IUmbraSigner {
  const enc = getTransactionEncoder();
  const dec = getTransactionDecoder();
  const signOne = async <T extends Transaction>(tx: T): Promise<T> => {
    const signedB64 = await wallet().signTx(toB64(new Uint8Array(enc.encode(tx))), owner, chain);
    const signed = dec.decode(fromB64(signedB64));
    return { ...tx, signatures: { ...tx.signatures, ...signed.signatures } };
  };
  const signer = {
    address: owner,
    signTransaction: (tx: Transaction) => signOne(tx),
    // One prompt per transaction; Privy's embedded wallet signs one at a time.
    signTransactions: async (txs: readonly Transaction[]) => {
      const out: Transaction[] = [];
      for (const t of txs) out.push(await signOne(t));
      return out;
    },
    signMessage: async (message: Uint8Array) => {
      const w = wallet();
      if (!w.signBytes) throw new PrivateError('This wallet can’t sign messages. Update the app and try again.', 'sign');
      const sig = fromB64(await w.signBytes(toB64(message), owner));
      return { message, signature: sig, signer: owner };
    },
  };
  // Structural match for IUmbraSigner (the SDK pins its own @solana/kit major, so brands differ).
  return signer as unknown as IUmbraSigner;
}

let CACHE: { owner: string; net: string; client: IUmbraClient; registered: boolean } | null = null;

async function client(owner: string): Promise<{ c: IUmbraClient; cfg: PrivateConfig }> {
  const cfg = cfgOrThrow();
  if (CACHE && CACHE.owner === owner && CACHE.net === cfg.network) return { c: CACHE.client, cfg };
  const { getUmbraClient } = await import('@umbra-privacy/sdk');
  const c = await getUmbraClient({
    signer: bridgeSigner(owner, cfg.network === 'devnet' ? 'solana:devnet' : 'solana:mainnet'),
    network: cfg.network,
    rpcUrl: cfg.rpc,
    rpcSubscriptionsUrl: cfg.ws,
    indexerApiEndpoint: cfg.indexer,
  });
  CACHE = { owner, net: cfg.network, client: c, registered: false };
  return { c, cfg };
}

/** One-time Umbra account setup. Idempotent: costs nothing once done. */
async function ensureRegistered(owner: string, step: (m: string) => void) {
  const { c } = await client(owner);
  if (CACHE?.registered) return;
  const [{ getUserRegistrationFunction }, { getUserRegistrationProver }] = await Promise.all([
    import('@umbra-privacy/sdk/registration'),
    import('@umbra-privacy/sdk/zk-prover'),
  ]);
  step('Setting up your private account (one time)…');
  const register = getUserRegistrationFunction({ client: c }, { zkProver: getUserRegistrationProver() });
  await register({ confidential: true, anonymous: true });
  if (CACHE) CACHE.registered = true;
}

/* ------------------------------ balances ------------------------------ */

const rpcOf = (cfg: PrivateConfig) => createSolanaRpc(cfg.rpc);

async function tokenBalance(cfg: PrivateConfig, owner: string, mint: string): Promise<bigint> {
  const [ata] = await findAssociatedTokenPda({ owner: address(owner), mint: address(mint), tokenProgram: TOKEN_PROGRAM });
  try {
    const r = await rpcOf(cfg).getTokenAccountBalance(ata, { commitment: 'confirmed' }).send();
    return BigInt(r.value.amount);
  } catch {
    return 0n; // no token account yet
  }
}

export type PrivateBalances = Record<string, { raw: bigint; ui: number; token: PrivateToken }>;

/** Balances on the Private Withdraw network (devnet while testing, so separate from the main wallet view). */
export async function privateBalances(owner: string): Promise<PrivateBalances> {
  const cfg = cfgOrThrow();
  const out: PrivateBalances = {};
  const lamports = (await rpcOf(cfg).getBalance(address(owner), { commitment: 'confirmed' }).send()).value;
  await Promise.all(
    cfg.tokens.map(async (t) => {
      // SOL counts native SOL plus any wrapped SOL already sitting in the wallet.
      const raw = t.native ? BigInt(lamports) + (await tokenBalance(cfg, owner, WSOL_MINT)) : await tokenBalance(cfg, owner, t.mint);
      out[t.sym] = { raw, ui: Number(raw) / 10 ** t.decimals, token: t };
    }),
  );
  return out;
}

/** Mints the relayer currently has pools for (so we never offer one that can't be released). */
export async function supportedSyms(): Promise<string[]> {
  const cfg = cfgOrThrow();
  try {
    const { getUmbraRelayer } = await import('@umbra-privacy/sdk/relayer');
    const r = await getUmbraRelayer({ apiEndpoint: cfg.relayer }).getSupportedMints();
    const live = new Set(r.mints);
    return cfg.tokens.filter((t) => live.has(t.mint)).map((t) => t.sym);
  } catch {
    return cfg.tokens.map((t) => t.sym); // relayer unreachable: show the documented list, release will say if it fails
  }
}

/* ------------------------------ helpers ------------------------------ */

async function sendAndConfirm(cfg: PrivateConfig, signedB64: string): Promise<string> {
  const rpc = rpcOf(cfg);
  const sig = await rpc.sendTransaction(signedB64 as never, { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
  for (let i = 0; i < 40; i++) {
    const st = (await rpc.getSignatureStatuses([sig]).send()).value[0];
    if (st?.err) throw new PrivateError('Wrapping SOL failed on-chain. Nothing was shielded.', 'wrap', st.err);
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return sig;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new PrivateError('Solana is slow right now. Check your balance before trying again.', 'wrap');
}

/** Umbra pools hold wrapped SOL. Tops the wallet's wSOL account up to `need` lamports. */
async function wrapSolIfNeeded(cfg: PrivateConfig, owner: string, need: bigint, step: (m: string) => void) {
  const have = await tokenBalance(cfg, owner, WSOL_MINT);
  if (have >= need) return;
  step('Wrapping SOL… approve in your wallet');
  const me = createNoopSigner(address(owner));
  const mint = address(WSOL_MINT);
  const [ata] = await findAssociatedTokenPda({ owner: me.address, mint, tokenProgram: TOKEN_PROGRAM });
  const ixs: Instruction[] = [
    getCreateAssociatedTokenIdempotentInstruction({ payer: me, ata, owner: me.address, mint, tokenProgram: TOKEN_PROGRAM }),
    getTransferSolInstruction({ source: me, destination: ata, amount: need - have }),
    getSyncNativeInstruction({ account: ata }),
  ];
  const { value: bh } = await rpcOf(cfg).getLatestBlockhash({ commitment: 'confirmed' }).send();
  const tx = compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(me, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
      (m) => appendTransactionMessageInstructions(ixs, m),
    ),
  );
  const signed = await wallet().signTx(getBase64EncodedWireTransaction(tx), owner, cfg.network === 'devnet' ? 'solana:devnet' : 'solana:mainnet');
  await sendAndConfirm(cfg, signed);
}

/** Rebuilds a 32-byte address from the two little-endian 128-bit halves Umbra stores. */
function joinAddress(low: bigint | number | string, high: bigint | number | string): string {
  const bytes = new Uint8Array(32);
  let l = BigInt(low);
  let h = BigInt(high);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number(l & 0xffn);
    l >>= 8n;
    bytes[16 + i] = Number(h & 0xffn);
    h >>= 8n;
  }
  return getAddressDecoder().decode(bytes);
}

/* ------------------------------ released notes (this device) ------------------------------ */

const RKEY = (owner: string, net: string) => `callit.private.released.${net}.${owner}`;
function releasedSet(owner: string, net: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(RKEY(owner, net)) || '[]'));
  } catch {
    return new Set();
  }
}
function markReleased(owner: string, net: string, ids: string[]) {
  try {
    const s = releasedSet(owner, net);
    ids.forEach((i) => s.add(i));
    localStorage.setItem(RKEY(owner, net), JSON.stringify([...s].slice(-500)));
  } catch {
    /* storage blocked: the relayer will still refuse a second release */
  }
}

/* ------------------------------ public API ------------------------------ */

export type PendingNote = {
  id: string;
  sym: string;
  amount: number;
  to: string;
  /** Raw SDK note, passed back to release(). */
  note: unknown;
};

/** Notes this wallet has shielded but not yet released. */
export async function pendingNotes(owner: string): Promise<PendingNote[]> {
  const { c, cfg } = await client(owner);
  await ensureRegistered(owner, () => {});
  const { getBurnableStealthPoolNoteScannerFunction } = await import('@umbra-privacy/sdk/burn');
  const r = await getBurnableStealthPoolNoteScannerFunction({ client: c })();
  const done = releasedSet(owner, cfg.network);
  const out: PendingNote[] = [];
  for (const n of r.ataToStealthPoolSelfBurnable) {
    const id = `${n.treeIndex}:${n.insertionIndex}`;
    if (done.has(id)) continue;
    const mint = joinAddress(n.h1Components.mintAddressLow, n.h1Components.mintAddressHigh);
    const t = cfg.tokens.find((x) => x.mint === mint);
    out.push({
      id,
      sym: t?.sym || mint.slice(0, 4) + '…',
      amount: Number(n.amount) / 10 ** (t?.decimals ?? 9),
      to: n.destinationAddress,
      note: n,
    });
  }
  return out;
}

/** Releases notes to their destinations via the relayer. Returns the release signatures. */
export async function releaseNotes(owner: string, notes: PendingNote[], step: (m: string) => void): Promise<string[]> {
  if (!notes.length) return [];
  const { c, cfg } = await client(owner);
  const [{ getSelfBurnableStealthPoolNoteIntoATABurnerFunction }, { getClaimSelfClaimableUtxoIntoPublicBalanceProver }, { getUmbraRelayer }] =
    await Promise.all([import('@umbra-privacy/sdk/burn'), import('@umbra-privacy/sdk/zk-prover'), import('@umbra-privacy/sdk/relayer')]);
  if (!c.fetchBatchMerkleProof) throw new PrivateError('Private pool is unreachable right now. Try again shortly.', 'release');
  const relayer = getUmbraRelayer({ apiEndpoint: cfg.relayer });
  const burn = getSelfBurnableStealthPoolNoteIntoATABurnerFunction(
    { client: c },
    {
      fetchBatchMerkleProof: c.fetchBatchMerkleProof,
      zkProver: getClaimSelfClaimableUtxoIntoPublicBalanceProver(),
      relayer: {
        submitBurn: relayer.submitClaim,
        pollBurnStatus: relayer.pollClaimStatus,
        getRelayerAddress: relayer.getRelayerAddress,
      },
    },
  );
  step('Proving and releasing privately… this can take a minute');
  type BurnInput = Parameters<typeof burn>[0][number];
  const res = await burn(notes.map((n) => ({ ...(n.note as object), kind: 'self-burnable' }) as BurnInput));
  const sigs: string[] = [];
  const failed: string[] = [];
  for (const b of res.batches.values()) {
    if (b.status === 'completed' && b.txSignature) sigs.push(b.txSignature);
    else failed.push(b.failureReason || String(b.status));
  }
  if (sigs.length) markReleased(owner, cfg.network, notes.map((n) => n.id));
  if (!sigs.length) {
    const why = failed.join('; ');
    if (/nullifier|already/i.test(why)) {
      markReleased(owner, cfg.network, notes.map((n) => n.id));
      throw new PrivateError('That was already released.', 'release', failed);
    }
    throw new PrivateError('The private release didn’t go through. Your funds are still safe in the pool; try Release again.', 'release', failed);
  }
  return sigs;
}

/**
 * Shields `amount` (base units) of `sym` so it can only be released to `to`.
 * If releaseNow, releases it straight away (faster, but easier to link by timing).
 */
export async function privateWithdraw(
  p: { owner: string; to: string; sym: string; amount: bigint; releaseNow: boolean },
  step: (m: string) => void,
): Promise<{ shieldSig: string; releaseSigs: string[] }> {
  const { c, cfg } = await client(p.owner);
  const t = cfg.tokens.find((x) => x.sym === p.sym);
  if (!t) throw new PrivateError('That token can’t be withdrawn privately.', 'validate');
  step('Approve the one-time private key signature…');
  await ensureRegistered(p.owner, step);
  if (t.native) await wrapSolIfNeeded(cfg, p.owner, p.amount, step);

  const [{ getATAIntoSelfBurnableStealthPoolNoteCreatorFunction }, { getATAIntoStealthPoolNoteCreatorProver }] = await Promise.all([
    import('@umbra-privacy/sdk/deposit'),
    import('@umbra-privacy/sdk/zk-prover'),
  ]);
  step('Shielding… approve in your wallet');
  const create = getATAIntoSelfBurnableStealthPoolNoteCreatorFunction({ client: c }, { zkProver: getATAIntoStealthPoolNoteCreatorProver() });
  type CreateArgs = Parameters<typeof create>[0];
  const res = await create({ amount: p.amount, destinationAddress: p.to, mint: t.mint } as unknown as CreateArgs);
  const shieldSig = String(res.createUtxoSignature);
  if (!p.releaseNow) return { shieldSig, releaseSigs: [] };

  step('Waiting for the pool to index your note…');
  let mine: PendingNote[] = [];
  for (let i = 0; i < 20 && !mine.length; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    mine = (await pendingNotes(p.owner)).filter((n) => n.to === p.to && n.sym === p.sym);
  }
  if (!mine.length) {
    throw new PrivateError('Shielded. The pool is slow to index it, so release it from “Pending” in a minute.', 'index');
  }
  const releaseSigs = await releaseNotes(p.owner, [mine[mine.length - 1]], step);
  return { shieldSig, releaseSigs };
}

/** Forget the in-memory Umbra session (on sign-out or wallet switch). */
export function resetPrivate() {
  CACHE = null;
}
