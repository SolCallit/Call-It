import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/db/admin';
import { json } from '@/lib/db/me';
import { isPaused, paidLast24h, payoutIssue, payoutSigner, resolvePending, solPrice, walletLamports } from '@/lib/payouts/payout';
import { PAYOUT } from '@/lib/fees/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/admin/payouts — payout wallet, what callers are owed, recent claims. */
export async function GET(req: Request) {
  const a = await requireAdmin(req);
  if (a instanceof NextResponse) return a;
  const { db } = a;

  const owedQ = await db.from('earnings').select('usd').is('claim_id', null).limit(20000);
  if (owedQ.error) return json({ ready: false, reason: 'Run migration 0010 in Supabase to turn on caller earnings.' });
  const owed = (owedQ.data || []).reduce((s: number, r: { usd: number }) => s + Number(r.usd), 0);

  const { data: claims } = await db.from('claims').select('id, usd, lamports, signature, status, error, created_at, profiles(handle)').order('created_at', { ascending: false }).limit(40);
  for (const c of (claims || []) as { id: string; signature: string | null; created_at: string; status: string }[]) {
    if (c.status === 'pending') c.status = await resolvePending(db, c);
  }
  const paused = await isPaused(db);
  const signer = await payoutSigner();
  let sol: number | null = null;
  if (signer) sol = Number(await walletLamports(signer.address).catch(() => 0n)) / 1e9;
  const price = await solPrice();
  const since = new Date(Date.now() - 864e5).toISOString();
  const { data: e24 } = await db.from('earnings').select('usd').gte('created_at', since);

  return json({
    ready: true, paused, issue: await payoutIssue(paused), switchOn: process.env.PAYOUTS_ON === '1',
    wallet: signer?.address ?? null, sol, solUsd: sol != null && price ? sol * price : null,
    owed, earned24h: (e24 || []).reduce((s: number, r: { usd: number }) => s + Number(r.usd), 0),
    paid24h: await paidLast24h(db), dailyCap: Number.isFinite(PAYOUT.dailyCapUsd()) ? PAYOUT.dailyCapUsd() : null, minUsd: PAYOUT.minUsd(), maxClaim: Number.isFinite(PAYOUT.maxPerClaimUsd()) ? PAYOUT.maxPerClaimUsd() : null,
    claims: (claims || []).map((c) => {
      const x = c as unknown as { profiles: { handle: string } | null; lamports: number | null } & Record<string, unknown>;
      return { ...x, handle: x.profiles?.handle ?? null, sol: x.lamports ? Number(x.lamports) / 1e9 : null, profiles: undefined };
    }),
  });
}

/** POST /api/admin/payouts { action: 'pause' | 'resume' } — the emergency stop for claims. */
export async function POST(req: Request) {
  const a = await requireAdmin(req);
  if (a instanceof NextResponse) return a;
  const b = (await req.json().catch(() => ({}))) as { action?: string };
  if (b.action !== 'pause' && b.action !== 'resume') return json({ error: 'invalid_action' }, 400);
  const { error } = await a.db.from('app_kv').upsert({ k: 'payouts_paused', v: b.action === 'pause' ? '1' : '0', updated_at: new Date().toISOString() });
  if (error) return json({ error: 'db_write', detail: error.message }, 500);
  return json({ ok: true, paused: b.action === 'pause' });
}
