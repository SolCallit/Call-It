import { NextResponse } from 'next/server';
import { requireMe, dbOrNull, json, isHandle, isMint, str, ownMediaUrl } from '@/lib/db/me';
import { chatKeyReady } from '@/lib/chat/crypto';
import { addMember, bodyOf, CHAT_COLS, getChat, isCode, isUuid, markDelivered, memberOf, newInvite, systemMsg, type ChatRow, type Kind } from '@/lib/chat/store';
import { ringTopic } from '@/lib/chat/ring';
import { cleanBody } from '@/lib/chat/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const nocache = { headers: { 'cache-control': 'no-store' } };

type InboxRow = {
  id: string; kind: Kind; title: string | null; about: string | null; avatar_url: string | null; mint: string | null; invite_code: string | null;
  role: string; muted: boolean; member_count: number; last_read_id: number;
  last_id: number | null; last_body: string | null; last_enc: boolean | null; last_kind: string | null; last_at: string; last_handle: string | null;
  unread: number; peer_handle: string | null; peer_name: string | null; peer_avatar: string | null;
};

const pub = (c: ChatRow) => ({ id: c.id, kind: c.kind, title: c.title, about: c.about, avatar: c.avatar_url, mint: c.mint, members: c.member_count, lastAt: c.last_at, invite: c.kind === 'public' ? c.invite_code : null });

/**
 * GET /api/chat                 your inbox (DMs, private and public groups you're in)
 * GET /api/chat?discover=1&q=   public groups anyone can join
 * GET /api/chat?invite=CODE     preview a group from its invite link
 * GET /api/chat?unread=1        just the unread total (for the nav badge)
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  if (sp.get('discover') !== null || sp.get('invite') !== null) {
    const db = dbOrNull();
    if (!db) return json({ groups: [] });
    const code = sp.get('invite');
    if (code !== null) {
      if (!isCode(code)) return json({ error: 'invalid_invite' }, 400);
      const { data } = await db.from('chats').select(CHAT_COLS).eq('invite_code', code).neq('kind', 'dm').maybeSingle();
      if (!data) return json({ error: 'invite_not_found' }, 404);
      const c = data as ChatRow;
      return NextResponse.json({ group: { ...pub(c), kind: c.kind, invite: null } }, nocache);
    }
    const term = (sp.get('q') || '').replace(/[^A-Za-z0-9_ $]/g, '').trim().slice(0, 30);
    let q = db.from('chats').select(CHAT_COLS).eq('kind', 'public');
    if (term.length >= 2) q = q.ilike('title', `%${term}%`);
    const { data, error } = await q.order('member_count', { ascending: false }).order('last_at', { ascending: false }).limit(40);
    if (error) return json({ error: 'db_read', detail: error.message }, 500);
    return NextResponse.json({ groups: ((data || []) as ChatRow[]).map(pub) }, nocache);
  }

  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  const { db, me } = ctx;
  // The app checking in means everything waiting for this person has reached their device.
  await markDelivered(db, me.id);
  const { data, error } = await db.rpc('chat_inbox', { p: me.id });
  if (error) return json({ error: 'db_read', detail: error.message }, 500);
  const rows = (data || []) as InboxRow[];

  if (sp.get('unread') !== null) {
    const n = rows.filter((r) => !r.muted).reduce((a, r) => a + (r.unread || 0), 0);
    return NextResponse.json({ unread: n, ring: ringTopic(me.id) }, nocache);
  }

  const chats = rows.map((r) => ({
    id: r.id, kind: r.kind, title: r.title, about: r.about, avatar: r.avatar_url, mint: r.mint, invite: r.invite_code,
    role: r.role, muted: r.muted, members: r.member_count, unread: r.unread,
    peer: r.peer_handle ? { handle: r.peer_handle, name: r.peer_name, avatar: r.peer_avatar } : null,
    last: r.last_id
      ? { id: r.last_id, from: r.last_handle, system: r.last_kind === 'system', body: bodyOf(r.id, r.last_body || '', !!r.last_enc).slice(0, 120), at: r.last_at }
      : null,
    lastAt: r.last_at,
  }));
  return NextResponse.json({ chats, encrypted: chatKeyReady(), ring: ringTopic(me.id) }, nocache);
}

/**
 * POST /api/chat
 *  { action:'dm', handle }                                  open (or create) a DM → { id }
 *  { action:'create', kind:'private'|'public', title, about?, mint?, members?:[handles] } → { id, invite }
 *  { action:'join', id? , code? }                            public by id, any group by invite code → { id }
 *  { action:'leave', id }
 *  { action:'mute', id, on }
 *  { action:'edit', id, title?, about?, avatar?, adminsOnly? } owner/admin
 *  { action:'role', id, handle, role:'admin'|'member' }      owner
 *  { action:'invite_reset', id }                             owner/admin → { invite }
 *  { action:'ban', id, handle } / { action:'unban', id, handle }  owner/admin
 *  { action:'delete_msg', id, msg }                          your own message, or any if owner/admin
 */
export async function POST(req: Request) {
  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  const { db, me } = ctx;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const a = b.action;

  if (a === 'dm') {
    const h = typeof b.handle === 'string' ? b.handle.replace(/^@/, '').toLowerCase() : '';
    if (!isHandle(h) || h === me.handle) return json({ error: 'invalid_handle' }, 400);
    const { data: them } = await db.from('profiles').select('id, handle').eq('handle', h).maybeSingle();
    if (!them) return json({ error: 'user_not_found' }, 404);
    const [{ data: theyBlock }, { data: iBlock }] = await Promise.all([
      db.from('blocks').select('profile_id').eq('profile_id', them.id).eq('target_handle', me.handle).maybeSingle(),
      db.from('blocks').select('profile_id').eq('profile_id', me.id).eq('target_handle', h).maybeSingle(),
    ]);
    if (theyBlock) return json({ error: 'cant_message' }, 403);
    if (iBlock) return json({ error: 'you_blocked' }, 403);
    const key = [me.id, them.id as string].sort().join(':');
    let { data: c } = await db.from('chats').select('id').eq('dm_key', key).maybeSingle();
    if (!c) {
      const ins = await db.from('chats').insert({ kind: 'dm', dm_key: key, owner_id: me.id }).select('id').single();
      if (ins.error && ins.error.code === '23505') c = (await db.from('chats').select('id').eq('dm_key', key).single()).data;
      else if (ins.error) return json({ error: 'db_write', detail: ins.error.message }, 500);
      else c = ins.data;
    }
    const id = c!.id as string;
    await Promise.all([addMember(db, id, me.id, 'member'), addMember(db, id, them.id as string, 'member')]);
    return json({ id });
  }

  if (a === 'create') {
    const kind = b.kind === 'public' ? 'public' : b.kind === 'private' ? 'private' : null;
    const title = str(b.title, 48);
    if (!kind) return json({ error: 'invalid_kind' }, 400);
    if (!title) return json({ error: 'title_required' }, 400);
    if (kind === 'private' && !chatKeyReady()) return json({ error: 'chat_key_missing' }, 503);
    // Keep spam groups down: 5 new groups a day per person.
    const since = new Date(Date.now() - 864e5).toISOString();
    const { count } = await db.from('chats').select('id', { count: 'exact', head: true }).eq('owner_id', me.id).neq('kind', 'dm').gte('created_at', since);
    if ((count || 0) >= 5) return json({ error: 'too_many_groups' }, 429);
    const row = { kind, title, about: str(b.about, 160) || null, mint: isMint(b.mint) ? b.mint : null, owner_id: me.id, invite_code: newInvite() };
    const ins = await db.from('chats').insert(row).select('id, invite_code').single();
    if (ins.error) return json({ error: 'db_write', detail: ins.error.message }, 500);
    const id = ins.data.id as string;
    await addMember(db, id, me.id, 'owner');
    const handles = Array.isArray(b.members) ? [...new Set(b.members.filter(isHandle).map((x) => (x as string).toLowerCase()))].slice(0, 50) : [];
    if (handles.length) {
      const { data: ps } = await db.from('profiles').select('id, handle').in('handle', handles);
      for (const p of ps || []) if (p.id !== me.id) await addMember(db, id, p.id as string);
    }
    await systemMsg(db, id, `@${me.handle} started ${kind === 'public' ? 'this public group' : 'this private group'}`);
    return json({ id, invite: ins.data.invite_code });
  }

  if (a === 'join') {
    let c: ChatRow | null = null;
    if (isCode(b.code)) {
      const { data } = await db.from('chats').select(CHAT_COLS).eq('invite_code', b.code).neq('kind', 'dm').maybeSingle();
      c = (data as ChatRow) || null;
      if (!c) return json({ error: 'invite_not_found' }, 404);
    } else if (isUuid(b.id)) {
      c = await getChat(db, b.id);
      if (!c || c.kind !== 'public') return json({ error: 'invite_required' }, 403);
    } else return json({ error: 'invalid' }, 400);
    const r = await addMember(db, c.id, me.id);
    if (r === 'banned') return json({ error: 'banned' }, 403);
    if (r === 'error') return json({ error: 'db_write' }, 500);
    return json({ id: c.id });
  }

  const id = b.id;
  if (!isUuid(id)) return json({ error: 'invalid' }, 400);
  const c = await getChat(db, id);
  if (!c) return json({ error: 'not_found' }, 404);
  const mine = await memberOf(db, id, me.id);
  if (!mine || mine.role === 'banned') return json({ error: 'not_member' }, 403);
  const boss = mine.role === 'owner' || mine.role === 'admin';

  if (a === 'mute') {
    await db.from('chat_members').update({ muted: !!b.on }).eq('chat_id', id).eq('profile_id', me.id);
    return json({ ok: true });
  }

  if (a === 'leave') {
    if (c.kind === 'dm') return json({ error: 'cant_leave_dm' }, 400);
    await db.from('chat_members').delete().eq('chat_id', id).eq('profile_id', me.id);
    if (mine.role === 'owner') {
      // Hand the group to the longest-standing admin, then member. Empty groups are deleted.
      const { data: next } = await db.from('chat_members').select('profile_id, role').eq('chat_id', id).in('role', ['admin', 'member'])
        .order('role', { ascending: true }).order('joined_at', { ascending: true }).limit(1).maybeSingle();
      if (next) {
        await db.from('chat_members').update({ role: 'owner' }).eq('chat_id', id).eq('profile_id', next.profile_id);
        await db.from('chats').update({ owner_id: next.profile_id }).eq('id', id);
      } else {
        await db.from('chats').delete().eq('id', id);
        return json({ ok: true });
      }
    }
    await systemMsg(db, id, `@${me.handle} left`);
    return json({ ok: true });
  }

  if (a === 'delete_msg') {
    const mid = Number(b.msg);
    if (!Number.isInteger(mid)) return json({ error: 'invalid' }, 400);
    let q = db.from('chat_messages').update({ deleted_at: new Date().toISOString(), body: '' }).eq('id', mid).eq('chat_id', id);
    if (!boss) q = q.eq('profile_id', me.id);
    const { error } = await q;
    if (error) return json({ error: 'db_write', detail: error.message }, 500);
    return json({ ok: true });
  }

  if (!boss || c.kind === 'dm') return json({ error: 'not_allowed' }, 403);

  if (a === 'edit') {
    const patch: Record<string, string | boolean | null> = {};
    const said: string[] = [];
    if (typeof b.title === 'string') {
      const t = str(b.title, 48);
      if (!t) return json({ error: 'title_required' }, 400);
      if (t !== c.title) { patch.title = t; said.push(`changed the name to “${t}”`); }
    }
    if (typeof b.about === 'string') { const ab = cleanBody(b.about, 160) || null; if (ab !== c.about) { patch.about = ab; said.push('updated the description'); } }
    if (b.avatar === null || b.avatar === '') { if (c.avatar_url) { patch.avatar_url = null; said.push('removed the group photo'); } }
    else if (b.avatar !== undefined) {
      if (!ownMediaUrl(b.avatar) || /tenor|giphy/.test(String(b.avatar))) return json({ error: 'bad_image' }, 400);
      patch.avatar_url = b.avatar as string; said.push('changed the group photo');
    }
    if (typeof b.adminsOnly === 'boolean' && b.adminsOnly !== !!c.admins_only) {
      patch.admins_only = b.adminsOnly; said.push(b.adminsOnly ? 'set the group so only admins can send messages' : 'let everyone send messages');
    }
    if (!Object.keys(patch).length) return json({ ok: true });
    const { error } = await db.from('chats').update(patch).eq('id', id);
    if (error && 'admins_only' in patch) return json({ error: 'run_migration_0014' }, 503);
    if (error) return json({ error: 'db_write', detail: error.message }, 500);
    if (said.length) await systemMsg(db, id, `@${me.handle} ${said.join(', ')}`);
    return json({ ok: true });
  }

  if (a === 'role') {
    // Owner only: make someone an admin, or take it back.
    if (mine.role !== 'owner') return json({ error: 'not_allowed' }, 403);
    const h = typeof b.handle === 'string' ? b.handle.toLowerCase() : '';
    const to = b.role === 'admin' ? 'admin' : 'member';
    if (!isHandle(h) || h === me.handle) return json({ error: 'invalid_handle' }, 400);
    const { data: p } = await db.from('profiles').select('id').eq('handle', h).maybeSingle();
    if (!p) return json({ error: 'user_not_found' }, 404);
    const target = await memberOf(db, id, p.id as string);
    if (!target || target.role === 'banned' || target.role === 'owner') return json({ error: 'not_allowed' }, 403);
    if (target.role === to) return json({ ok: true });
    const { error } = await db.from('chat_members').update({ role: to }).eq('chat_id', id).eq('profile_id', p.id);
    if (error) return json({ error: 'db_write', detail: error.message }, 500);
    await systemMsg(db, id, to === 'admin' ? `@${me.handle} made @${h} an admin` : `@${h} is no longer an admin`);
    return json({ ok: true });
  }

  if (a === 'invite_reset') {
    const invite = newInvite();
    const { error } = await db.from('chats').update({ invite_code: invite }).eq('id', id);
    if (error) return json({ error: 'db_write', detail: error.message }, 500);
    return json({ invite });
  }

  if (a === 'ban' || a === 'unban') {
    const h = typeof b.handle === 'string' ? b.handle.toLowerCase() : '';
    if (!isHandle(h) || h === me.handle) return json({ error: 'invalid_handle' }, 400);
    const { data: p } = await db.from('profiles').select('id').eq('handle', h).maybeSingle();
    if (!p) return json({ error: 'user_not_found' }, 404);
    const target = await memberOf(db, id, p.id as string);
    if (target?.role === 'owner' || (target?.role === 'admin' && mine.role !== 'owner')) return json({ error: 'not_allowed' }, 403);
    if (a === 'ban') {
      await db.from('chat_members').upsert({ chat_id: id, profile_id: p.id, role: 'banned' }, { onConflict: 'chat_id,profile_id' });
      await systemMsg(db, id, `@${h} was removed`);
    } else {
      await db.from('chat_members').delete().eq('chat_id', id).eq('profile_id', p.id).eq('role', 'banned');
    }
    return json({ ok: true });
  }

  return json({ error: 'unknown_action' }, 400);
}
