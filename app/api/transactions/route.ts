import { NextResponse, after } from 'next/server';
import { requireMe, json, isMint, num, str } from '@/lib/db/me';
import { rpc } from '@/lib/solana/rpc';
import { liveFeeBps } from '@/lib/fees/model';
import { solPrice } from '@/lib/payouts/payout';
import { onTrade } from '@/lib/alerts/triggers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS = ['buy', 'sell', 'swap', 'withdraw', 'deposit'];
const SIG = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/;

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WSOL = 'So11111111111111111111111111111111111111112';

type TokBal = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { uiAmount: number | null } };
type RpcTx = {
  blockTime: number | null;
  transaction: { message: { header: { numRequiredSignatures: number }; accountKeys: string[] } };
  meta: { err: unknown; fee: number; preBalances: number[]; postBalances: number[]; preTokenBalances?: TokBal[]; postTokenBalances?: TokBal[] } | null;
};

/** What the chain says about this transaction for `wallet`. null = couldn't check right now. */
async function onChain(sig: string, wallet: string): Promise<{ signed: boolean; ok: boolean; ageMs: number; sol: number; usdc: number } | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const tx = await rpc<RpcTx | null>('getTransaction', [sig, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
      if (tx) {
        const m = tx.transaction.message;
        const signed = m.accountKeys.slice(0, m.header.numRequiredSignatures).includes(wallet);
        const idx = m.accountKeys.indexOf(wallet);
        const meta = tx.meta;
        // Net SOL moved by the wallet (network fee added back), plus wrapped SOL and USDC it owns.
        let sol = 0, usdc = 0;
        if (meta && idx >= 0) sol = (meta.postBalances[idx] - meta.preBalances[idx] + (idx === 0 ? meta.fee : 0)) / 1e9;
        const tok = (list: TokBal[] | undefined, mint: string) =>
          (list || []).filter((b) => b.mint === mint && b.owner === wallet).reduce((a, b) => a + (Number(b.uiTokenAmount.uiAmount) || 0), 0);
        if (meta) {
          sol += tok(meta.postTokenBalances, WSOL) - tok(meta.preTokenBalances, WSOL);
          usdc = tok(meta.postTokenBalances, USDC) - tok(meta.preTokenBalances, USDC);
        }
        return { signed, ok: !!meta && !meta.err, ageMs: tx.blockTime ? Date.now() - tx.blockTime * 1000 : Infinity, sol, usdc };
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

/** GET /api/transactions?before=<iso> — the signed-in user's history (newest first). */
export async function GET(req: Request) {
  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  const before = new URL(req.url).searchParams.get('before');
  let q = ctx.db.from('transactions').select('kind, signature, in_mint, in_amount, out_mint, out_amount, usd_value, to_address, call_ref, label, verified, created_at')
    .eq('profile_id', ctx.me.id).order('created_at', { ascending: false }).limit(50);
  if (before && !Number.isNaN(Date.parse(before))) q = q.lt('created_at', before);
  const { data, error } = await q;
  if (error) return json({ error: 'db_read', detail: error.message }, 500);
  return json({ transactions: data || [] });
}

/**
 * POST /api/transactions — records a transaction the user just made in Callit.
 * The signature is checked on-chain; a buy tied to the user's own call (call_ref)
 * is stamped onto that call as its buy-in.
 */
export async function POST(req: Request) {
  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  const { db, me } = ctx;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.kind !== 'string' || !KINDS.includes(b.kind)) return json({ error: 'invalid_kind' }, 400);
  if (typeof b.signature !== 'string' || !SIG.test(b.signature)) return json({ error: 'invalid_signature' }, 400);
  if (!me.wallet_address) return json({ error: 'no_wallet' }, 400);

  const chain = await onChain(b.signature, me.wallet_address);
  if (chain && !chain.signed) return json({ error: 'not_your_transaction' }, 403);
  const verified: boolean | null = chain ? chain.ok : null;
  const trade0 = b.kind === 'buy' || b.kind === 'sell' || b.kind === 'swap';
  /* Trade value comes from the chain, never from the browser: SOL or USDC the wallet actually moved.
     The client's number is only allowed to be lower. Old or failed transactions earn nothing. */
  let usdValue = num(b.usd_value);
  if (trade0) {
    const sp = chain && chain.sol !== 0 ? await solPrice() : null;
    const real = chain ? Math.max(Math.abs(chain.sol) * (sp || 0), Math.abs(chain.usdc)) : 0;
    const fresh = !!chain && chain.ok && chain.ageMs < 15 * 60e3;
    usdValue = fresh && real > 0 ? Math.min(usdValue && usdValue > 0 ? usdValue : real, real * 1.05) : 0;
  }

  const row = {
    profile_id: me.id, wallet: me.wallet_address, kind: b.kind, signature: b.signature,
    in_mint: isMint(b.in_mint) ? b.in_mint : null, in_amount: num(b.in_amount),
    out_mint: isMint(b.out_mint) ? b.out_mint : null, out_amount: num(b.out_amount),
    usd_value: usdValue, to_address: isMint(b.to_address) ? b.to_address : null,
    call_ref: typeof b.call_ref === 'string' || typeof b.call_ref === 'number' ? String(b.call_ref).slice(0, 64) : null,
    label: str(b.label, 160) || null, verified: verified === true,
  };
  // Fee Callit earned on this trade, stamped server-side from the live referral setting.
  const trade = row.kind === 'buy' || row.kind === 'sell' || row.kind === 'swap';
  const fee_bps = trade ? liveFeeBps() : 0;
  const fee_usd = fee_bps && row.usd_value ? (row.usd_value * fee_bps) / 10_000 : 0;
  let { error } = await db.from('transactions').upsert({ ...row, fee_bps, fee_usd }, { onConflict: 'signature', ignoreDuplicates: true });
  // Migration 0006 not run yet: still record the trade, just without fee columns.
  if (error && /fee_(bps|usd)/.test(error.message)) ({ error } = await db.from('transactions').upsert(row, { onConflict: 'signature', ignoreDuplicates: true }));
  if (error) return json({ error: 'db_write', detail: error.message }, 500);

  if (row.kind === 'buy' && verified && row.call_ref && /^[0-9a-f-]{36}$/i.test(row.call_ref)) {
    await db.from('posts').update({ buy_sig: row.signature, buy_usd: row.usd_value || 0 })
      .eq('id', row.call_ref).eq('profile_id', me.id).is('buy_sig', null);
  }
  if (trade && row.signature) after(() => onTrade(db, me, row as { kind: string; signature: string; in_mint: string | null; out_mint: string | null; usd_value: number | null }).catch(() => {}));
  return json({ ok: true, verified: verified === true });
}
