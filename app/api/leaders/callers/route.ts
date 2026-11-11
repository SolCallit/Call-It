import { NextResponse } from 'next/server';
import { dbOrNull } from '@/lib/db/me';
import { jupMany } from '@/lib/market/sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/leaders/callers?window=7d|30d|All time: real Callerboard from users' meme calls.
 * A call wins if it hit its target or reached +50% at any point since the call. Wins are locked in
 * (posts.target_at / posts.peak_x), so a token dumping later never turns a win back into a loss and
 * the board doesn't reshuffle on every price tick.
 *
 * Order: confidence-adjusted win rate (Wilson lower bound, so 9 of 10 outranks 1 of 1), then verified
 * points, then number of calls, then handle. Live average return is shown but never decides the order.
 */
function wilson(wins: number, n: number): number {
  if (!n) return 0;
  const z = 1.96, p = wins / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / (1 + (z * z) / n);
}

type Row = { profile_id: string; mint: string | null; entry_mc: number | null; target_mc: number | null; buy_usd: number | null; created_at: string; peak_x?: number | null; target_at?: string | null };
export async function GET(req: Request) {
  const db = dbOrNull();
  if (!db) return NextResponse.json({ callers: [] });
  const w = new URL(req.url).searchParams.get('window') || '30d';
  const days = w === '7d' ? 7 : w === '30d' ? 30 : 0;
  const read = (cols: string) => {
    let q = db.from('posts').select(cols).eq('kind', 'meme').is('deleted_at', null).order('created_at', { ascending: false }).limit(3000);
    if (days) q = q.gte('created_at', new Date(Date.now() - days * 864e5).toISOString());
    return q;
  };
  const base = 'profile_id, mint, entry_mc, target_mc, buy_usd, created_at';
  // peak_x / target_at come from a later migration: fall back to live-only scoring if it hasn't run.
  let res = await read(`${base}, peak_x, target_at`);
  if (res.error) res = await read(base);
  const posts = res.data as unknown as Row[] | null;
  if (res.error) return NextResponse.json({ callers: [], error: 'db_read' }, { status: 500 });
  if (!posts?.length) return NextResponse.json({ callers: [] }, { headers: { 'cache-control': 'public, s-maxage=10' } });

  const mints = [...new Set(posts.map((p) => p.mint as string).filter(Boolean))];
  const mc = new Map<string, number>();
  for (let i = 0; i < mints.length && i < 200; i += 50) {
    const l = await jupMany(mints.slice(i, i + 50)).catch(() => []);
    l.forEach((t) => t.mc && mc.set(t.mint, t.mc));
  }
  type Agg = { calls: number; wins: number; sum: number; priced: number; best: number; pnl: number };
  const by = new Map<string, Agg>();
  for (const p of posts) {
    const entry = Number(p.entry_mc);
    if (!entry) continue;
    const now = mc.get(p.mint as string);
    const peakX = Number(p.peak_x) || 0;
    // A price lookup that fails must not drop the call: that used to change call counts between visits.
    if (!now && !peakX && !p.target_at) continue;
    const perf = now ? (now / entry - 1) * 100 : null;
    const peakPerf = Math.max(peakX ? (peakX - 1) * 100 : -100, perf ?? -100);
    const target = Number(p.target_mc) || 0;
    const a = by.get(p.profile_id) || { calls: 0, wins: 0, sum: 0, priced: 0, best: -100, pnl: 0 };
    a.calls++;
    a.best = Math.max(a.best, peakPerf);
    if (perf != null) { a.sum += perf; a.priced++; a.pnl += (Number(p.buy_usd) || 0) * (perf / 100); }
    if (p.target_at || (target && now && now >= target) || peakPerf >= 50) a.wins++;
    by.set(p.profile_id, a);
  }
  const ids = [...by.keys()];
  if (!ids.length) return NextResponse.json({ callers: [] });
  const { data: profs } = await db.from('profiles').select('id, handle, display_name, avatar_url').in('id', ids);
  const handles = (profs || []).map((p) => p.handle as string);
  const { data: fol } = handles.length ? await db.from('follows').select('target_handle').in('target_handle', handles).limit(20000) : { data: [] };
  const fc = new Map<string, number>();
  (fol || []).forEach((f) => fc.set(f.target_handle, (fc.get(f.target_handle) || 0) + 1));
  // Verified points (migration 0015). Empty until it has run.
  const { data: pb } = await db.rpc('points_board', { p_since: new Date(0).toISOString(), p_limit: 2000 });
  const pts = new Map(((pb || []) as { handle: string; pts: number }[]).map((r) => [r.handle, Math.floor(Number(r.pts))]));
  const callers = (profs || []).map((p) => {
    const a = by.get(p.id)!;
    return { handle: p.handle as string, display_name: p.display_name, avatar_url: p.avatar_url, calls: a.calls, win: Math.round((a.wins / a.calls) * 100), avg: a.priced ? Math.round((a.sum / a.priced) * 10) / 10 : 0, best: Math.round(a.best * 10) / 10, pnl: Math.round(a.pnl * 100) / 100, followers: fc.get(p.handle) || 0, pts: pts.get(p.handle as string) ?? 0, score: Math.round(wilson(a.wins, a.calls) * 1e4) };
  }).sort((x, y) => y.score - x.score || y.pts - x.pts || y.calls - x.calls || x.handle.localeCompare(y.handle));
  return NextResponse.json({ callers }, { headers: { 'cache-control': 'public, s-maxage=15, stale-while-revalidate=60' } });
}
