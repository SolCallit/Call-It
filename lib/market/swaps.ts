import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rpcUrl, SOL_MINT } from '@/lib/solana/rpc';
import { jupMany } from '@/lib/market/sources';

/* ---------- Callit's own swap indexer ----------
   Candles and trades straight from the chain, through our Helius RPC. No third party picks the pool or
   lags behind: when someone has a token open, we pull the pool's new signatures, decode each swap from the
   balance changes, store it in `pool_swaps`, and build candles and the trades list from that.

   Incremental and cheap: 1 getSignaturesForAddress per sync (at most every few seconds per pool, shared by
   every viewer) plus 1 getTransaction per NEW swap. We keep 3 days per pool; GeckoTerminal fills older history.
   Everything degrades to the old GeckoTerminal path if Helius or the table isn't there. */

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const KEEP_MS = 3 * 864e5;
const BACKFILL = 300;
const SYNC_GAP_MS = 3000;

export type Swap = { sig: string; t: number; side: 'buy' | 'sell'; px: number; usd: number; amt: number; who: string };

/* Off when the migration hasn't run (or DB/Helius missing): retried after a minute. */
let offUntil = 0;
const lastSync = new Map<string, number>();
const inflight = new Map<string, Promise<void>>();

let solCache = { v: 0, at: 0 };
async function solUsd(): Promise<number> {
  if (Date.now() - solCache.at < 30_000 && solCache.v > 0) return solCache.v;
  const [t] = await jupMany([SOL_MINT]).catch(() => []);
  if (t?.price && t.price > 1) solCache = { v: t.price, at: Date.now() };
  return solCache.v;
}

/** Batched JSON-RPC against our own RPC (Helius). */
async function rpcBatch<T>(calls: { method: string; params: unknown[] }[]): Promise<(T | null)[]> {
  if (!calls.length) return [];
  const r = await fetch(rpcUrl(), {
    method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: c.method, params: c.params }))),
  });
  if (!r.ok) throw new Error(`rpc_http_${r.status}`);
  const j = (await r.json()) as { id: number; result?: T }[] | { error?: unknown };
  if (!Array.isArray(j)) throw new Error('rpc_batch_unsupported');
  const out: (T | null)[] = calls.map(() => null);
  for (const x of j) if (typeof x.id === 'number') out[x.id] = x.result ?? null;
  return out;
}

type TokBal = { accountIndex: number; mint: string; owner?: string; uiTokenAmount?: { uiAmount: number | null; uiAmountString?: string } };
type ParsedTx = {
  blockTime: number | null;
  meta: { err: unknown; fee: number; preBalances: number[]; postBalances: number[]; preTokenBalances?: TokBal[]; postTokenBalances?: TokBal[] } | null;
  transaction: { signatures: string[]; message: { accountKeys: ({ pubkey: string; signer?: boolean } | string)[] } };
};

const ui = (b?: TokBal) => (b?.uiTokenAmount ? Number(b.uiTokenAmount.uiAmountString ?? b.uiTokenAmount.uiAmount ?? 0) || 0 : 0);

/** Decode one transaction into a swap of `mint` on the pool, from balance changes only (works on every DEX). */
export function decodeSwap(tx: ParsedTx, mint: string, sol: number): Swap | null {
  const m = tx.meta;
  if (!m || m.err || !tx.blockTime) return null;
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === 'string' ? { pubkey: k, signer: false } : k));
  const payer = keys[0]?.pubkey;
  if (!payer) return null;

  // Net change per (owner, mint).
  const d = new Map<string, number>();
  const add = (b: TokBal, s: number) => { if (!b.owner) return; const k = b.owner + '|' + b.mint; d.set(k, (d.get(k) || 0) + s * ui(b)); };
  (m.postTokenBalances || []).forEach((b) => add(b, 1));
  (m.preTokenBalances || []).forEach((b) => add(b, -1));
  const of = (owner: string, mt: string) => d.get(owner + '|' + mt) || 0;

  // The trader: the fee payer, or another signer whose balance of the token moved.
  const signers = keys.filter((k) => k.signer).map((k) => k.pubkey);
  const who = [payer, ...signers].find((o) => Math.abs(of(o, mint)) > 0);
  if (!who) return null;
  const tok = of(who, mint);
  const side: 'buy' | 'sell' = tok > 0 ? 'buy' : 'sell';
  const amt = Math.abs(tok);

  // Quote leg, measured on the pool's side so trader fees, tips and rent don't skew the price:
  // on a buy the pool receives quote (biggest inflow), on a sell it pays it out (biggest outflow).
  const dir = side === 'buy' ? 1 : -1;
  let qSol = 0, qUsd = 0;
  for (const [k, v] of d) {
    const [owner, mt] = k.split('|');
    if (owner === who || v * dir <= 0) continue;
    if (mt === SOL_MINT) qSol = Math.max(qSol, Math.abs(v));
    else if (mt === USDC || mt === USDT) qUsd = Math.max(qUsd, Math.abs(v));
  }
  // Native-SOL pools (pump.fun style curves hold lamports directly).
  m.preBalances.forEach((pre, i) => {
    const k = keys[i]?.pubkey;
    if (!k || k === payer || k === who) return;
    const v = ((m.postBalances[i] ?? pre) - pre) / 1e9;
    if (v * dir > 0) qSol = Math.max(qSol, Math.abs(v));
  });
  const usd = Math.max(qSol * sol, qUsd);
  if (!(amt > 0) || !(usd >= 0.01)) return null;
  return { sig: tx.transaction.signatures[0], t: tx.blockTime * 1000, side, px: usd / amt, usd, amt, who };
}

/** Pull new swaps for a pool into the table. Throttled per pool; concurrent callers share one run. */
export async function syncPool(pool: string, mint: string): Promise<boolean> {
  if (Date.now() < offUntil) return false;
  const db = supabaseAdmin();
  if (!db || !/helius-rpc|api-key=/.test(rpcUrl())) { offUntil = Date.now() + 60_000; return false; }
  const last = lastSync.get(pool) || 0;
  if (Date.now() - last < SYNC_GAP_MS) return true;
  const running = inflight.get(pool);
  if (running) { await running; return true; }
  const run = (async () => {
    lastSync.set(pool, Date.now());
    const { data: st, error: e1 } = await db.from('pool_sync').select('last_sig,synced_at').eq('pool', pool).maybeSingle();
    if (e1) { if (/does not exist|relation|schema cache/i.test(e1.message)) offUntil = Date.now() + 60_000; throw e1; }
    if (st?.synced_at && Date.now() - Date.parse(st.synced_at) < SYNC_GAP_MS) return;
    const opts: Record<string, unknown> = { limit: st?.last_sig ? 200 : BACKFILL, commitment: 'confirmed' };
    if (st?.last_sig) opts.until = st.last_sig;
    const [sigs] = await rpcBatch<{ signature: string; err: unknown }[]>([{ method: 'getSignaturesForAddress', params: [pool, opts] }]);
    const fresh = (sigs || []).filter((s) => !s.err).map((s) => s.signature);
    const now = new Date().toISOString();
    if (!fresh.length) { await db.from('pool_sync').upsert({ pool, mint, last_sig: st?.last_sig || null, synced_at: now }); return; }
    const sol = await solUsd();
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < fresh.length; i += 100) {
      const part = fresh.slice(i, i + 100);
      const txs = await rpcBatch<ParsedTx>(part.map((s) => ({ method: 'getTransaction', params: [s, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }] })));
      for (const tx of txs) {
        if (!tx || !sol) continue;
        const s = decodeSwap(tx, mint, sol);
        if (s) rows.push({ pool, sig: s.sig, mint, t: new Date(s.t).toISOString(), side: s.side, px: s.px, usd: s.usd, amt: s.amt, who: s.who });
      }
    }
    if (rows.length) await db.from('pool_swaps').upsert(rows, { onConflict: 'pool,sig', ignoreDuplicates: true });
    await db.from('pool_sync').upsert({ pool, mint, last_sig: fresh[0], synced_at: now });
    // Keep the table small: older history comes from GeckoTerminal.
    if (Math.random() < 0.05) await db.from('pool_swaps').delete().eq('pool', pool).lt('t', new Date(Date.now() - KEEP_MS).toISOString());
  })();
  inflight.set(pool, run);
  try { await run; return true; } catch (e) { console.error('[swaps] sync failed', pool, (e as Error).message); return false; } finally { inflight.delete(pool); }
}

/** Recent swaps on a pool, oldest first. null = indexer unavailable (caller falls back to GeckoTerminal). */
export async function poolSwaps(pool: string, mint: string, sinceMs: number, limit = 5000): Promise<Swap[] | null> {
  if (!(await syncPool(pool, mint))) return null;
  const db = supabaseAdmin();
  if (!db) return null;
  const { data, error } = await db.from('pool_swaps').select('sig,t,side,px,usd,amt,who').eq('pool', pool)
    .gte('t', new Date(sinceMs).toISOString()).order('t', { ascending: false }).limit(limit);
  if (error) return null;
  return (data || []).map((r) => ({ sig: r.sig, t: Date.parse(r.t), side: r.side, px: Number(r.px), usd: Number(r.usd), amt: Number(r.amt), who: r.who })).reverse();
}

/** OHLCV candles [unixSeconds, o, h, l, c, volumeUsd] from swaps, oldest first. Drops one-off price outliers. */
export function toCandles(sw: Swap[], bucketSec: number): number[][] {
  const out: number[][] = [];
  let ref = 0;
  for (let i = 0; i < sw.length; i++) {
    const s = sw[i];
    // A swap more than 3x off the running price on both sides of it is a mis-decode (multi-hop noise), not a move.
    const far = (p: number) => p > ref * 3 || p < ref / 3;
    const nx = sw[i + 1]?.px;
    if (ref > 0 && far(s.px) && nx != null && !far(nx)) continue;
    ref = s.px;
    const b = Math.floor(s.t / 1000 / bucketSec) * bucketSec;
    const c = out[out.length - 1];
    if (c && c[0] === b) { c[2] = Math.max(c[2], s.px); c[3] = Math.min(c[3], s.px); c[4] = s.px; c[5] += s.usd; }
    else out.push([b, c ? c[4] : s.px, Math.max(s.px, c ? c[4] : s.px), Math.min(s.px, c ? c[4] : s.px), s.px, s.usd]);
  }
  return out;
}
