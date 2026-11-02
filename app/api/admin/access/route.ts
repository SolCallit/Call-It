import { NextResponse } from 'next/server';
import { randomInt } from 'crypto';
import { json } from '@/lib/db/me';
import { requireAdmin } from '@/lib/db/admin';
import { gateOn } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const part = () => Array.from({ length: 4 }, () => A[randomInt(A.length)]).join('');

/** GET /api/admin/access — access codes and how many people unlocked the app. */
export async function GET(req: Request) {
  const a = await requireAdmin(req);
  if (a instanceof NextResponse) return a;
  const [codes, unlocked, waiting] = await Promise.all([
    a.db.from('access_codes').select('code, max_uses, uses, note, expires_at, created_at').order('created_at', { ascending: false }).limit(300),
    a.db.from('profiles').select('id', { count: 'exact', head: true }).not('access_at', 'is', null),
    a.db.from('profiles').select('id', { count: 'exact', head: true }).is('access_at', null),
  ]);
  if (codes.error) return json({ gate: gateOn(), migration: false, codes: [] });
  return json({ gate: gateOn(), migration: true, codes: codes.data, unlocked: unlocked.count || 0, waiting: waiting.count || 0 });
}

/** POST /api/admin/access { count, uses, note, code? } — makes new codes (a custom code when `code` is given). */
export async function POST(req: Request) {
  const a = await requireAdmin(req);
  if (a instanceof NextResponse) return a;
  const b = (await req.json().catch(() => ({}))) as { count?: number; uses?: number; note?: string; code?: string };
  const uses = Math.min(100000, Math.max(1, Math.floor(Number(b.uses) || 1)));
  const custom = String(b.code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);
  const count = custom ? 1 : Math.min(100, Math.max(1, Math.floor(Number(b.count) || 10)));
  const rows = Array.from({ length: count }, () => ({ code: custom || `CALL-${part()}-${part()}`, max_uses: uses, note: String(b.note || '').slice(0, 80) || null, created_by: a.me.id }));
  const { data, error } = await a.db.from('access_codes').insert(rows).select('code, max_uses, uses');
  if (error) return json({ error: error.code === '23505' ? 'That code already exists.' : error.message }, 400);
  return json({ codes: data });
}
