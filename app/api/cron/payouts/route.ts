import { json } from '@/lib/db/me';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { settleEarnings } from '@/lib/earnings/settle';
import { claim, resolvePending, isPaused, payoutIssue } from '@/lib/payouts/payout';
import { PAYOUT } from '@/lib/fees/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/payouts — daily auto-payout ("payday"). Vercel Cron calls it once a day (vercel.json)
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

  const started = Date.now();
  const { data: pend } = await db.from('claims').select('id, signature, created_at, status').eq('status', 'pending').limit(50);
  for (const c of pend || []) await resolvePending(db, c);

  const credited = await settleEarnings(db).catch(() => ({ credited: 0, usd: 0 }));
  const issue = await payoutIssue(await isPaused(db));
  if (issue) return json({ ok: true, credited, paid: 0, skipped: issue });

  const { data: queue, error } = await db.rpc('payout_queue', { p_min: PAYOUT.minUsd(), p_limit: 200 });
  if (error) return json({ ok: false, error: 'Run migration 0013 first', detail: error.message }, 500);

  const results: { profile: string; ok: boolean; usd?: number; sig?: string; error?: string }[] = [];
  for (const row of (queue || []) as { profile_id: string; wallet: string }[]) {
    if (Date.now() - started > 45_000) break; // stay inside the function time limit; the rest go tomorrow
    const r = await claim(db, { id: row.profile_id, wallet_address: row.wallet }, { wait: false });
    results.push(r.ok ? { profile: row.profile_id, ok: true, usd: r.usd, sig: r.signature } : { profile: row.profile_id, ok: false, error: r.error });
    if (!r.ok && (r.status === 429 || r.status === 503)) break; // daily cap used up, wallet low, or paused
  }
  const paid = results.filter((r) => r.ok);
  return json({ ok: true, credited, paid: paid.length, usd: +paid.reduce((a, r) => a + (r.usd || 0), 0).toFixed(2), results });
}
