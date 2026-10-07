import { NextResponse } from 'next/server';
import { requireMe, json } from '@/lib/db/me';
import { claim, isPaused, payoutIssue, resolvePending } from '@/lib/payouts/payout';
import { PAYOUT, CALLER_NOBUY, CALLER_BASE, CALLER_CAP, CALLER_MIN_X } from '@/lib/fees/model';

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

  const [e, c] = await Promise.all([
    db.from('earnings').select('usd, claim_id, bought_in, share_pct, created_at, call_id, posts(token_sym, mint)').eq('profile_id', me.id).order('created_at', { ascending: false }).limit(500),
    db.from('claims').select('id, usd, lamports, signature, status, created_at').eq('profile_id', me.id).order('created_at', { ascending: false }).limit(20),
  ]);
  if (e.error) return json({ ready: false, reason: 'Earnings aren’t set up on the server yet (migration 0010).' });

  type E = { usd: number; claim_id: string | null; bought_in: boolean; share_pct: number; created_at: string; call_id: string | null; posts: { token_sym: string | null; mint: string | null } | null };
  const rows = (e.data || []) as unknown as E[];
  const claims = (c.data || []) as { id: string; usd: number; lamports: number | null; signature: string | null; status: string; created_at: string }[];
  const pendingIds = new Set(claims.filter((x) => x.status === 'pending').map((x) => x.id));
  const available = rows.filter((r) => !r.claim_id).reduce((s, r) => s + Number(r.usd), 0);
  const processing = rows.filter((r) => r.claim_id && pendingIds.has(r.claim_id)).reduce((s, r) => s + Number(r.usd), 0);
  const paid = claims.filter((x) => x.status === 'sent').reduce((s, x) => s + Number(x.usd), 0);

  // Per call: what each call has earned so far.
  const by: Record<string, { call_id: string; sym: string | null; mint: string | null; usd: number; buys: number; bought_in: boolean; share: number }> = {};
  for (const r of rows) {
    if (!r.call_id) continue;
    const k = (by[r.call_id] ||= { call_id: r.call_id, sym: r.posts?.token_sym ?? null, mint: r.posts?.mint ?? null, usd: 0, buys: 0, bought_in: r.bought_in, share: Number(r.share_pct) });
    k.usd += Number(r.usd); k.buys++;
  }

  const issue = await payoutIssue(await isPaused(db));
  return json({
    ready: true, available, processing, paid, total: available + processing + paid,
    calls: Object.values(by).sort((x, y) => y.usd - x.usd).slice(0, 20),
    claims: claims.map((x) => ({ ...x, sol: x.lamports ? Number(x.lamports) / 1e9 : null })),
    claimOpen: !issue, minUsd: PAYOUT.minUsd(), maxUsd: PAYOUT.maxPerClaimUsd(),
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
