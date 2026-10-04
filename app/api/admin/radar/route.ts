import { NextResponse } from 'next/server';
import { json } from '@/lib/db/me';
import { requireAdmin } from '@/lib/db/admin';
import { BUCKETS, FEE_BPS_STANDARD, liveFeeBps, split, type Bucket } from '@/lib/fees/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWJ5gWW2DnzSp1pThfP1QZBrpdKvR1MzVg1uu5ihx';
const TRADES = ['buy', 'sell', 'swap'];

type Tx = {
  profile_id: string; kind: string; in_mint: string | null; out_mint: string | null;
  usd_value: number | null; call_ref: string | null; created_at: string; fee_usd?: number | null; fee_bps?: number | null;
};

/**
 * GET /api/admin/radar: trading volume, fees and the fee split, admins only.
 * Reads the last 90 days of trades recorded through Callit (transactions table).
 */
export async function GET(req: Request) {
  const a = await requireAdmin(req);
  if (a instanceof NextResponse) return a;
  const { db } = a;

  const since = new Date(Date.now() - 90 * 864e5).toISOString();
  const { data, error } = await db.from('transactions').select('*').in('kind', TRADES).gte('created_at', since)
    .order('created_at', { ascending: false }).limit(50_000);
  if (error) return json({ error: 'db_read', detail: error.message }, 500);
  const txs = (data || []) as Tx[];
  const feeCols = txs.length ? 'fee_usd' in txs[0] : true;

  // Trades that came from someone else's call where the caller bought in.
  const refs = [...new Set(txs.map((t) => t.call_ref).filter((r): r is string => !!r && /^[0-9a-f-]{36}$/i.test(r)))];
  const calls = new Map<string, { owner: string; bought: boolean; sym: string | null }>();
  for (let i = 0; i < refs.length; i += 500) {
    const { data: ps } = await db.from('posts').select('id, profile_id, buy_sig, token_sym').in('id', refs.slice(i, i + 500));
    (ps || []).forEach((p) => calls.set(p.id as string, { owner: p.profile_id as string, bought: !!p.buy_sig, sym: (p.token_sym as string) || null }));
  }
  const viaCall = (t: Tx) => { const c = t.call_ref ? calls.get(t.call_ref) : null; return !!c && c.bought && c.owner !== t.profile_id; };

  const now = Date.now();
  const W = { d1: now - 864e5, d7: now - 7 * 864e5, d30: now - 30 * 864e5, d90: now - 90 * 864e5 };
  type Win = { vol: number; trades: number; traders: Set<string>; fee: number; potential: number; viaCallVol: number };
  const win = () => ({ vol: 0, trades: 0, traders: new Set<string>(), fee: 0, potential: 0, viaCallVol: 0 }) as Win;
  const wins: Record<keyof typeof W, Win> = { d1: win(), d7: win(), d30: win(), d90: win() };
  const days = new Map<string, { vol: number; fee: number; trades: number }>();
  const toks = new Map<string, { vol: number; trades: number }>();
  const users = new Map<string, { vol: number; trades: number; fee: number }>();
  const buckets = Object.fromEntries(BUCKETS.map((b) => [b.key, 0])) as Record<Bucket, number>;
  const projected = Object.fromEntries(BUCKETS.map((b) => [b.key, 0])) as Record<Bucket, number>;

  for (const t of txs) {
    const at = Date.parse(t.created_at), usd = Number(t.usd_value) || 0, fee = Number(t.fee_usd) || 0, vc = viaCall(t);
    const pot = (usd * FEE_BPS_STANDARD) / 10_000;
    for (const k of Object.keys(W) as (keyof typeof W)[]) {
      if (at < W[k]) continue;
      const w = wins[k]; w.vol += usd; w.trades++; w.traders.add(t.profile_id); w.fee += fee; w.potential += pot; if (vc) w.viaCallVol += usd;
    }
    if (at >= W.d30) {
      const day = t.created_at.slice(0, 10), d = days.get(day) || { vol: 0, fee: 0, trades: 0 };
      d.vol += usd; d.fee += fee; d.trades++; days.set(day, d);
      const s = split(fee, vc), p = split(pot, vc);
      for (const b of BUCKETS) { buckets[b.key] += s[b.key]; projected[b.key] += p[b.key]; }
      const mint = [t.out_mint, t.in_mint].find((m) => m && m !== SOL && m !== USDC) || t.out_mint || t.in_mint;
      if (mint) { const x = toks.get(mint) || { vol: 0, trades: 0 }; x.vol += usd; x.trades++; toks.set(mint, x); }
      const u = users.get(t.profile_id) || { vol: 0, trades: 0, fee: 0 }; u.vol += usd; u.trades++; u.fee += fee; users.set(t.profile_id, u);
    }
  }

  const topUsers = [...users.entries()].sort((x, y) => y[1].vol - x[1].vol).slice(0, 10);
  const { data: hs } = topUsers.length ? await db.from('profiles').select('id, handle, avatar_url').in('id', topUsers.map(([id]) => id)) : { data: [] };
  const H = new Map((hs || []).map((p) => [p.id as string, p]));
  const series: { day: string; vol: number; fee: number; trades: number }[] = [];
  for (let i = 29; i >= 0; i--) { const day = new Date(now - i * 864e5).toISOString().slice(0, 10); series.push({ day, ...(days.get(day) || { vol: 0, fee: 0, trades: 0 }) }); }
  const out = (w: Win) => ({ vol: w.vol, trades: w.trades, traders: w.traders.size, fee: w.fee, potential: w.potential, viaCallVol: w.viaCallVol, avg: w.trades ? w.vol / w.trades : 0 });

  return json({
    config: { liveBps: liveFeeBps(), standardBps: FEE_BPS_STANDARD, referral: process.env.JUPITER_REFERRAL_ACCOUNT || null, feeCols },
    windows: { d1: out(wins.d1), d7: out(wins.d7), d30: out(wins.d30), d90: out(wins.d90) },
    series,
    buckets: BUCKETS.map((b) => ({ ...b, earned: buckets[b.key], projected: projected[b.key] })),
    tokens: [...toks.entries()].sort((x, y) => y[1].vol - x[1].vol).slice(0, 10).map(([mint, v]) => ({ mint, ...v })),
    traders: topUsers.map(([id, v]) => ({ handle: (H.get(id)?.handle as string) || null, avatar_url: (H.get(id)?.avatar_url as string) || null, ...v })),
  });
}
