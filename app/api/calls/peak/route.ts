import { dbOrNull, json } from '@/lib/db/me';
import { liveToken, candles, type Tf } from '@/lib/market/sources';
import { burst, clientIp } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Row = { id: string; mint: string | null; entry_mc: number | null; target_mc: number | null; created_at: string; hi_x?: number | null; hit_at?: string | null; target_at?: string | null };

/** Candle size that covers the call's whole life in one request (300 candles max). */
const tfFor = (ageH: number): Tf => (ageH < 4.5 ? '1m' : ageH < 24 ? '5m' : ageH < 72 ? '15m' : '1h');

/**
 * GET /api/calls/peak?ids=<uuid,...>
 * Checks each call's real high since it was made (from chart candles, so a quick pump between
 * cron samples still counts) and records hi_x / hit_at. Display only: payouts keep the wick-proof peak.
 */
export async function GET(req: Request) {
  const db = dbOrNull();
  if (!db) return json({ peaks: {} });
  if (!burst('peak:' + clientIp(req), 12, 60_000)) return json({ peaks: {} }, 429);
  const ids = (new URL(req.url).searchParams.get('ids') || '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 8);
  if (!ids.length) return json({ peaks: {} });

  const full = await db.from('posts').select('id, mint, entry_mc, target_mc, created_at, hi_x, hit_at, target_at').in('id', ids).eq('kind', 'meme');
  const rows = (full.error
    ? (await db.from('posts').select('id, mint, entry_mc, target_mc, created_at, target_at').in('id', ids).eq('kind', 'meme')).data // 0012 not run yet
    : full.data) as Row[] | null ?? [];
  const peaks: Record<string, { hi_x: number; hit_at: string | null }> = {};

  await Promise.all(rows.map(async (r) => {
    const entry = Number(r.entry_mc) || 0;
    if (!r.mint || entry <= 0) return;
    let hi = Number(r.hi_x) || 0;
    let hitAt = r.hit_at || r.target_at || null;
    const t = await liveToken(r.mint);
    if (t?.pool && t.price && t.mc) {
      const born = Date.parse(r.created_at) / 1000;
      const list = await candles(t.pool, r.mint, tfFor((Date.now() / 1000 - born) / 3600));
      const supply = t.mc / t.price;
      const target = Number(r.target_mc) || 0;
      for (const c of list || []) {
        if (c[0] + 60 < born) continue; // candle closed before the call
        const x = (c[2] * supply) / entry;
        if (!Number.isFinite(x) || x <= 0 || x > 100000) continue;
        if (x > hi) hi = x;
        if (!hitAt && target > 0 && c[2] * supply >= target) hitAt = new Date(Math.max(c[0], born) * 1000).toISOString();
      }
      // Live MC counts too.
      const now = t.mc / entry;
      if (now > hi) hi = now;
      if (!hitAt && target > 0 && t.mc >= target) hitAt = new Date().toISOString();
    }
    peaks[r.id] = { hi_x: hi, hit_at: hitAt };
    if (hi > (Number(r.hi_x) || 0) || (hitAt && !r.hit_at)) {
      const up = await db.from('posts').update({ hi_x: hi, ...(hitAt && !r.hit_at ? { hit_at: hitAt } : {}) }).eq('id', r.id);
      if (up.error && !/hi_x|hit_at/.test(up.error.message)) console.warn('[peak]', up.error.message);
    }
  }));
  return json({ peaks }, 200);
}
