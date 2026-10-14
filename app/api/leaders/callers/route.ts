import { NextResponse } from 'next/server';
import { dbOrNull } from '@/lib/db/me';
import { jupMany } from '@/lib/market/sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/leaders/callers?window=7d|30d|All time: real Callerboard from users' meme calls.
 * A call wins if the token hit its target or is up 50%+ since the call (current market cap vs entry).
 */
export async function GET(req: Request) {
  const db = dbOrNull();
  if (!db) return NextResponse.json({ callers: [] });
  const w = new URL(req.url).searchParams.get('window') || '30d';
  const days = w === '7d' ? 7 : w === '30d' ? 30 : 0;
  let q = db.from('posts').select('profile_id, mint, entry_mc, target_mc, buy_usd, created_at').eq('kind', 'meme').is('deleted_at', null).order('created_at', { ascending: false }).limit(3000);
  if (days) q = q.gte('created_at', new Date(Date.now() - days * 864e5).toISOString());
  const { data: posts, error } = await q;
  if (error) return NextResponse.json({ callers: [], error: 'db_read' }, { status: 500 });
  if (!posts?.length) return NextResponse.json({ callers: [] }, { headers: { 'cache-control': 'public, s-maxage=10' } });

  const mints = [...new Set(posts.map((p) => p.mint as string).filter(Boolean))];
  const mc = new Map<string, number>();
  for (let i = 0; i < mints.length && i < 200; i += 50) {
    const l = await jupMany(mints.slice(i, i + 50)).catch(() => []);
    l.forEach((t) => t.mc && mc.set(t.mint, t.mc));
  }
  type Agg = { calls: number; wins: number; sum: number; best: number; pnl: number };
  const by = new Map<string, Agg>();
  for (const p of posts) {
    const now = mc.get(p.mint as string);
    const entry = Number(p.entry_mc);
    if (!now || !entry) continue;
    const perf = (now / entry - 1) * 100;
    const target = Number(p.target_mc) || 0;
    const a = by.get(p.profile_id) || { calls: 0, wins: 0, sum: 0, best: -100, pnl: 0 };
    a.calls++; a.sum += perf; a.best = Math.max(a.best, perf);
    if ((target && now >= target) || perf >= 50) a.wins++;
    a.pnl += (Number(p.buy_usd) || 0) * (perf / 100);
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
    return { handle: p.handle, display_name: p.display_name, avatar_url: p.avatar_url, calls: a.calls, win: Math.round((a.wins / a.calls) * 100), avg: Math.round((a.sum / a.calls) * 10) / 10, best: Math.round(a.best * 10) / 10, pnl: Math.round(a.pnl * 100) / 100, followers: fc.get(p.handle) || 0, pts: pts.get(p.handle as string) ?? 0 };
  }).sort((x, y) => y.win - x.win || y.avg - x.avg || y.calls - x.calls);
  return NextResponse.json({ callers }, { headers: { 'cache-control': 'public, s-maxage=15, stale-while-revalidate=60' } });
}
