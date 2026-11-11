import { NextResponse } from 'next/server';
import { dbOrNull, maybeMe, json } from '@/lib/db/me';
import { POINTS, cashbackMinPoints, feedbackPoints } from '@/lib/fees/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); };

/**
 * GET /api/points?period=month|all
 * The Points board (top users by verified points), plus your own points and rank when signed in.
 * Monthly rewards pay the top of the month board; they switch on with MONTHLY_REWARDS_ON=1.
 */
export async function GET(req: Request) {
  const db = dbOrNull();
  if (!db) return json({ ready: false, board: [] });
  const period = new URL(req.url).searchParams.get('period') === 'all' ? 'all' : 'month';
  const since = period === 'all' ? new Date(0) : monthStart();
  const [{ data, error }, me] = await Promise.all([
    db.rpc('points_board', { p_since: since.toISOString(), p_limit: 100 }),
    maybeMe(req),
  ]);
  if (error) return json({ ready: false, board: [], reason: 'Run migration 0015 in Supabase.' });
  const board = ((data || []) as { handle: string; display_name: string | null; avatar_url: string | null; pts: number }[])
    .map((r, i) => ({ rank: i + 1, handle: r.handle, name: r.display_name, avatar: r.avatar_url, pts: Math.floor(Number(r.pts)) }));

  let mine: { pts: number; total: number; rank: number | null } | null = null;
  if (me) {
    const [{ data: tot }, { data: mon }] = await Promise.all([
      db.rpc('points_of', { p: me.id }),
      db.from('points').select('amount').eq('profile_id', me.id).gte('created_at', since.toISOString()).limit(20000),
    ]);
    const pts = Math.floor(((mon || []) as { amount: number }[]).reduce((a, r) => a + Number(r.amount), 0));
    const at = board.findIndex((b) => b.handle === me.handle);
    mine = { pts, total: Math.floor(Number(tot) || 0), rank: at >= 0 ? at + 1 : null };
  }
  const end = new Date(Date.UTC(monthStart().getUTCFullYear(), monthStart().getUTCMonth() + 1, 1));
  return NextResponse.json({
    ready: true, period, board, me: mine,
    rules: { ...POINTS, cashbackPoints: cashbackMinPoints(), feedback: feedbackPoints() },
    monthly: { on: process.env.MONTHLY_REWARDS_ON === '1', top: Number(process.env.MONTHLY_REWARDS_TOP) || 50, endsAt: end.toISOString() },
  }, { headers: { 'cache-control': me ? 'no-store' : 'public, s-maxage=30, stale-while-revalidate=120' } });
}
