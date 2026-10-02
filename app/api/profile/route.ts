import { NextResponse } from 'next/server';
import { verifyPrivyToken } from '@/lib/auth/privy-server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ownMediaUrl, isHandle } from '@/lib/db/me';
import { HANDLE_RE } from '@/lib/auth/handle';

/** Names nobody can take: they'd look like Callit staff or collide with app routes. */
const RESERVED = new Set(['callit', 'admin', 'support', 'help', 'official', 'team', 'staff', 'mod', 'moderator', 'system', 'root', 'api', 'home', 'market', 'profile', 'settings', 'wallet', 'swap', 'stake', 'premium', 'bookmarks', 'notifications', 'null', 'undefined']);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) || null : undefined);

/** Updates the signed-in user's own profile text fields. */
export async function PATCH(req: Request) {
  const privyId = await verifyPrivyToken(req);
  if (!privyId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, string | null> = {};
  const f: [string, number][] = [['display_name', 40], ['bio', 160], ['website', 80], ['x_handle', 30]];
  for (const [k, max] of f) {
    const v = clean(body[k], max);
    if (v !== undefined) patch[k] = k === 'x_handle' && v ? v.replace(/^@/, '') : v;
  }
  for (const k of ['avatar_url', 'banner_url']) {
    if (body[k] === null || body[k] === '') patch[k] = null;
    else if (body[k] !== undefined) {
      if (!ownMediaUrl(body[k])) return NextResponse.json({ error: 'invalid_image' }, { status: 400 });
      patch[k] = body[k] as string;
    }
  }
  if (patch.website && !/^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(patch.website)) {
    return NextResponse.json({ error: 'invalid_website' }, { status: 400 });
  }
  // Username (@handle): 3–20 chars, a–z 0–9 _, unique. Follows etc. move with it (migration 0005 trigger).
  if (body.handle !== undefined) {
    const h = typeof body.handle === 'string' ? body.handle.trim().replace(/^@/, '').toLowerCase() : '';
    if (!HANDLE_RE.test(h)) return NextResponse.json({ error: 'Usernames are 3–20 characters: letters, numbers and _ only.' }, { status: 400 });
    if (RESERVED.has(h)) return NextResponse.json({ error: 'That username is reserved. Try another.' }, { status: 400 });
    const cur = await db.from('profiles').select('handle').eq('privy_id', privyId).maybeSingle();
    if (cur.data && cur.data.handle !== h) {
      const taken = await db.from('profiles').select('id').eq('handle', h).maybeSingle();
      if (taken.data) return NextResponse.json({ error: `@${h} is taken. Try another.` }, { status: 409 });
      patch.handle = h;
    }
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });

  const { data, error } = await db.from('profiles').update(patch).eq('privy_id', privyId).select('*').single();
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'That username was just taken. Try another.' }, { status: 409 });
    return NextResponse.json({ error: 'db_write', detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ profile: data });
}

/**
 * GET /api/profile?handle=<h> — a public profile with follower and post counts.
 * GET /api/profile?check=<h> — is this username free? { available, reason? }
 */
export async function GET(req: Request) {
  const db = supabaseAdmin();
  const sp = new URL(req.url).searchParams;
  const check = sp.get('check');
  if (check !== null) {
    const h = check.trim().replace(/^@/, '').toLowerCase();
    if (!HANDLE_RE.test(h)) return NextResponse.json({ available: false, reason: '3–20 characters: letters, numbers and _' });
    if (RESERVED.has(h)) return NextResponse.json({ available: false, reason: 'Reserved' });
    if (!db) return NextResponse.json({ available: true });
    const { data } = await db.from('profiles').select('id').eq('handle', h).maybeSingle();
    return NextResponse.json({ available: !data, reason: data ? 'Taken' : undefined }, { headers: { 'cache-control': 'no-store' } });
  }
  const handle = sp.get('handle');
  if (!db) return NextResponse.json({ profile: null });
  if (!isHandle(handle)) return NextResponse.json({ error: 'invalid_handle' }, { status: 400 });
  const { data, error } = await db.from('profiles')
    .select('id, handle, display_name, bio, website, x_handle, avatar_url, banner_url, created_at').eq('handle', handle).maybeSingle();
  if (error) return NextResponse.json({ error: 'db_read' }, { status: 500 });
  if (!data) return NextResponse.json({ profile: null }, { status: 404 });
  const [fr, fg, ps] = await Promise.all([
    db.from('follows').select('profile_id', { count: 'exact' }).eq('target_handle', handle).limit(1),
    db.from('follows').select('target_handle', { count: 'exact' }).eq('profile_id', data.id).limit(1),
    db.from('posts').select('id', { count: 'exact' }).eq('profile_id', data.id).is('deleted_at', null).limit(1),
  ]);
  const { id: _id, ...pub } = data;
  return NextResponse.json(
    { profile: { ...pub, followers: fr.count || 0, following: fg.count || 0, posts: ps.count || 0 } },
    // Counts change the moment someone follows: never serve a stale copy from the CDN.
    { headers: { 'cache-control': 'no-store' } },
  );
}
