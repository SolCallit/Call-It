import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  address,
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
import { getTransferSolInstruction } from '@solana-program/system';
import { rpc, RpcError, SOL_MINT } from '@/lib/solana/rpc';
import { jupMany } from '@/lib/market/sources';
import { PAYOUT, cashbackMinPoints } from '@/lib/fees/model';
import { pushTo } from '@/lib/push/send';

/** SOL kept in the payout wallet for network fees. */
const RESERVE_LAMPORTS = 2_000_000n;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The payout wallet's key, from PAYOUT_WALLET_SECRET (base58 like Phantom's "Export private key",
 * or the [12,34,...] array a Solana CLI keypair file holds). Use a fresh wallet that only holds payout SOL.
 */
let signerP: Promise<KeyPairSigner | null> | null = null;
export function payoutSigner(): Promise<KeyPairSigner | null> {
  if (signerP) return signerP;
  signerP = (async () => {
    const raw = (process.env.PAYOUT_WALLET_SECRET || '').trim().replace(/^["']|["']$/g, '');
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

/** What's stopping payouts right now, in plain words (null = ready). `paused` comes from the admin switch. */
export async function payoutIssue(paused: boolean): Promise<string | null> {
  if (process.env.PAYOUTS_ON !== '1') return 'Payouts are switched off (PAYOUTS_ON).';
  if (!(await payoutSigner())) return 'No payout wallet is set (PAYOUT_WALLET_SECRET).';
  if (paused) return 'Payouts are paused by an admin.';
  return null;
}

export async function isPaused(db: SupabaseClient): Promise<boolean> {
  const { data } = await db.from('app_kv').select('v').eq('k', 'payouts_paused').maybeSingle();
  return data?.v === '1';
}

export async function solPrice(): Promise<number | null> {
  const [t] = await jupMany([SOL_MINT]).catch(() => []);
  return t?.price && t.price > 1 ? t.price : null;
}

export async function walletLamports(addr: string): Promise<bigint> {
  const r = await rpc<{ value: number }>('getBalance', [addr, { commitment: 'confirmed' }]);
  return BigInt(r.value || 0);
}

/** USD paid out (or in flight) in the last 24h, across everyone or for one profile. */
export async function paidLast24h(db: SupabaseClient, profileId?: string): Promise<number> {
  const since = new Date(Date.now() - 864e5).toISOString();
  let q = db.from('claims').select('usd').in('status', ['sent', 'pending']).gte('created_at', since);
  if (profileId) q = q.eq('profile_id', profileId);
  const { data } = await q;
  return (data || []).reduce((a: number, r: { usd: number }) => a + Number(r.usd), 0);
}

type ClaimRow = { id: string; signature: string | null; created_at: string; status: string };

/**
 * Settles a claim that was left pending (timed out while confirming). Never pays twice:
 * the signature was saved before sending, so we only look it up.
 */
export async function resolvePending(db: SupabaseClient, c: ClaimRow): Promise<'sent' | 'failed' | 'pending'> {
  if (c.status !== 'pending') return c.status as 'sent' | 'failed';
  const age = Date.now() - Date.parse(c.created_at);
  if (!c.signature) {
    // Reserved but never signed: safe to hand back after a minute.
    if (age > 60_000) { await db.rpc('claim_release', { p_claim: c.id, p_error: 'never_sent' }); return 'failed'; }
    return 'pending';
  }
  try {
    const st = await rpc<{ value: ({ confirmationStatus?: string; err: unknown } | null)[] }>('getSignatureStatuses', [[c.signature], { searchTransactionHistory: true }]);
    const s = st.value?.[0];
    if (s?.err) { await db.rpc('claim_release', { p_claim: c.id, p_error: 'failed_on_chain' }); return 'failed'; }
    if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) {
      await db.from('claims').update({ status: 'sent', updated_at: new Date().toISOString() }).eq('id', c.id).eq('status', 'pending');
      return 'sent';
    }
    // Blockhashes expire after ~90s. Not found after 5 minutes = it never landed.
    if (!s && age > 5 * 60_000) { await db.rpc('claim_release', { p_claim: c.id, p_error: 'expired' }); return 'failed'; }
  } catch { /* try again later */ }
  return 'pending';
}

export type ClaimResult =
  | { ok: true; signature: string; usd: number; sol: number; status: 'sent' | 'pending' }
  | { ok: false; error: string; status?: number };

/** Pays a user's unclaimed earnings in SOL from the payout wallet. */
export async function claim(db: SupabaseClient, me: { id: string; wallet_address: string | null }, opts: { wait?: boolean } = {}): Promise<ClaimResult> {
  if (!me.wallet_address) return { ok: false, error: 'Your account has no wallet yet.' };
  const issue = await payoutIssue(await isPaused(db));
  if (issue) return { ok: false, error: 'Claims open soon. Your earnings are safe and keep adding up.', status: 503 };
  const signer = (await payoutSigner())!;

  const cap = PAYOUT.dailyCapUsd(), ucap = PAYOUT.userDailyCapUsd();
  const allRoom = Number.isFinite(cap) ? cap - (await paidLast24h(db)) : Infinity;
  if (allRoom < PAYOUT.minUsd()) return { ok: false, error: 'Today’s payouts are used up. Try again tomorrow.', status: 429 };
  const userRoom = Number.isFinite(ucap) ? ucap - (await paidLast24h(db, me.id)) : Infinity;
  if (userRoom < PAYOUT.minUsd()) return { ok: false, error: `You’ve hit today’s $${ucap} claim limit. The rest stays safe; claim again in 24h.`, status: 409 }; // 409: this user only, the daily run moves on to the next person
  const room = Math.min(allRoom, userRoom);
  const price = await solPrice();
  if (!price) return { ok: false, error: 'Couldn’t get the SOL price. Try again in a minute.', status: 503 };

  const { data: r, error } = await db.rpc('claim_start', {
    p_profile: me.id, p_wallet: me.wallet_address, p_min: PAYOUT.minUsd(), p_max: Math.min(PAYOUT.maxPerClaimUsd(), room, 1e9), // 1e9: SQL needs a number, Infinity means no cap
    p_cb_points: cashbackMinPoints(),
  });
  if (error) return { ok: false, error: 'Claims aren’t set up on the server yet (migration 0015).', status: 503 };
  const row = (r as { claim_id: string; usd: number }[] | null)?.[0];
  if (!row) return { ok: false, error: `You need at least $${PAYOUT.minUsd()} ready to claim (calls pay once they hit target), and only one claim at a time.` };
  const usd = Number(row.usd);
  const release = async (why: string) => { await db.rpc('claim_release', { p_claim: row.claim_id, p_error: why }); };

  // claim_start always takes the oldest earning even if it alone is over p_max: never let that break the daily limits.
  if (usd > room + 0.01) { await release('daily_cap'); return { ok: false, error: 'This claim would pass today’s limit. Try again in 24h.', status: 409 }; }
  if (Number.isFinite(PAYOUT.maxPerClaimUsd()) && usd > PAYOUT.maxPerClaimUsd() * 1.5) { await release('over_cap'); return { ok: false, error: 'This claim is larger than usual and needs a manual check. Contact Callit support.' }; }
  const lamports = BigInt(Math.floor((usd / price) * 1e9));
  if (lamports < 5000n) { await release('too_small'); return { ok: false, error: 'That’s too small to send on-chain yet.' }; }

  let attempted = false;
  try {
    const bal = await walletLamports(signer.address);
    if (bal < lamports + RESERVE_LAMPORTS) { await release('wallet_low'); return { ok: false, error: 'Payouts are being refilled. Try again later.', status: 503 }; }

    const { value: bh } = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    const msg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: bh.blockhash as Blockhash, lastValidBlockHeight: BigInt(bh.lastValidBlockHeight) }, m),
      (m) => appendTransactionMessageInstructions([getTransferSolInstruction({ source: signer, destination: address(me.wallet_address!), amount: lamports })], m),
    );
    const tx = await signTransactionMessageWithSigners(msg);
    const signature = getSignatureFromTransaction(tx);
    // Save the signature BEFORE sending, so a crash mid-send can never lead to a second payout.
    const { error: se } = await db.from('claims').update({ signature, lamports: lamports.toString(), sol_price: price, updated_at: new Date().toISOString() }).eq('id', row.claim_id);
    if (se) { await release('db_write'); return { ok: false, error: 'Couldn’t start the claim. Try again.' }; }

    attempted = true;
    try {
      await rpc<string>('sendTransaction', [getBase64EncodedWireTransaction(tx), { encoding: 'base64', maxRetries: 5, preflightCommitment: 'confirmed' }]);
    } catch (e) {
      // A preflight rejection means the transaction never reached the chain: hand the earnings back.
      // ("Already processed" means it DID land, so that one is never handed back.)
      if (e instanceof RpcError && !/^rpc_http_/.test(e.message) && !/already (been )?processed|AlreadyProcessed/i.test(e.message)) {
        await release(e.message); return { ok: false, error: 'The network rejected the payout. Try again.' };
      }
      // Network trouble: it may have landed. Leave it pending; resolvePending sorts it out.
    }
    // Daily auto-payout doesn't wait for each one: resolvePending settles them on the next run or when the user opens Earnings.
    for (let i = 0; i < (opts.wait === false ? 0 : 16); i++) {
      await sleep(1500);
      const st = await resolvePending(db, { id: row.claim_id, signature, created_at: new Date().toISOString(), status: 'pending' });
      if (st === 'sent') return { ok: true, signature, usd, sol: Number(lamports) / 1e9, status: 'sent' };
      if (st === 'failed') return { ok: false, error: 'The payout failed on-chain. Your earnings are back. Try again.' };
    }
    return { ok: true, signature, usd, sol: Number(lamports) / 1e9, status: 'pending' };
  } catch (e) {
    console.error('[payout]', e);
    // Once a send was attempted, never hand earnings back blindly: resolvePending checks the chain first.
    if (attempted) return { ok: false, error: 'Your payout is processing. Check back in a few minutes.' };
    await release('build_failed');
    return { ok: false, error: 'Couldn’t send the payout. Try again.' };
  }
}

/**
 * Pays everyone who has money ready (caller earnings on calls that hit target, unlocked cashback),
 * biggest first, inside the daily cap. Runs every minute from /api/cron/alerts when AUTO_PAYOUTS=1,
 * so a caller is paid about a minute after their call hits target. Never pays twice: same claim() path
 * as the Claim button, one claim in flight per person, and pending claims are checked on-chain first.
 */
export async function payReady(db: SupabaseClient, budgetMs = 20_000) {
  const t0 = Date.now();
  const { data: pend } = await db.from('claims').select('id, signature, created_at, status').eq('status', 'pending').limit(50);
  for (const c of pend || []) await resolvePending(db, c);
  const issue = await payoutIssue(await isPaused(db));
  if (issue) return { paid: 0, usd: 0, skipped: issue };
  const { data: queue, error } = await db.rpc('payout_queue', { p_min: PAYOUT.minUsd(), p_limit: 100, p_cb_points: cashbackMinPoints() });
  if (error) return { paid: 0, usd: 0, skipped: 'Run migration 0015 first', detail: error.message };
  const results: { profile: string; ok: boolean; usd?: number; sig?: string; error?: string }[] = [];
  for (const row of (queue || []) as { profile_id: string; wallet: string }[]) {
    if (Date.now() - t0 > budgetMs) break; // the rest go on the next run
    const r = await claim(db, { id: row.profile_id, wallet_address: row.wallet }, { wait: false });
    results.push(r.ok ? { profile: row.profile_id, ok: true, usd: r.usd, sig: r.signature } : { profile: row.profile_id, ok: false, error: r.error });
    if (r.ok) {
      await pushTo(db, [row.profile_id], {
        title: `💸 You just got paid ${'$' + r.usd.toFixed(2)}`,
        body: `${r.sol.toFixed(4)} SOL is on its way to your Callit wallet. Call it. Get paid.`,
        link: '#/you', tag: 'payout',
      }).catch(() => null);
    }
    if (!r.ok && (r.status === 429 || r.status === 503)) break; // daily cap used up, wallet low, or paused
  }
  const ok = results.filter((x) => x.ok);
  return { paid: ok.length, usd: +ok.reduce((a, x) => a + (x.usd || 0), 0).toFixed(2), results };
}
