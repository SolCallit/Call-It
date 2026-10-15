import { NextResponse } from 'next/server';
import { dbOrNull } from '@/lib/db/me';
import { BUCKETS, JUP_CUT, liveFeeBps, split, type Bucket, type Mode } from '@/lib/fees/model';
import { payoutSigner, solPrice, walletLamports } from '@/lib/payouts/payout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TRADES = ['buy', 'sell', 'swap'];
const ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const addr = (v?: string) => { const s = (v || '').trim(); return ADDR.test(s) ? s : null; };
type Tx = { profile_id: string; kind: string; usd_value: number | null; fee_usd: number | null; call_ref: string | null; created_at: string };

/**
 * GET /api/transparency — public, no sign-in. Everything here comes from verified on-chain trades
 * recorded by Callit, the earnings ledger and live wallet balances, so anyone can check where fees go.
 * Cached for 2 minutes.
 */
export async function GET() {
  const db = dbOrNull();
  if (!db) return NextResponse.json({ ready: false });

  // Verified trades (paged so totals stay right as volume grows).
  const txs: Tx[] = [];
  for (let from = 0; from < 200_000; from += 10_000) {
    const { data, error } = await db.from('transactions').select('profile_id, kind, usd_value, fee_usd, call_ref, created_at')
      .in('kind', TRADES).eq('verified', true).order('created_at', { ascending: false }).range(from, from + 9_999);
    if (error) return NextResponse.json({ ready: false, reason: 'db_read' }, { status: 500 });
    txs.push(...((data || []) as Tx[]));
    if (!data || data.length < 10_000) break;
  }
  const refs = [...new Set(txs.map((t) => t.call_ref).filter((r): r is string => !!r && /^[0-9a-f-]{36}$/i.test(r)))];
  const owners = new Map<string, string>();
  for (let i = 0; i < refs.length; i += 500) {
    const { data } = await db.from('posts').select('id, profile_id').in('id', refs.slice(i, i + 500));
    (data || []).forEach((p) => owners.set(p.id as string, p.profile_id as string));
  }
  const mode = (t: Tx): Mode => t.kind === 'sell' ? 'sell' : t.kind === 'buy' && t.call_ref && owners.has(t.call_ref) && owners.get(t.call_ref) !== t.profile_id ? 'call' : 'buy';

  const d30 = Date.now() - 30 * 864e5, d1 = Date.now() - 864e5; // d1 used for the ledger below too
  const tot = { vol: 0, trades: 0, fees: 0, vol30: 0, fees30: 0, vol24: 0, fees24: 0, trades24: 0, viaCalls: 0 };
  const traders24 = new Set<string>();
  const traders = new Set<string>();
  const alloc = Object.fromEntries(BUCKETS.map((b) => [b.key, 0])) as Record<Bucket, number>;
  for (const t of txs) {
    const usd = Number(t.usd_value) || 0, net = (Number(t.fee_usd) || 0) * (1 - JUP_CUT), at = Date.parse(t.created_at), m = mode(t);
    tot.vol += usd; tot.trades++; tot.fees += net; traders.add(t.profile_id);
    if (m === 'call') tot.viaCalls += usd;
    if (at >= d30) { tot.vol30 += usd; tot.fees30 += net; }
    if (at >= d1) { tot.vol24 += usd; tot.fees24 += net; tot.trades24++; traders24.add(t.profile_id); }
    const s = split(net, m);
    for (const b of BUCKETS) alloc[b.key] += s[b.key];
  }

  // What was actually earned and paid, from the ledger (not the model).
  const { data: earn } = await db.from('earnings').select('usd, kind, claim_id').limit(200_000);
  const { data: sent } = await db.from('claims').select('id, usd, created_at').eq('status', 'sent').limit(200_000);
  const sentIds = new Set((sent || []).map((c) => c.id as string));
  const sent24 = new Set((sent || []).filter((c) => Date.parse(c.created_at as string) >= d1).map((c) => c.id as string));
  const led = { callerEarned: 0, cashbackEarned: 0, callerPaid: 0, cashbackPaid: 0, owed: 0, callerPaid24: 0, cashbackPaid24: 0 };
  for (const e of (earn || []) as { usd: number; kind?: string; claim_id: string | null }[]) {
    const v = Number(e.usd), cb = e.kind === 'cashback', paid = !!e.claim_id && sentIds.has(e.claim_id);
    const p24 = !!e.claim_id && sent24.has(e.claim_id);
    if (cb) { led.cashbackEarned += v; if (paid) led.cashbackPaid += v; if (p24) led.cashbackPaid24 += v; }
    else { led.callerEarned += v; if (paid) led.callerPaid += v; if (p24) led.callerPaid24 += v; }
    if (!e.claim_id) led.owed += v;
  }
  const { count: payees } = await db.from('claims').select('profile_id', { count: 'exact', head: true }).eq('status', 'sent');

  // Public wallets. Addresses only: no keys ever leave the server.
  const price = await solPrice().catch(() => null);
  const bal = async (a: string | null) => (a ? Number(await walletLamports(a).catch(() => 0n)) / 1e9 : null);
  const payout = (await payoutSigner())?.address ?? null;
  const treasury = addr(process.env.TREASURY_WALLET), buyback = addr(process.env.BUYBACK_WALLET), referral = addr(process.env.JUPITER_REFERRAL_ACCOUNT);
  const [pb, tb, bb] = await Promise.all([bal(payout), bal(treasury), bal(buyback)]);
  const w = (key: string, label: string, address: string | null, sol: number | null, note: string) =>
    ({ key, label, address, sol, usd: sol != null && price ? sol * price : null, note });

  return NextResponse.json({
    ready: true, updatedAt: new Date().toISOString(), feeBps: liveFeeBps(), jupCut: JUP_CUT,
    volume: { all: tot.vol, d30: tot.vol30, d24: tot.vol24, viaCalls: tot.viaCalls, trades: tot.trades, traders: traders.size, trades24: tot.trades24, traders24: traders24.size },
    fees: { all: tot.fees, d30: tot.fees30, d24: tot.fees24 },
    split: BUCKETS.map((b) => ({ key: b.key, label: b.label, note: b.note, pct: { call: b.call, buy: b.buy, sell: b.sell }, usd: alloc[b.key] })),
    paid: { ...led, total: led.callerPaid + led.cashbackPaid, payouts: payees || 0 },
    wallets: [
      w('payout', 'Payout wallet', payout, pb, 'Hot wallet that pays callers and cashback automatically'),
      w('treasury', 'Treasury', treasury, tb, 'Team, infrastructure and growth. Signed by the team only'),
      w('buyback', 'Buyback & burn', buyback, bb, '$CALLIT buyback and burn, after launch'),
      w('referral', 'Fee collector (Jupiter referral)', referral, null, 'Where trading fees land on-chain before they are split'),
    ],
  }, { headers: { 'cache-control': 'public, s-maxage=120, stale-while-revalidate=600' } });
}
