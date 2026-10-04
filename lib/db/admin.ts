import 'server-only';
import { NextResponse } from 'next/server';
import { requireMe, json, type Authed } from '@/lib/db/me';

/** Signed-in admin (ADMIN_HANDLES / ADMIN_WALLETS env vars, comma separated) or a ready error response. */
export async function requireAdmin(req: Request): Promise<Authed | NextResponse> {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  const handles = (process.env.ADMIN_HANDLES || '').toLowerCase().split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean);
  const wallets = (process.env.ADMIN_WALLETS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!handles.length && !wallets.length) return json({ error: 'Admin access isn’t set up yet' }, 403);
  const ok = handles.includes(a.me.handle.toLowerCase()) || (!!a.me.wallet_address && wallets.includes(a.me.wallet_address));
  if (!ok) return json({ error: 'This account isn’t an admin' }, 403);
  return a;
}
