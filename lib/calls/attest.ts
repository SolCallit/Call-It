import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Blockhash,
  type KeyPairSigner,
} from '@solana/kit';
import { getAddMemoInstruction } from '@solana-program/memo';
import { rpc } from '@/lib/solana/rpc';

/**
 * On-chain call receipts (migration 0024).
 *
 * A call's whole point is that its entry can't be edited after the fact. Keeping that promise in
 * Callit's own database asks people to trust Callit. Instead, every call is written to Solana as a
 * memo the moment it is made: the facts in the clear, plus a SHA-256 of them. Anyone can pull the
 * transaction, recompute the hash and see that the entry market cap is the one that was stamped.
 *
 * ATTEST_WALLET_SECRET is a wallet that does nothing else. Fund it with a little SOL (a memo costs
 * about 0.000005 SOL, so 0.05 SOL covers ~10,000 calls). Receipts are off while it is unset, and a
 * failure never blocks a call from being posted.
 */

export const attestOn = () => !!(process.env.ATTEST_WALLET_SECRET || '').trim();

let signerP: Promise<KeyPairSigner | null> | null = null;
function attestSigner(): Promise<KeyPairSigner | null> {
  if (signerP) return signerP;
  signerP = (async () => {
    const raw = (process.env.ATTEST_WALLET_SECRET || '').trim().replace(/^["']|["']$/g, '');
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

export type CallFacts = {
  id: string;
  mint: string;
  token_sym: string | null;
  entry_mc: number | string;
  created_at: string;
  handle: string;
};

/**
 * The exact bytes that get hashed. Order and formatting are part of the promise: change them and
 * every receipt written before the change stops verifying, so this function is append-only.
 */
export function canonical(c: CallFacts): string {
  const mc = Number(c.entry_mc);
  return ['callit.v1', c.id, c.mint, mc.toFixed(2), new Date(c.created_at).toISOString(), '@' + c.handle].join('|');
}

export const hashOf = (c: CallFacts) => createHash('sha256').update(canonical(c)).digest('hex');

/** What goes on-chain: readable on Solscan, and self-checking. */
export function memoText(c: CallFacts, hash: string): string {
  const mc = Math.round(Number(c.entry_mc));
  return `callit.buzz call | $${c.token_sym || '?'} | entry MC ${mc} USD | ${new Date(c.created_at).toISOString()} | @${c.handle} | mint ${c.mint} | sha256 ${hash}`;
}

/**
 * Writes the receipt and saves the signature on the call. Never throws: a call that fails to get a
 * receipt is still a call, it just shows as unverified until the next attempt.
 */
export async function attestCall(db: SupabaseClient, c: CallFacts): Promise<string | null> {
  const signer = await attestSigner();
  if (!signer) return null;
  try {
    const hash = hashOf(c);
    const { value: bh } = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    const msg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: bh.blockhash as Blockhash, lastValidBlockHeight: BigInt(bh.lastValidBlockHeight) }, m),
      (m) => appendTransactionMessageInstructions([getAddMemoInstruction({ memo: memoText(c, hash) })], m),
    );
    const tx = await signTransactionMessageWithSigners(msg);
    const signature = getSignatureFromTransaction(tx);
    await rpc<string>('sendTransaction', [getBase64EncodedWireTransaction(tx), { encoding: 'base64', maxRetries: 3, preflightCommitment: 'confirmed' }]);
    const { error } = await db.from('posts').update({ attest_sig: signature, attest_hash: hash, attest_at: new Date().toISOString() }).eq('id', c.id);
    if (error) console.warn('[attest] saved on chain but not in the database:', error.message);
    return signature;
  } catch (e) {
    console.warn('[attest]', e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** Pulls the memo back off the chain. Null means the transaction isn't visible (yet). */
export async function memoOnChain(signature: string): Promise<{ memo: string | null; slot: number | null; blockTime: number | null } | null> {
  type Tx = { slot: number; blockTime: number | null; meta: { logMessages?: string[] } | null };
  const tx = await rpc<Tx | null>('getTransaction', [signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]).catch(() => null);
  if (!tx) return null;
  // The memo program echoes the note into the logs as: Program log: Memo (len N): "..."
  const line = (tx.meta?.logMessages || []).find((l) => /Memo \(len \d+\)/.test(l));
  const m = line ? line.match(/"([\s\S]*)"\s*$/) : null;
  return { memo: m ? m[1] : null, slot: tx.slot, blockTime: tx.blockTime };
}
