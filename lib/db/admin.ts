import 'server-only';
import { NextResponse } from 'next/server';
import { requireMe, json, type Authed } from '@/lib/db/me';

/** Handles listed in ADMIN_HANDLES: nobody else may rename into them. */
export const adminHandles = () => (process.env.ADMIN_HANDLES || '').toLowerCase().split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean);

/** Signed-in admin (ADMIN_HANDLES / ADMIN_WALLETS env vars, comma separated) or a ready error response. */
export async function requireAdmin(req: Request): Promise<Authed | NextResponse> {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  const handles = (process.env.ADMIN_HANDLES || '').toLowerCase().split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean);
  const wallets = (process.env.ADMIN_WALLETS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!handles.length && !wallets.length) return json({ error: 'Admin access isn’t set up yet' }, 403);
  /* Wallets can't be renamed into, so when ADMIN_WALLETS is set it is the only key. Handles are a
     fallback for setup; profile edits refuse to take an admin handle (see /api/profile). */
  const ok = wallets.length
    ? !!a.me.wallet_address && wallets.includes(a.me.wallet_address)
    : handles.includes(a.me.handle.toLowerCase());
  if (!ok) return json({ error: 'This account isn’t an admin' }, 403);
  return a;
}
