import { json } from '@/lib/db/me';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { settleEarnings, creditCashback } from '@/lib/earnings/settle';
import { payReady } from '@/lib/payouts/payout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/payouts — daily catch-up for anything the per-minute instant payouts missed. Vercel Cron calls it once a day (vercel.json)
 * with Authorization: Bearer <CRON_SECRET>.
 *
 * 1. Settles any pending claims from earlier runs (checks the chain first, never pays twice).
 * 2. Credits fresh earnings.
 * 3. Pays everyone with at least PAYOUT_MIN_USD unclaimed, biggest first, inside the daily cap,
 *    using the same claim() path as the Claim button (same caps, same pause switch).
 * Off unless AUTO_PAYOUTS=1. Users can still press Claim any time in between.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.get('authorization') || '').replace(/^Bearer /, '') || req.headers.get('x-cron-secret') || '';
  if (!secret || given !== secret) return json({ error: 'unauthorized' }, 401);
  if (process.env.AUTO_PAYOUTS !== '1') return json({ ok: true, skipped: 'AUTO_PAYOUTS is not 1' });
  const db = supabaseAdmin();
  if (!db) return json({ ok: false, error: 'no_db' }, 500);

  const credited = await settleEarnings(db).catch(() => ({ credited: 0, usd: 0 }));
  const cashback = await creditCashback(db).catch(() => ({ credited: 0, usd: 0 }));
  const paid = await payReady(db, 45_000);
  return json({ ok: true, credited, cashback, ...paid });
}
