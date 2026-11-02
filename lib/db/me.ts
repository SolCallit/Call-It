import 'server-only';
import { gateOn, openPath } from '@/lib/access';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyPrivyToken } from '@/lib/auth/privy-server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export type Me = { id: string; handle: string; wallet_address: string | null };
export type Authed = { db: SupabaseClient; me: Me };

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

/** Database client or null (callers return 503). */
export const dbOrNull = () => supabaseAdmin();

/**
 * Verifies the Privy token and loads the caller's profile row.
 * Returns the context, or a ready-to-return error response.
 */
export async function requireMe(req: Request): Promise<Authed | NextResponse> {
  const privyId = await verifyPrivyToken(req);
  if (!privyId) return json({ error: 'unauthorized' }, 401);
  const db = supabaseAdmin();
  if (!db) return json({ error: 'database_not_configured' }, 503);
  const gate = gateOn();
  const { data, error } = await db.from('profiles').select(gate ? 'id, handle, wallet_address, access_at' : 'id, handle, wallet_address').eq('privy_id', privyId).maybeSingle();
  if (error) return json({ error: 'db_read', detail: error.message }, 500);
  if (!data) return json({ error: 'no_profile' }, 404);
  const row = data as unknown as Me & { access_at?: string | null };
  // Invite-only: writes need an unlocked account (admins always pass).
  if (gate && !row.access_at && req.method !== 'GET' && !openPath(req.url) && !isAdminRow(row)) {
    return json({ error: 'access_required' }, 403);
  }
  return { db, me: { id: row.id, handle: row.handle, wallet_address: row.wallet_address } };
}

/** Same rule as requireAdmin: ADMIN_WALLETS when set, otherwise ADMIN_HANDLES. */
function isAdminRow(r: { handle: string; wallet_address: string | null }) {
  const handles = (process.env.ADMIN_HANDLES || '').toLowerCase().split(',').map((x) => x.trim().replace(/^@/, '')).filter(Boolean);
  const wallets = (process.env.ADMIN_WALLETS || '').split(',').map((x) => x.trim()).filter(Boolean);
  return wallets.length ? !!r.wallet_address && wallets.includes(r.wallet_address) : handles.includes(String(r.handle).toLowerCase());
}

/** Optional auth: returns the profile when a valid token is present, otherwise null. */
export async function maybeMe(req: Request): Promise<Me | null> {
  if (!req.headers.get('authorization')) return null;
  const r = await requireMe(req);
  return r instanceof NextResponse ? null : r.me;
}

export const isHandle = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_]{1,30}$/.test(s);
export const isMint = (s: unknown): s is string => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
export const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : null);
export const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Only images we host ourselves may be attached to posts/profiles. */
export function ownMediaUrl(u: unknown): u is string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (typeof u !== 'string' || u.length >= 400) return false;
  // GIFs picked from GIF search are served by Tenor / GIPHY.
  if (/^https:\/\/(media\d*\.tenor\.com|media\d*\.giphy\.com|i\.giphy\.com)\/[^\s"'<>]+$/.test(u)) return true;
  return !!base && u.startsWith(`${base}/storage/v1/object/public/media/`);
}
