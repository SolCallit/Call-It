import { NextResponse } from 'next/server';
import { requireMe, json } from '@/lib/db/me';
import { claim, isPaused, payoutIssue, resolvePending } from '@/lib/payouts/payout';
import { PAYOUT, CALLER_NOBUY, CALLER_BASE, CALLER_CAP, CALLER_MIN_X, CASHBACK_PCT, cashbackMinPoints } from '@/lib/fees/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/earnings — the signed-in caller's earnings, claims and whether Claim is open. */
export async function GET(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  const { db, me } = a;

  const { data: pend } = await db.from('claims').select('id, signature, created_at, status').eq('profile_id', me.id).eq('status', 'pending').maybeSingle();
  if (pend) await resolvePending(db, pend);

  const [e, c, pt] = await Promise.all([
    db.from('earnings').select('usd, claim_id, kind, bought_in, share_pct, created_at, call_id, posts(token_sym, mint, target_at, target_mc, entry_mc)').eq('profile_id', me.id).order('created_at', { ascending: false }).limit(1000),
    db.from('claims').select('id, usd, lamports, signature, status, created_at').eq('profile_id', me.id).order('created_at', { ascending: false }).limit(20),
    db.rpc('points_of', { p: me.id }),
  ]);
  if (e.error) return json({ ready: false, reason: 'Earnings aren’t set up on the server yet (run migration 0015).' });

  type E = { usd: number; claim_id: string | null; kind?: string; bought_in: boolean; share_pct: number; created_at: string; call_id: string | null;
    posts: { token_sym: string | null; mint: string | null; target_at: string | null; target_mc: number | null; entry_mc: number | null } | null };
  const all = (e.data || []) as unknown as E[];
  const claims = (c.data || []) as { id: string; usd: number; lamports: number | null; signature: string | null; status: string; created_at: string }[];
  const points = Number(pt.data) || 0, needPts = cashbackMinPoints(), cbOpen = points >= needPts;
  const pendingIds = new Set(claims.filter((x) => x.status === 'pending').map((x) => x.id));
  // Mirrors earning_ready() in SQL: caller money unlocks when the call hits its target (or 2X with no target).
  const hitTarget = (r: E) => !r.posts || !!r.posts.target_at || !(Number(r.posts.target_mc) > 0) || !(Number(r.posts.entry_mc) > 0);
  const rows = all.filter((r) => (r.kind || 'caller') === 'caller');
  const cb = all.filter((r) => r.kind === 'cashback');
  const sum = (l: E[]) => l.reduce((a, r) => a + Number(r.usd), 0);
  const unclaimed = rows.filter((r) => !r.claim_id);
  const cbUnclaimed = sum(cb.filter((r) => !r.claim_id));
  const available = sum(unclaimed.filter(hitTarget)) + (cbOpen ? cbUnclaimed : 0);
  const waiting = sum(unclaimed.filter((r) => !hitTarget(r)));
  const processing = sum(all.filter((r) => r.claim_id && pendingIds.has(r.claim_id)));
  const paid = claims.filter((x) => x.status === 'sent').reduce((s, x) => s + Number(x.usd), 0);

  // Per call: what each call has earned so far.
  const by: Record<string, { call_id: string; sym: string | null; mint: string | null; usd: number; buys: number; bought_in: boolean; share: number; locked: boolean }> = {};
  for (const r of rows) {
    if (!r.call_id) continue;
    const k = (by[r.call_id] ||= { call_id: r.call_id, sym: r.posts?.token_sym ?? null, mint: r.posts?.mint ?? null, usd: 0, buys: 0, bought_in: r.bought_in, share: Number(r.share_pct), locked: !hitTarget(r) });
    k.usd += Number(r.usd); k.buys++;
  }

  const issue = await payoutIssue(await isPaused(db));
  return json({
    ready: true, available, waiting, processing, paid, total: available + waiting + processing + paid + (cbOpen ? 0 : cbUnclaimed),
    cashback: { usd: cbUnclaimed, open: cbOpen, points, need: needPts, pct: CASHBACK_PCT, earned: sum(cb) },
    calls: Object.values(by).sort((x, y) => y.usd - x.usd).slice(0, 20),
    claims: claims.map((x) => ({ ...x, sol: x.lamports ? Number(x.lamports) / 1e9 : null })),
    claimOpen: !issue, autoPay: process.env.AUTO_PAYOUTS === '1', minUsd: PAYOUT.minUsd(), maxUsd: Number.isFinite(PAYOUT.maxPerClaimUsd()) ? PAYOUT.maxPerClaimUsd() : null,
    rules: { minX: CALLER_MIN_X, boughtIn: [CALLER_BASE, CALLER_CAP], noBuy: CALLER_NOBUY },
  });
}

/** POST /api/earnings — claim: pays unclaimed earnings in SOL to the user's Callit wallet. */
export async function POST(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  const r = await claim(a.db, a.me);
  if (!r.ok) return json({ error: r.error }, r.status || 400);
  return json(r);
}
