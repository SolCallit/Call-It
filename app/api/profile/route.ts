import { NextResponse } from 'next/server';
import { verifyPrivyToken } from '@/lib/auth/privy-server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ownMediaUrl, isHandle } from '@/lib/db/me';

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
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });

  const { data, error } = await db.from('profiles').update(patch).eq('privy_id', privyId).select('*').single();
  if (error) return NextResponse.json({ error: 'db_write', detail: error.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}

/** GET /api/profile?handle=<h> — a public profile with follower and post counts. */
export async function GET(req: Request) {
  const db = supabaseAdmin();
  const handle = new URL(req.url).searchParams.get('handle');
  if (!db) return NextResponse.json({ profile: null });
  if (!isHandle(handle)) return NextResponse.json({ error: 'invalid_handle' }, { status: 400 });
  const { data, error } = await db.from('profiles')
    .select('id, handle, display_name, bio, website, x_handle, avatar_url, banner_url, created_at').eq('handle', handle).maybeSingle();
  if (error) return NextResponse.json({ error: 'db_read' }, { status: 500 });
  if (!data) return NextResponse.json({ profile: null }, { status: 404 });
  const [fr, fg, ps] = await Promise.all([
    db.from('follows').select('profile_id', { count: 'exact', head: true }).eq('target_handle', handle),
    db.from('follows').select('target_handle', { count: 'exact', head: true }).eq('profile_id', data.id),
    db.from('posts').select('id', { count: 'exact', head: true }).eq('profile_id', data.id).is('deleted_at', null),
  ]);
  const { id: _id, ...pub } = data;
  return NextResponse.json(
    { profile: { ...pub, followers: fr.count || 0, following: fg.count || 0, posts: ps.count || 0 } },
    { headers: { 'cache-control': 'public, s-maxage=15, stale-while-revalidate=60' } },
  );
}
