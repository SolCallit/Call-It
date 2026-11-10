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
      // Bucket + per-token snapshots (migration 0023). Best effort: a missing table must never break the radar.
      try {
        const bRows = [...(f.buckets || []), { key: 'majors', n: f.majors?.n || 0, w: f.majors?.w } as never].flatMap((b) => {
          const w = (b as { w?: { m5: { b: number; s: number }; h1: { b: number; s: number }; h24: { b: number; s: number } } }).w;
          if (!w) return [];
          return [{ at: row.at, bucket: (b as { key: string }).key, tokens: (b as { n: number }).n,
            buy_5m: w.m5.b, sell_5m: w.m5.s, buy_1h: w.h1.b, sell_1h: w.h1.s, buy_24h: w.h24.b, sell_24h: w.h24.s }];
        });
        if (bRows.length) await db.from('market_flow_buckets').insert(bRows);
        if (f.snap?.length) {
          await db.from('token_snapshots').insert(f.snap.map((t) => ({
            at: row.at, mint: t.mint, sym: t.sym, mc: t.mc, price: t.price, liq: t.liq, holders: t.holders,
            organic: t.organic, launchpad: t.launchpad,
            buy_5m: t.buy5, sell_5m: t.sell5, buy_1h: t.buy1, sell_1h: t.sell1,
            chg_5m: t.chg5, chg_1h: t.chg1, chg_24h: t.chg24,
          })));
        }
        // Keep the tables bounded: 14 days of token snapshots, 60 days of bucket history.
        await db.from('token_snapshots').delete().lt('at', new Date(Date.now() - 14 * 86400_000).toISOString());
        await db.from('market_flow_buckets').delete().lt('at', new Date(Date.now() - 60 * 86400_000).toISOString());
      } catch { /* tables not there yet — fine */ }
    }
  }
  if (!f) return NextResponse.json({ error: 'upstream_unavailable', history }, { status: 502, headers: { 'cache-control': 'no-store' } });
  const { snap: _snap, ...pub } = f; // snapshots are server-side tuning data, not a client payload
  return NextResponse.json({ ...pub, history }, { headers: { 'cache-control': 'public, s-maxage=20, stale-while-revalidate=60' } });
}
