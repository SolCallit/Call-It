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
  const mc = new Map<string, number>(), px = new Map<string, number>();
  for (let i = 0; i < mints.length && i < 200; i += 50) {
    const l = await jupMany(mints.slice(i, i + 50)).catch(() => []);
    l.forEach((t) => { if (t.mc) mc.set(t.mint, t.mc); if (t.price) px.set(t.mint, t.price); });
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
    if (perf != null) { a.sum += perf; a.priced++; }
    if (p.target_at || (target && now && now >= target) || peakPerf >= 50) a.wins++;
    by.set(p.profile_id, a);
  }
  const ids = [...by.keys()];
  if (!ids.length) return NextResponse.json({ callers: [] });

  // Real PnL in dollars on the tokens each caller called: what their sells brought in, plus what they still
  // hold at today's price, minus what they paid. Counted once per caller per token, from their first call on it.
  // Sold positions are fixed at the sale; only what they still hold moves with the price.
  const firstCall = new Map<string, number>();
  for (const p of posts) {
    if (!p.mint || !by.has(p.profile_id)) continue;
    const k = p.profile_id + '|' + p.mint, t = Date.parse(p.created_at) - 10 * 60e3;
    if (!firstCall.has(k) || t < firstCall.get(k)!) firstCall.set(k, t);
  }
  const { data: txs } = await db.from('transactions')
    .select('profile_id, kind, in_mint, in_amount, out_mint, out_amount, usd_value, created_at')
    .in('profile_id', ids).in('kind', ['buy', 'sell']).eq('verified', true)
    .gte('created_at', new Date(Math.min(...firstCall.values(), Date.now())).toISOString()).limit(10000);
  const pos = new Map<string, { bought: number; sold: number; cost: number; got: number }>();
  for (const t of (txs || []) as { profile_id: string; kind: string; in_mint: string; in_amount: number; out_mint: string; out_amount: number; usd_value: number | null; created_at: string }[]) {
    const mint = t.kind === 'buy' ? t.out_mint : t.in_mint, k = t.profile_id + '|' + mint, since = firstCall.get(k);
    if (since == null || Date.parse(t.created_at) < since) continue;
    const r = pos.get(k) || { bought: 0, sold: 0, cost: 0, got: 0 };
    if (t.kind === 'buy') { r.bought += Number(t.out_amount) || 0; r.cost += Number(t.usd_value) || 0; }
    else { r.sold += Number(t.in_amount) || 0; r.got += Number(t.usd_value) || 0; }
    pos.set(k, r);
  }
  for (const [k, r] of pos) {
    const [pid, mint] = k.split('|'), a = by.get(pid);
    if (!a || !r.cost) continue;
    const held = Math.max(0, r.bought - r.sold), price = px.get(mint);
    a.pnl += r.got + (held && price ? held * price : 0) - r.cost;
  }
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
