import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Fee proof (migration 0022). Callit only pays fee shares, cashback and volume points on trades
 * that really paid Callit's fee, i.e. orders Callit built with its referral fee and executed through
 * /api/swap/execute. A swap made on another app can't be submitted to farm payouts.
 */

/** Remember an order that carries Callit's fee. Never blocks trading. */
export async function saveOrder(o: { requestId: string; taker: string; feeBps: number; feeMint?: string | null }): Promise<void> {
  if (!o.feeBps || !o.requestId) return;
  const db = supabaseAdmin();
  if (!db) return;
  const { error } = await db.from('swap_orders').upsert(
    { request_id: o.requestId, taker: o.taker, fee_bps: o.feeBps, fee_mint: o.feeMint ?? null },
    { onConflict: 'request_id', ignoreDuplicates: true },
  );
  if (error) console.warn('[swap_orders] save', error.message);
}

/** Stamp the landed signature on its order. */
export async function markFilled(requestId: string, signature: string): Promise<void> {
  const db = supabaseAdmin();
  if (!db) return;
  const { error } = await db.from('swap_orders').update({ signature }).eq('request_id', requestId).is('signature', null);
  if (error) console.warn('[swap_orders] fill', error.message);
}

/** Callit's fee in bps on this signature for this wallet, or 0 if the trade didn't go through Callit with a fee. */
export async function feeBpsFor(db: SupabaseClient, signature: string, wallet: string): Promise<number> {
  const { data, error } = await db.from('swap_orders').select('fee_bps, taker').eq('signature', signature).maybeSingle();
  if (error || !data || data.taker !== wallet) return 0;
  return Number(data.fee_bps) || 0;
}
