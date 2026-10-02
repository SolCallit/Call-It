import { NextResponse } from 'next/server';
import { requireMe, dbOrNull, json, isHandle, str } from '@/lib/db/me';
import { notifySocial } from '@/lib/notify/social';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GRAPH = { follow: 'follows', mute: 'mutes', block: 'blocks' } as const;

/**
 * POST /api/social
 *  { action: 'follow'|'mute'|'block', handle, on }           follow / mute / block a caller
 *  { action: 'watch', key, on }                              watchlist a token
 *  { action: 'bookmark', ref, on }                           bookmark a post
 *  { action: 'list_create', name }                           new list → { list }
 *  { action: 'list_member', list, handle, on }               add/remove a caller in a list
 *  { action: 'list_delete', list }                           delete a list
 */
export async function POST(req: Request) {
  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  const { db, me } = ctx;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const a = b.action;

  if (a === 'follow' || a === 'mute' || a === 'block') {
    if (!isHandle(b.handle) || b.handle === me.handle) return json({ error: 'invalid_handle' }, 400);
    const table = GRAPH[a], row = { profile_id: me.id, target_handle: b.handle };
    const r = b.on
      ? await db.from(table).upsert(row, { onConflict: 'profile_id,target_handle', ignoreDuplicates: true })
      : await db.from(table).delete().match(row);
    if (r.error) return json({ error: 'db_write', detail: r.error.message }, 500);
    // Blocking someone also unfollows them.
    if (a === 'block' && b.on) await db.from('follows').delete().match(row);
    if (a === 'follow' && b.on) await notifySocial(db, me, 'follows', { handle: b.handle });
    return json({ ok: true });
  }

  if (a === 'watch') {
    const key = typeof b.key === 'string' ? b.key.slice(0, 64) : '';
    if (!key) return json({ error: 'invalid_key' }, 400);
    const row = { profile_id: me.id, token_key: key };
    const r = b.on
      ? await db.from('watchlist').upsert(row, { onConflict: 'profile_id,token_key', ignoreDuplicates: true })
      : await db.from('watchlist').delete().match(row);
    if (r.error) return json({ error: 'db_write', detail: r.error.message }, 500);
    return json({ ok: true });
  }

  if (a === 'bookmark') {
    const ref = typeof b.ref === 'string' || typeof b.ref === 'number' ? String(b.ref).slice(0, 64) : '';
    if (!ref) return json({ error: 'invalid_ref' }, 400);
    const row = { profile_id: me.id, post_ref: ref };
    const r = b.on
      ? await db.from('bookmarks').upsert(row, { onConflict: 'profile_id,post_ref', ignoreDuplicates: true })
      : await db.from('bookmarks').delete().match(row);
    if (r.error) return json({ error: 'db_write', detail: r.error.message }, 500);
    return json({ ok: true });
  }

  if (a === 'list_create') {
    const name = str(b.name, 40);
    if (!name) return json({ error: 'Name your list.' }, 400);
    const { count } = await db.from('lists').select('id', { count: 'exact', head: true }).eq('profile_id', me.id);
    if ((count || 0) >= 20) return json({ error: 'You can have up to 20 lists.' }, 400);
    const { data, error } = await db.from('lists').insert({ profile_id: me.id, name }).select('id, name').single();
    if (error) return json({ error: /duplicate/.test(error.message) ? 'You already have a list with that name.' : 'db_write' }, 400);
    return json({ list: { ...data, members: [] } });
  }

  if (a === 'list_member' || a === 'list_delete') {
    const list = typeof b.list === 'string' ? b.list : '';
    const own = await db.from('lists').select('id').eq('id', list).eq('profile_id', me.id).maybeSingle();
    if (!own.data) return json({ error: 'not_found' }, 404);
    if (a === 'list_delete') {
      const r = await db.from('lists').delete().eq('id', list);
      return r.error ? json({ error: 'db_write' }, 500) : json({ ok: true });
    }
    if (!isHandle(b.handle)) return json({ error: 'invalid_handle' }, 400);
    const row = { list_id: list, target_handle: b.handle };
    const r = b.on
      ? await db.from('list_members').upsert(row, { onConflict: 'list_id,target_handle', ignoreDuplicates: true })
      : await db.from('list_members').delete().match(row);
    if (r.error) return json({ error: 'db_write', detail: r.error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: 'unknown_action' }, 400);
}

type Person = { handle: string; display_name: string | null; avatar_url: string | null };

/**
 * GET /api/social?followers=<handle>  people who follow <handle>
 * GET /api/social?following=<handle>  people <handle> follows
 * Public, newest first, up to 200. Handles without a Callit profile (demo callers) come back bare.
 */
export async function GET(req: Request) {
  const db = dbOrNull();
  if (!db) return json({ people: [] });
  const sp = new URL(req.url).searchParams;
  const followers = sp.get('followers'), following = sp.get('following');
  const h = followers || following;
  if (!isHandle(h)) return json({ error: 'invalid_handle' }, 400);
  const nocache = { headers: { 'cache-control': 'no-store' } };

  if (followers) {
    const { data, error } = await db.from('follows')
      .select('created_at, profiles!inner(handle, display_name, avatar_url)')
      .eq('target_handle', h).order('created_at', { ascending: false }).limit(200);
    if (error) return json({ error: 'db_read', detail: error.message }, 500);
    const people = (data || []).map((r: Record<string, unknown>) => r.profiles as Person).filter(Boolean);
    return NextResponseJson({ people }, nocache);
  }

  const p = await db.from('profiles').select('id').eq('handle', h).maybeSingle();
  if (!p.data) return NextResponseJson({ people: [] }, nocache);
  const { data, error } = await db.from('follows').select('target_handle, created_at')
    .eq('profile_id', p.data.id).order('created_at', { ascending: false }).limit(200);
  if (error) return json({ error: 'db_read', detail: error.message }, 500);
  const handles = (data || []).map((r: { target_handle: string }) => r.target_handle);
  const known: Record<string, Person> = {};
  if (handles.length) {
    const { data: ps } = await db.from('profiles').select('handle, display_name, avatar_url').in('handle', handles);
    (ps || []).forEach((x: Person) => (known[x.handle] = x));
  }
  const people = handles.map((x) => known[x] || { handle: x, display_name: null, avatar_url: null });
  return NextResponseJson({ people }, nocache);
}

const NextResponseJson = (body: unknown, init: ResponseInit) => NextResponse.json(body, init);
