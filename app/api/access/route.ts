import { NextResponse } from 'next/server';
import { verifyPrivyToken } from '@/lib/auth/privy-server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { gateOn } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'cache-control': 'no-store' } });

function isAdmin(p: { handle: string; wallet_address: string | null }) {
  const handles = (process.env.ADMIN_HANDLES || '').toLowerCase().split(',').map((x) => x.trim().replace(/^@/, '')).filter(Boolean);
  const wallets = (process.env.ADMIN_WALLETS || '').split(',').map((x) => x.trim()).filter(Boolean);
  return wallets.length ? !!p.wallet_address && wallets.includes(p.wallet_address) : handles.includes(p.handle.toLowerCase());
}

async function load(req: Request) {
  const pid = await verifyPrivyToken(req);
  const db = supabaseAdmin();
  if (!pid || !db) return { db, p: null as null | { id: string; handle: string; wallet_address: string | null; access_at: string | null } };
  const { data } = await db.from('profiles').select('id, handle, wallet_address, access_at').eq('privy_id', pid).maybeSingle();
  return { db, p: data };
}

/** GET /api/access — is the app invite-only, and has this account unlocked it? */
export async function GET(req: Request) {
  if (!gateOn()) return json({ gate: false, granted: true });
  const { p } = await load(req);
  if (!p) return json({ gate: true, granted: false, signedIn: false });
  return json({ gate: true, granted: !!p.access_at || isAdmin(p), signedIn: true });
}

const MSG: Record<string, string> = {
  invalid: 'That code isn’t valid. Check it and try again.',
  used_up: 'That code has already been used.',
  expired: 'That code has expired.',
};
const tries = new Map<string, number[]>();

/** POST /api/access { code } — unlocks the app for the signed-in account. */
export async function POST(req: Request) {
  if (!gateOn()) return json({ ok: true });
  const { db, p } = await load(req);
  if (!db) return json({ error: 'Unavailable right now. Try again.' }, 503);
  if (!p) return json({ error: 'Sign in first, then enter your code.' }, 401);
  // Already in (or an admin): nothing is redeemed, so the code stays free for someone else.
  if (p.access_at || isAdmin(p)) return json({ ok: true, already: true });
  const now = Date.now(), t = (tries.get(p.id) || []).filter((x) => now - x < 600_000);
  if (t.length >= 8) return json({ error: 'Too many tries. Wait 10 minutes.' }, 429);
  tries.set(p.id, [...t, now]);
  const b = (await req.json().catch(() => ({}))) as { code?: unknown };
  const code = String(b.code || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 40);
  if (code.length < 4) return json({ error: MSG.invalid }, 400);
  const { data, error } = await db.rpc('redeem_access_code', { p_profile: p.id, p_code: code });
  if (error) return json({ error: 'Couldn’t check the code. Try again.' }, 500);
  if (data === 'ok') return json({ ok: true });
  if (data === 'already') return json({ ok: true, already: true });
  return json({ error: MSG[String(data)] || MSG.invalid }, 400);
}
