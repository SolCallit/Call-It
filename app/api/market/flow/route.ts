import { NextResponse } from 'next/server';
import { memeFlow } from '@/lib/market/sources';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/market/flow — the meme market radar: net inflow (buys minus sells) across Solana memes for
 * 5m / 1h / 6h / 24h, the biggest inflows and outflows this hour, and the last 24h of 5-minute snapshots.
 * A snapshot is saved at most every 5 minutes, whenever anyone opens the radar.
 */
export async function GET() {
  const f = await memeFlow();
  const db = supabaseAdmin();
  let history: { at: string; net_5m: number; net_1h: number }[] = [];
  if (db) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data } = await db.from('market_flow').select('at, net_5m, net_1h').gte('at', since).order('at', { ascending: true }).limit(400);
    history = (data || []) as typeof history;
    const last = history[history.length - 1];
    if (f && (!last || Date.now() - Date.parse(last.at) > 5 * 60_000)) {
      const row = { at: new Date().toISOString(), net_5m: f.win.m5.net, net_1h: f.win.h1.net, net_6h: f.win.h6.net, net_24h: f.win.h24.net,
        buy_5m: f.win.m5.buy, sell_5m: f.win.m5.sell, buy_1h: f.win.h1.buy, sell_1h: f.win.h1.sell, tokens: f.tokens };
      const { error } = await db.from('market_flow').insert(row);
      if (!error) history.push({ at: row.at, net_5m: row.net_5m, net_1h: row.net_1h });
    }
  }
  if (!f) return NextResponse.json({ error: 'upstream_unavailable', history }, { status: 502, headers: { 'cache-control': 'no-store' } });
  return NextResponse.json({ ...f, history }, { headers: { 'cache-control': 'public, s-maxage=20, stale-while-revalidate=60' } });
}
