import { NextResponse } from 'next/server';
import { dbOrNull } from '@/lib/db/me';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CASH = new Set(['So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v']);
type Row = { profile_id: string; kind: string; in_mint: string | null; in_amount: number | null; out_mint: string | null; out_amount: number | null; usd_value: number | null };

/**
 * GET /api/leaders/trades: top 10 realized wins of the last 7 days, from users' own Callit trades.
 * Realized = sell proceeds minus the average cost of the tokens sold (cost from buys in the same window).
 */
export async function GET() {
  const db = dbOrNull();
  if (!db) return NextResponse.json({ trades: [] });
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data, error } = await db
    .from('transactions')
    .select('profile_id, kind, in_mint, in_amount, out_mint, out_amount, usd_value')
    .in('kind', ['buy', 'sell', 'swap'])
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(5000);
  if (error) return NextResponse.json({ trades: [], error: 'db_read' }, { status: 500 });

  type Pos = { amt: number; cost: number; real: number; sold: number; basis: number };
  const book = new Map<string, Pos>();
  const get = (p: string, m: string) => {
    const k = p + '|' + m;
    let v = book.get(k);
    if (!v) book.set(k, (v = { amt: 0, cost: 0, real: 0, sold: 0, basis: 0 }));
    return v;
  };
  for (const r of (data || []) as Row[]) {
    const usd = Number(r.usd_value) || 0;
    if (!usd) continue;
    if (r.out_mint && !CASH.has(r.out_mint) && Number(r.out_amount) > 0) {
      const p = get(r.profile_id, r.out_mint);
      p.amt += Number(r.out_amount);
      p.cost += usd;
    }
    if (r.in_mint && !CASH.has(r.in_mint) && Number(r.in_amount) > 0) {
      const p = get(r.profile_id, r.in_mint);
      if (p.amt <= 0) continue; // bought before this week: no cost basis, skip
      const q = Math.min(Number(r.in_amount), p.amt);
      const avg = p.cost / p.amt;
      const proceeds = usd * (q / Number(r.in_amount));
      p.real += proceeds - avg * q;
      p.basis += avg * q;
      p.sold += proceeds;
      p.cost -= avg * q;
      p.amt -= q;
    }
  }
  const wins = [...book.entries()]
    .filter(([, p]) => p.real > 0 && p.basis > 0)
    .map(([k, p]) => ({ profile_id: k.split('|')[0], mint: k.split('|')[1], pnl: Math.round(p.real * 100) / 100, x: Math.round((p.sold / p.basis) * 10) / 10 }))
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, 10);
  if (!wins.length) return NextResponse.json({ trades: [] }, { headers: { 'cache-control': 'public, s-maxage=30' } });
  const { data: profs } = await db.from('profiles').select('id, handle, display_name, avatar_url').in('id', [...new Set(wins.map((w) => w.profile_id))]);
  const by = new Map((profs || []).map((p) => [p.id as string, p]));
  const trades = wins
    .map((w) => {
      const p = by.get(w.profile_id);
      return p ? { handle: p.handle, display_name: p.display_name, avatar_url: p.avatar_url, mint: w.mint, pnl: w.pnl, x: w.x } : null;
    })
    .filter(Boolean);
  return NextResponse.json({ trades }, { headers: { 'cache-control': 'public, s-maxage=30, stale-while-revalidate=120' } });
}
