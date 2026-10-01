import { NextResponse } from 'next/server';
import { verifyPrivyToken } from '@/lib/auth/privy-server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function me(req: Request) {
  const privyId = await verifyPrivyToken(req);
  if (!privyId) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  const db = supabaseAdmin();
  if (!db) return { error: NextResponse.json({ notifications: [] }) };
  const p = await db.from('profiles').select('id').eq('privy_id', privyId).maybeSingle();
  if (p.error || !p.data) return { error: NextResponse.json({ notifications: [] }) };
  return { db, profileId: p.data.id as string };
}

/** The signed-in user's latest notifications, newest first. */
export async function GET(req: Request) {
  const r = await me(req);
  if ('error' in r) return r.error;
  const { data, error } = await r.db
    .from('notifications')
    .select('id, kind, title, body, link, read_at, created_at')
    .eq('profile_id', r.profileId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.error('[notifications] read failed:', error.message);
    return NextResponse.json({ notifications: [] });
  }
  return NextResponse.json({ notifications: data });
}

/** Mark notifications read. Body: { ids: string[] } or { all: true }. */
export async function POST(req: Request) {
  const r = await me(req);
  if ('error' in r) return r.error;
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown; all?: unknown };
  let q = r.db.from('notifications').update({ read_at: new Date().toISOString() }).eq('profile_id', r.profileId).is('read_at', null);
  if (body.all !== true) {
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 100) : [];
    if (!ids.length) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });
    q = q.in('id', ids);
  }
  const { error } = await q;
  if (error) return NextResponse.json({ error: 'db_write' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
