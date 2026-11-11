'use client';

/**
 * Private Withdraw rail #2, built on Helius Privacy Rings (Solana Privacy Rings, mainnet).
 * Sits beside the Privacy Cash rail in lib/privacy/privacycash.ts — same two steps, same UX:
 *
 *  1. Add funds: the Callit wallet deposits SOL into the shielded pool. Public by design,
 *     like any shield. First-time wallets also sign a one-time registration transaction.
 *  2. Send privately: a zero-knowledge proof spends the shielded notes. The user's wallet
 *     signs the proof's owner authorization OFF-chain (a free message signature) and
 *     Callit's gas wallet pays the network fee, so the user's wallet appears nowhere in
 *     the withdrawal transaction. Without the gas wallet (HELIUS_GAS_WALLET_SECRET unset)
 *     private sends are disabled rather than silently de-anonymized.
 *
 * Keys: the private balance derives from the wallet signing the SDK's standard derivation
 * message ("TSPP/derive/v1" off-chain message), so the same balance is recoverable with the
 * same wallet in any other Privacy Rings app. Kept in memory for this tab only.
 *
 * Proving runs on Helius' attested TEE prover (requests are encrypted to the enclave and the
 * SDK verifies the attestation against its pinned mainnet policy), so there is no multi-MB
 * WASM download and no cross-origin isolation requirement. The SDK loads only when used.
 *
 * SOL only for now. SPL needs per-mint interface setup — add once the rail has mileage.
 */

import { HELIUS_INDEXER, HELIUS_MIN_SOL, HELIUS_TEE_PROVER, PRIVATE_WS } from './config';

export class PrivateError extends Error {
  constructor(message: string, public stage: string, public raw?: unknown) {
    super(message);
    this.name = 'TxError'; // the engine shows TxError messages as-is
  }
}

/** Keep this much SOL in the wallet for fees when shielding SOL. */
export const SOL_FEE_RESERVE = 0.01;
export const MIN_SOL = HELIUS_MIN_SOL;

const b64ToBytes = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
const bytesToB64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
};

function callitWallet() {
  const w = window.CallitWallet;
  if (!w || !w.signBytes) throw new PrivateError('Wallet not ready. Refresh and try again.', 'sign');
  return w;
}

type Spr = typeof import('@heliuslabs/spr');
type SprClientMod = typeof import('@heliuslabs/spr/client');
type SprKeypair = typeof import('@heliuslabs/spr/keypair');
type SprWallet = typeof import('@heliuslabs/spr/wallet');
type Kit = typeof import('@solana/kit');
type Libs = { spr: Spr; cl: SprClientMod; kp: SprKeypair; wl: SprWallet; kit: Kit };

let LIBS: Promise<Libs> | null = null;
function libs(): Promise<Libs> {
  if (!LIBS) {
    LIBS = (async () => {
      const [spr, cl, kp, wl, kit] = await Promise.all([
        import('@heliuslabs/spr'),
        import('@heliuslabs/spr/client'),
        import('@heliuslabs/spr/keypair'),
        import('@heliuslabs/spr/wallet'),
        import('@solana/kit'),
      ]);
      return { spr, cl, kp, wl, kit };
    })();
    LIBS.catch(() => { LIBS = null; });
  }
  return LIBS;
}

type Client = Awaited<ReturnType<Spr['createSprClient']>>;
type Keys = ReturnType<Spr['LocalKeys']['fromDerivationSeed']>;
type SprWalletState = InstanceType<Spr['Wallet']>;

let SESSION: { owner: string; client: Client; keys: Keys; wallet: SprWalletState } | null = null;

/** True once the user has unlocked their Helius private balance in this tab. */
export const isUnlocked = (owner: string) => !!SESSION && SESSION.owner === owner;

async function client(l: Libs): Promise<Client> {
  return l.spr.createSprClient({
    // Solana RPC goes through Callit's server key; the indexer and prover are Helius'
    // public mainnet deployment and the prover only ever sees enclave-encrypted requests.
    solanaRpcUrl: `${window.location.origin}/api/privacy/rpc`,
    solanaRpcSubscriptionsUrl: PRIVATE_WS,
    indexerUrl: HELIUS_INDEXER,
    proverUrl: HELIUS_TEE_PROVER,
    proverTee: l.cl.SignedTeePolicy.forNetwork('mainnet'),
  });
}

const ownerBytes = (l: Libs, owner: string) => new Uint8Array(l.kit.getAddressEncoder().encode(l.kit.address(owner)));

/** One free signature over the SDK's derivation message unlocks the private balance keys. */
async function unlock(owner: string, step: (m: string) => void): Promise<{ l: Libs; s: NonNullable<typeof SESSION> }> {
  const l = await libs();
  if (SESSION?.owner === owner) return { l, s: SESSION };
  step('Approve the private balance signature (free)…');
  const msg = l.kp.ed25519DerivationMessage(ownerBytes(l, owner) as Parameters<SprKeypair['ed25519DerivationMessage']>[0]);
  const sigB64 = await Promise.race([
    callitWallet().signBytes!(bytesToB64(msg), owner),
    new Promise<never>((_, rej) => setTimeout(() => rej(new PrivateError('Your wallet didn’t answer. Open it, then try again.', 'sign')), 120_000)),
  ]);
  const seed = b64ToBytes(sigB64);
  step('Connecting to Helius Privacy…');
  const c = await client(l);
  const keys = l.spr.LocalKeys.fromDerivationSeed({ solanaPublicKey: l.kit.address(owner), derivationSeed: seed }, c.proofService);
  seed.fill(0);
  SESSION = { owner, client: c, keys, wallet: new l.spr.Wallet({ identity: keys.address() }) };
  return { l, s: SESSION };
}

/** The shielded owner signs the transact digest with the wallet's own key — off-chain, free. */
function ownerSigner(l: Libs, owner: string, step: (m: string) => void) {
  return {
    signingPublicKey: () => l.kp.ShieldedPublicKey.fromEd25519(ownerBytes(l, owner) as never),
    sign: async (message: Uint8Array) => {
      step('Approve the private send signature (free)…');
      const sig = b64ToBytes(await callitWallet().signBytes!(bytesToB64(message), owner));
      if (sig.length !== 64) throw new PrivateError('The wallet returned an unexpected signature.', 'sign');
      return sig as never;
    },
  };
}

/** User signs a built transaction with their wallet, then it's sent through the RPC proxy. */
async function signAndSend(l: Libs, c: Client, owner: string, tx: unknown, step: (m: string) => void, label: string): Promise<string> {
  step(`${label}… approve in your wallet`);
  const unsigned = l.kit.getBase64EncodedWireTransaction(tx as Parameters<Kit['getBase64EncodedWireTransaction']>[0]);
  const signed = await callitWallet().signTx(unsigned, owner, 'solana:mainnet');
  const sig = await c.solanaRpc
    .sendTransaction(signed as Parameters<Client['solanaRpc']['sendTransaction']>[0], { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 3n })
    .send();
  await confirm(c, String(sig), step);
  return String(sig);
}

async function confirm(c: Client, sig: string, step: (m: string) => void): Promise<void> {
  step('Waiting for Solana to confirm…');
  for (let i = 0; i < 45; i++) {
    const st = (await c.solanaRpc.getSignatureStatuses([sig as never]).send()).value[0];
    if (st?.err) throw new PrivateError('The transaction failed on Solana. Nothing moved.', 'confirm', st.err);
    if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new PrivateError('Solana is slow right now. Check your balance before trying again.', 'confirm');
}

export type HeliusBalance = { ui: number; notes: number; registered: boolean };

/** Private (shielded) SOL balance. Asks for the unlock signature the first time. */
export async function privateBalance(owner: string, step: (m: string) => void = () => {}): Promise<HeliusBalance> {
  const { l, s } = await unlock(owner, step);
  step('Checking your private balance…');
  const rec = await l.wl.fetchUserRecord({ rpc: s.client, owner: l.kit.address(owner) });
  if (rec !== undefined) {
    await l.spr.syncWallet({ client: s.client, wallet: s.wallet, keys: s.keys, config: {} });
  }
  const b = s.wallet.balance(l.spr.SOL_MINT);
  return { ui: Number(b.amount) / 1e9, notes: b.utxos.length, registered: rec !== undefined };
}

/** Public SOL balance of the Callit wallet (for the Add funds form). */
export async function walletSol(owner: string): Promise<number> {
  const l = await libs();
  const c = SESSION?.owner === owner ? SESSION.client : await client(l);
  const r = await c.solanaRpc.getBalance(l.kit.address(owner), { commitment: 'confirmed' }).send();
  return Number(r.value) / 1e9;
}

/** The gas wallet that pays withdrawal fees, or null when private sends are paused. */
export async function gasInfo(): Promise<{ address: string } | null> {
  const r = await fetch('/api/privacy/hgas', { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = (await r.json().catch(() => null)) as { address?: string } | null;
  return j?.address ? { address: j.address } : null;
}

/** Callit's protocol fee on the Helius rail (USD, taken in SOL with the deposit). Null when it's switched off. */
export type HeliusFee = { usd: number; sol: number; lamports: number; treasury: string } | null;
export async function protocolFee(): Promise<HeliusFee> {
  const r = await fetch('/api/privacy/hfee', { cache: 'no-store' }).catch(() => null);
  const j = r && r.ok ? ((await r.json().catch(() => null)) as { treasury?: string | null; usd?: number; lamports?: number } | null) : null;
  if (!j?.treasury || !(Number(j.lamports) > 0)) return null;
  return { usd: Number(j.usd) || 0, sol: Number(j.lamports) / 1e9, lamports: Number(j.lamports), treasury: j.treasury };
}

/** Moves `amount` SOL from the Callit wallet into the private balance. Registers first-time wallets. */
export async function shield(p: { owner: string; amount: number }, step: (m: string) => void): Promise<string> {
  const { l, s } = await unlock(p.owner, step);
  const owner = l.kit.address(p.owner);
  const rec = await l.wl.fetchUserRecord({ rpc: s.client, owner });
  if (rec === undefined) {
    step('First time here: registering your private wallet…');
    const reg = await l.spr.buildRegistrationTransaction({ client: s.client, owner, address: s.keys.address(), payer: owner });
    if (reg) await signAndSend(l, s.client, p.owner, reg, step, 'One-time registration');
  }
  step('Preparing your private deposit…');
  // The protocol fee (when on) rides in the same transaction as the deposit: one approval, and if the
  // deposit fails the fee isn't taken either.
  const fee = await protocolFee();
  let setupInstructions: unknown[] | undefined;
  if (fee) {
    const { getTransferSolInstruction } = await import('@solana-program/system');
    setupInstructions = [getTransferSolInstruction({ source: l.kit.createNoopSigner(owner), destination: l.kit.address(fee.treasury), amount: BigInt(fee.lamports) })];
  }
  const tx = await l.spr.buildDepositTransaction({
    client: s.client,
    feePayer: owner,
    recipient: s.keys.address(),
    amount: BigInt(Math.floor(p.amount * 1e9)),
    ...(setupInstructions ? { setupInstructions: setupInstructions as never } : {}),
  });
  return signAndSend(l, s.client, p.owner, tx, step, 'Adding to your private balance');
}

/**
 * Pays `amount` SOL from the private balance to `to`. The user's wallet signs nothing on-chain:
 * the proof carries the owner's off-chain signature and Callit's gas wallet pays the network fee.
 */
export async function sendPrivately(
  p: { owner: string; amount: number; to: string },
  step: (m: string) => void,
): Promise<{ tx: string }> {
  const { l, s } = await unlock(p.owner, step);
  let recipient: ReturnType<Kit['address']>;
  try { recipient = l.kit.address(p.to); } catch { throw new PrivateError('That isn’t a valid Solana address.', 'validate'); }
  const gas = await gasInfo();
  if (!gas) throw new PrivateError('Private sending is paused right now. Your funds are safe in your private balance — try again later.', 'gas');
  step('Syncing your private balance…');
  await l.spr.syncWallet({ client: s.client, wallet: s.wallet, keys: s.keys, config: {} });
  step('Proving privately… keep this tab open (up to a minute)');
  let tx: unknown;
  try {
    tx = await l.spr.buildWithdrawalTransaction({
      client: s.client,
      wallet: s.wallet,
      keys: s.keys,
      feePayer: l.kit.address(gas.address),
      owner: ownerSigner(l, p.owner, step),
      recipient,
      amount: BigInt(Math.floor(p.amount * 1e9)),
    });
  } catch (e) {
    const msg = String((e as Error)?.message || '');
    if (/TOO_MANY_INPUTS/i.test(msg)) {
      throw new PrivateError('Your private balance is split across too many small deposits. Send a smaller amount for now.', 'prove', e);
    }
    throw e;
  }
  step('Sending privately…');
  const b64 = l.kit.getBase64EncodedWireTransaction(tx as Parameters<Kit['getBase64EncodedWireTransaction']>[0]);
  // Signed-in users only (stops gas-wallet drain by bots); the server verifies and forgets — nothing is logged.
  const token = await callitWallet().token().catch(() => null);
  const r = await fetch('/api/privacy/hgas', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ tx: b64 }),
  });
  const j = (await r.json().catch(() => ({}))) as { tx?: string; error?: string };
  if (!r.ok || !j.tx) throw new PrivateError(j.error || 'The private send didn’t go through. Your private balance is unchanged.', 'relay');
  await confirm(s.client, j.tx, step);
  s.wallet = new l.spr.Wallet({ identity: s.keys.address() }); // next balance read re-syncs clean
  return { tx: j.tx };
}

/** Shield, then send straight away (faster, but easier to match by timing). */
export async function shieldAndSend(
  p: { owner: string; amount: number; to: string },
  step: (m: string) => void,
): Promise<{ shieldTx: string; sendTx: string }> {
  const shieldTx = await shield(p, step);
  try {
    step('Waiting for the pool to see your deposit…');
    let bal = 0;
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      bal = (await privateBalance(p.owner, () => {})).ui;
      if (bal >= p.amount * 0.999) break;
    }
    if (bal <= 0) throw new Error('not indexed yet');
    const { tx } = await sendPrivately({ ...p, amount: Math.min(p.amount, bal) }, step);
    return { shieldTx, sendTx: tx };
  } catch (e) {
    throw new PrivateError('Added and safe in your private balance. Send it from Withdraw → Private → 2. Send privately.', 'send', e);
  }
}

/** Forget the private balance key (sign-out or wallet switch). */
export function resetPrivate() {
  SESSION = null;
}
