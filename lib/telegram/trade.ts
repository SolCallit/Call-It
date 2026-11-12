import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  address, appendTransactionMessageInstructions, createTransactionMessage, getBase64EncodedWireTransaction, getBase64Encoder,
  getSignatureFromTransaction, getTransactionDecoder, pipe, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, signTransaction, signTransactionMessageWithSigners, type Blockhash,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { getOrder, executeOrder } from '@/lib/jupiter';
import { rpc, SOL_MINT } from '@/lib/solana/rpc';
import { jupMany, type LiveToken } from '@/lib/market/sources';
import { liveFeeBps } from '@/lib/fees/model';
import { onNewCall, onTrade } from '@/lib/alerts/triggers';
import { signerOf, solBalance, tokenBalance, maxBuySol, type BotWallet } from '@/lib/telegram/wallet';

const FEE_RESERVE_SOL = 0.006; // network fees + token account rent, kept back on buys

/**
 * The Callit profile a bot user trades as. Linked Telegram users trade as their Callit account
 * (calls, points, cashback and caller earnings all land there). Everyone else gets a light profile
 * paid to their bot wallet, which they can swap for their real account later with the Link flow.
 */
export async function profileFor(db: SupabaseClient, w: BotWallet, tg: { id: number; username?: string; first_name?: string }): Promise<{ id: string; handle: string }> {
  const { data: linked } = await db.from('tg_users').select('profile_id, profiles(handle)').eq('tg_user_id', tg.id).maybeSingle();
  const l = linked as unknown as { profile_id: string; profiles: { handle: string } | null } | null;
  if (l?.profile_id && l.profiles?.handle) {
    if (w.profile_id !== l.profile_id) await db.from('tg_wallets').update({ profile_id: l.profile_id }).eq('tg_user_id', tg.id);
    return { id: l.profile_id, handle: l.profiles.handle };
  }
  const privy_id = `tgu:${tg.id}`;
  const { data: have } = await db.from('profiles').select('id, handle').eq('privy_id', privy_id).maybeSingle();
  if (have) return have as { id: string; handle: string };
  const base = (tg.username || tg.first_name || 'trader').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 14) || 'trader';
  for (const handle of [base, `${base.slice(0, 12)}_tg`, `tg_${String(tg.id).slice(-6)}_${Date.now() % 1000}`]) {
    const { data, error } = await db.from('profiles').insert({
      privy_id, handle: handle.slice(0, 20), display_name: (tg.first_name || tg.username || 'Trader').slice(0, 40),
      wallet_address: w.address, bio: 'Trades with the Callit Telegram bot.',
    }).select('id, handle').single();
    if (!error && data) {
      await db.from('tg_wallets').update({ profile_id: data.id }).eq('tg_user_id', tg.id);
      await db.from('tg_users').upsert({ tg_user_id: tg.id, profile_id: data.id, username: tg.username ?? null }, { onConflict: 'tg_user_id' });
      return data as { id: string; handle: string };
    }
    if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
  }
  throw new Error('profile_failed');
}

/** Signs a Jupiter /order transaction with the bot wallet and sends it through /execute. */
async function swapSigned(w: BotWallet, input: string, output: string, amount: bigint, slippageBps?: number) {
  const order = await getOrder({
    inputMint: input, outputMint: output, amount: amount.toString(), taker: w.address,
    slippageBps: slippageBps ?? w.slippage_bps ?? undefined, priorityFeeLamports: 200_000,
  });
  if (!order.transaction) throw new Error(order.errorMessage || order.error || 'Couldn’t build this swap. Try a smaller amount.');
  const { pair } = await signerOf(w);
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(order.transaction));
  const signed = await signTransaction([pair], tx);
  const res = await executeOrder(getBase64EncodedWireTransaction(signed), order.requestId);
  if (res.status !== 'Success' || !res.signature) throw new Error(friendly(String(res.error || 'Swap failed')));
  return { signature: res.signature, order };
}

function friendly(m: string): string {
  const s = m.toLowerCase();
  if (/insufficient|0x1\b/.test(s)) return 'Not enough SOL for this trade plus network fees.';
  if (/slippage|0x1771|toolittle|toomuch/.test(s)) return 'Price moved too fast. Nothing was spent. Try again.';
  if (/blockhash|expired/.test(s)) return 'The trade expired before it landed. Nothing was spent. Try again.';
  return m.slice(0, 160);
}

type Rec = { kind: 'buy' | 'sell'; signature: string; in_mint: string; out_mint: string; in_amount: number; out_amount: number; usd: number; label: string; call_ref?: string | null; fee?: boolean };
async function record(db: SupabaseClient, me: { id: string; handle: string }, w: BotWallet, r: Rec) {
  const fee_bps = r.fee ? liveFeeBps() : 0, fee_usd = fee_bps && r.usd ? (r.usd * fee_bps) / 10_000 : 0;
  const row = {
    profile_id: me.id, wallet: w.address, kind: r.kind, signature: r.signature, in_mint: r.in_mint, in_amount: r.in_amount,
    out_mint: r.out_mint, out_amount: r.out_amount, usd_value: r.usd, call_ref: r.call_ref ?? null, label: r.label.slice(0, 160),
    verified: true, fee_bps, fee_usd, // the server signed and Jupiter confirmed it, so it's verified
  };
  const { error } = await db.from('transactions').upsert(row, { onConflict: 'signature', ignoreDuplicates: true });
  if (error) console.warn('[tg-trade] record', error.message);
  await onTrade(db, me, { kind: r.kind, signature: r.signature, in_mint: r.in_mint, out_mint: r.out_mint, usd_value: r.usd }).catch(() => {});
}

/**
 * A buy from the bot becomes a call on Callit (once per token per 24h per person): entry stamped
 * at the live MC, the buy attached as the caller's buy-in, followers alerted. That's the loop:
 * trade in Telegram, show up on Callit, earn when people buy your call.
 */
async function autoCall(db: SupabaseClient, me: { id: string; handle: string }, t: LiveToken, sig: string, usd: number, sol: number): Promise<string | null> {
  const since = new Date(Date.now() - 864e5).toISOString();
  const { data: recent } = await db.from('posts').select('id').eq('profile_id', me.id).eq('mint', t.mint).eq('kind', 'meme').gte('created_at', since).limit(1);
  if (recent?.length) return recent[0].id as string;
  const row = {
    profile_id: me.id, kind: 'meme', media: [], body: `Aped ${sol} SOL into $${t.sym || 'this'} 🎯`,
    mint: t.mint, token_sym: (t.sym || '').slice(0, 20), token_name: (t.name || '').slice(0, 60), chain: 'Solana',
    entry_mc: t.mc, horizon: '7 days', source: 'telegram', source_label: 'Callit bot', buy_sig: sig, buy_usd: usd,
  };
  const { data, error } = await db.from('posts').insert(row).select('id, kind, mint, token_sym, entry_mc, body').single();
  if (error) { if (!/daily_post_limit/.test(error.message)) console.warn('[tg-trade] call', error.message); return null; }
  await onNewCall(db, me, data as { id: string; kind: string; mint: string; token_sym: string; entry_mc: number; body: string }).catch(() => {});
  return data.id as string;
}

export type TradeOut = { ok: true; signature: string; text: string; callId?: string | null } | { ok: false; error: string };

export async function buy(db: SupabaseClient, w: BotWallet, tgUser: { id: number; username?: string; first_name?: string }, mint: string, sol: number, callRef?: string | null): Promise<TradeOut> {
  if (!(sol > 0) || sol > maxBuySol()) return { ok: false, error: `Buys are between 0.001 and ${maxBuySol()} SOL.` };
  const [bal, [t]] = await Promise.all([solBalance(w.address), jupMany([mint]).catch(() => [])]);
  if (!t?.price) return { ok: false, error: 'Couldn’t find a live price for that token.' };
  if (bal < sol + FEE_RESERVE_SOL) return { ok: false, error: `Not enough SOL. You have ${bal.toFixed(4)} SOL; keep ~${FEE_RESERVE_SOL} for fees.` };
  try {
    const { signature, order } = await swapSigned(w, SOL_MINT, mint, BigInt(Math.floor(sol * 1e9)));
    const me = await profileFor(db, w, tgUser);
    const usd = Number(order.inUsdValue) || 0;
    const outUi = t.decimals != null ? Number(order.outAmount) / 10 ** t.decimals : Number(order.outAmount);
    let callId: string | null = null;
    if (w.auto_call && t.mc) callId = await autoCall(db, me, t, signature, usd, sol);
    await record(db, me, w, { kind: 'buy', signature, in_mint: SOL_MINT, out_mint: mint, in_amount: sol, out_amount: outUi, usd, label: `Bot buy $${t.sym}`, call_ref: callRef || callId, fee: !!order.withReferral });
    return { ok: true, signature, callId, text: `Bought ~${fmtN(outUi)} $${t.sym} for ${sol} SOL${usd ? ` ($${usd.toFixed(2)})` : ''}` };
  } catch (e) { return { ok: false, error: (e as Error).message || 'Buy failed. Nothing was spent.' }; }
}

export async function sell(db: SupabaseClient, w: BotWallet, tgUser: { id: number; username?: string; first_name?: string }, mint: string, pct: number): Promise<TradeOut> {
  if (!(pct > 0 && pct <= 100)) return { ok: false, error: 'Sell between 1% and 100%.' };
  const [bal, [t]] = await Promise.all([tokenBalance(w.address, mint), jupMany([mint]).catch(() => [])]);
  if (bal.raw <= 0n) return { ok: false, error: 'You don’t hold this token.' };
  const amt = pct >= 100 ? bal.raw : (bal.raw * BigInt(Math.round(pct * 100))) / 10_000n;
  if (amt <= 0n) return { ok: false, error: 'That’s too small to sell.' };
  try {
    const { signature, order } = await swapSigned(w, mint, SOL_MINT, amt);
    const me = await profileFor(db, w, tgUser);
    const sol = Number(order.outAmount) / 1e9, usd = Number(order.outUsdValue) || 0;
    await record(db, me, w, { kind: 'sell', signature, in_mint: mint, out_mint: SOL_MINT, in_amount: Number(amt) / 10 ** bal.decimals, out_amount: sol, usd, label: `Bot sell $${t?.sym || ''}`, fee: !!order.withReferral });
    return { ok: true, signature, text: `Sold ${pct}% of $${t?.sym || 'token'} for ${sol.toFixed(4)} SOL${usd ? ` ($${usd.toFixed(2)})` : ''}` };
  } catch (e) { return { ok: false, error: (e as Error).message || 'Sell failed. Nothing was spent.' }; }
}

/** Sends SOL out of the bot wallet. "all" leaves just the network fee behind. */
export async function withdraw(w: BotWallet, to: string, sol: number | 'all'): Promise<TradeOut> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to) || to === w.address) return { ok: false, error: 'That isn’t a valid Solana address.' };
  const bal = await solBalance(w.address);
  const amount = sol === 'all' ? bal - 0.000_01 : sol;
  if (!(amount > 0) || amount > bal - 0.000_005) return { ok: false, error: `Not enough SOL. You have ${bal.toFixed(4)} SOL.` };
  try {
    const { signer } = await signerOf(w);
    const { value: bh } = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    const msg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: bh.blockhash as Blockhash, lastValidBlockHeight: BigInt(bh.lastValidBlockHeight) }, m),
      (m) => appendTransactionMessageInstructions([getTransferSolInstruction({ source: signer, destination: address(to), amount: BigInt(Math.floor(amount * 1e9)) })], m),
    );
    const tx = await signTransactionMessageWithSigners(msg);
    const signature = getSignatureFromTransaction(tx);
    await rpc<string>('sendTransaction', [getBase64EncodedWireTransaction(tx), { encoding: 'base64', maxRetries: 5, preflightCommitment: 'confirmed' }]);
    return { ok: true, signature, text: `Sent ${amount.toFixed(4)} SOL to ${to.slice(0, 4)}…${to.slice(-4)}` };
  } catch (e) { return { ok: false, error: friendly((e as Error).message || 'Withdraw failed.') }; }
}

export const fmtN = (n: number) => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n >= 1 ? n.toFixed(2) : n.toPrecision(3);
export const fmtUsd = (n: number | null | undefined) => n == null ? '—' : '$' + fmtN(n);
