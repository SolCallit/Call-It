import 'server-only';

/**
 * Gas sponsor for Helius Privacy Rings withdrawals.
 *
 * A private send must not be paid for by the user's wallet — the fee payer is public, so that
 * would link them to the withdrawal and undo the privacy. Instead the browser builds and proves
 * the withdrawal with Callit's gas wallet as fee payer (the user authorizes inside the proof,
 * off-chain), and this module signs as fee payer and broadcasts.
 *
 * The gas wallet can't be drained into someone's pocket, because a transaction is signed only when
 *  - its fee payer is the gas wallet, and
 *  - every instruction is ComputeBudget, or the shielded-pool program's `transact` (tag 16).
 * `transact` spends only shielded notes the prover proved the sender owns; `deposit` (tag 15),
 * System transfers and every other program are refused, so the gas wallet only ever pays fees.
 * Keep it a fresh wallet holding a little SOL (0.05 or so) all the same.
 *
 * HELIUS_GAS_WALLET_SECRET: base58 like Phantom's export, or a [12,34,...] CLI keypair array.
 * Unset = private sends on the Helius rail are disabled (the client shows them as paused).
 */

import { NextResponse } from 'next/server';
import {
  createKeyPairSignerFromBytes,
  getBase58Encoder,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  partiallySignTransaction,
  type KeyPairSigner,
  type Transaction,
} from '@solana/kit';
import { rpcUrl } from '@/lib/solana/rpc';

const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const TRANSACT_TAG = 16; // InstructionTag.transact in @heliuslabs/spr

let signerP: Promise<KeyPairSigner | null> | null = null;
function gasSigner(): Promise<KeyPairSigner | null> {
  if (signerP) return signerP;
  signerP = (async () => {
    const raw = (process.env.HELIUS_GAS_WALLET_SECRET || '').trim().replace(/^["']|["']$/g, '');
    if (!raw) return null;
    try {
      const bytes = raw.startsWith('[') ? new Uint8Array(JSON.parse(raw) as number[]) : new Uint8Array(getBase58Encoder().encode(raw));
      if (bytes.length !== 64) return null;
      return await createKeyPairSignerFromBytes(bytes);
    } catch {
      return null;
    }
  })();
  return signerP;
}

/** The gas wallet's public address (the fee payer the client builds against), or null when unset. */
export async function gasAddress(): Promise<string | null> {
  const s = await gasSigner();
  return s ? String(s.address) : null;
}

const err = (message: string, status: number) => NextResponse.json({ error: message }, { status });

async function shieldedPoolProgramId(): Promise<string> {
  const { SHIELDED_POOL_PROGRAM_ID } = await import('@heliuslabs/spr/interface');
  return String(SHIELDED_POOL_PROGRAM_ID);
}

/** Validates, signs as fee payer, and broadcasts a proved shielded-pool withdrawal. */
export async function relayWithdrawal(txB64: string): Promise<NextResponse> {
  const signer = await gasSigner();
  if (!signer) return err('Private sending is paused right now.', 503);

  let tx: Transaction;
  let message: ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>['decode']>;
  try {
    tx = getTransactionDecoder().decode(new Uint8Array(getBase64Encoder().encode(txB64)));
    message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  } catch {
    return err('invalid_tx', 400);
  }

  const accounts = message.staticAccounts.map(String);
  if (accounts[0] !== String(signer.address)) return err('wrong_fee_payer', 400);
  // Newer message formats without a plain instruction list can't be checked, so they aren't signed.
  const instructions = 'instructions' in message ? message.instructions : null;
  if (!instructions || instructions.length === 0) return err('invalid_tx', 400);

  const pool = await shieldedPoolProgramId();
  for (const ix of instructions) {
    const program = accounts[ix.programAddressIndex];
    if (program === COMPUTE_BUDGET) continue;
    const tag = ix.data && ix.data.length > 0 ? ix.data[0] : -1;
    if (program === pool && tag === TRANSACT_TAG) continue;
    return err('not_allowed', 400);
  }

  try {
    const signed = await partiallySignTransaction([signer.keyPair], tx);
    const wire = getBase64EncodedWireTransaction(signed);
    const r = await fetch(rpcUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'sendTransaction',
        params: [wire, { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 3 }],
      }),
    });
    const j = (await r.json().catch(() => null)) as { result?: string; error?: { message?: string } } | null;
    if (!j?.result) return err(j?.error?.message || 'Solana rejected the transaction. Your private balance is unchanged.', 502);
    return NextResponse.json({ tx: j.result }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return err('Solana RPC is unreachable right now.', 502);
  }
}
