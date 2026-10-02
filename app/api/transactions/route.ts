import { NextResponse } from 'next/server';
import { requireMe, json, isMint, num, str } from '@/lib/db/me';
import { rpc } from '@/lib/solana/rpc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS = ['buy', 'sell', 'swap', 'withdraw', 'deposit'];
const SIG = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/;

/** True when `wallet` signed the transaction on-chain. null = couldn't check right now. */
async function signedBy(sig: string, wallet: string): Promise<boolean | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const tx = await rpc<{ transaction: { message: { header: { numRequiredSignatures: number }; accountKeys: string[] } } } | null>(
        'getTransaction', [sig, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }],
      );
      if (tx) {
        const m = tx.transaction.message;
        return m.accountKeys.slice(0, m.header.numRequiredSignatures).includes(wallet);
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

  const verified = await signedBy(b.signature, me.wallet_address);
  if (verified === false) return json({ error: 'not_your_transaction' }, 403);

  const row = {
    profile_id: me.id, wallet: me.wallet_address, kind: b.kind, signature: b.signature,
    in_mint: isMint(b.in_mint) ? b.in_mint : null, in_amount: num(b.in_amount),
    out_mint: isMint(b.out_mint) ? b.out_mint : null, out_amount: num(b.out_amount),
    usd_value: num(b.usd_value), to_address: isMint(b.to_address) ? b.to_address : null,
    call_ref: typeof b.call_ref === 'string' || typeof b.call_ref === 'number' ? String(b.call_ref).slice(0, 64) : null,
    label: str(b.label, 160) || null, verified: verified === true,
  };
  const { error } = await db.from('transactions').upsert(row, { onConflict: 'signature', ignoreDuplicates: true });
  if (error) return json({ error: 'db_write', detail: error.message }, 500);

  if (row.kind === 'buy' && verified && row.call_ref && /^[0-9a-f-]{36}$/i.test(row.call_ref)) {
    await db.from('posts').update({ buy_sig: row.signature, buy_usd: row.usd_value || 0 })
      .eq('id', row.call_ref).eq('profile_id', me.id).is('buy_sig', null);
  }
  return json({ ok: true, verified: verified === true });
}
