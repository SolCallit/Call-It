import { NextResponse } from 'next/server';
import { requireMe, maybeMe, dbOrNull, json } from '@/lib/db/me';
import { chatKeyReady, seal } from '@/lib/chat/crypto';
import { cleanBody, guardPublic, hostOf } from '@/lib/chat/guard';
import { addMember, getChat, isUuid, liveCall, memberOf, MSG_COLS, receiptsFor, shapeMessages } from '@/lib/chat/store';
import { pushTo } from '@/lib/push/send';
import { SUPABASE_URL } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const nocache = { headers: { 'cache-control': 'no-store' } };
const PAGE = 50;

/** The live site's own host is always a trusted link in public groups. */
// Chat attachments live in Supabase storage, so its host is trusted too.
const ownHosts = () => [process.env.PUBLIC_SITE_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL, SUPABASE_URL]
  .filter((x): x is string => !!x).map(hostOf);

/**
 * GET /api/chat/messages?chat=ID              newest page, plus chat details and members
 * GET /api/chat/messages?chat=ID&after=N      anything newer than message N (live polling)
 * GET /api/chat/messages?chat=ID&before=N     the page before message N (scrolling up)
 * Public groups can be read by anyone. DMs and private groups need membership.
 */
export async function GET(req: Request) {
  const db = dbOrNull();
  if (!db) return json({ error: 'database_not_configured' }, 503);
  const sp = new URL(req.url).searchParams;
  const id = sp.get('chat');
  if (!isUuid(id)) return json({ error: 'invalid' }, 400);
  const c = await getChat(db, id);
  if (!c) return json({ error: 'not_found' }, 404);
  const me = await maybeMe(req);
  const mem = me ? await memberOf(db, id, me.id) : null;
  if (mem?.role === 'banned') return json({ error: 'banned' }, 403);
  if (c.kind !== 'public' && !mem) return json({ error: 'not_member' }, 403);

  const after = Number(sp.get('after')), before = Number(sp.get('before'));
  let q = db.from('chat_messages').select(MSG_COLS).eq('chat_id', id);
  if (Number.isInteger(after) && after > 0) q = q.gt('id', after).order('id', { ascending: true }).limit(200);
  else {
    if (Number.isInteger(before) && before > 0) q = q.lt('id', before);
    q = q.order('id', { ascending: false }).limit(PAGE);
  }
  const { data, error } = await q;
  if (error) return json({ error: 'db_read', detail: error.message }, 500);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data || []) as any[];
  if (!(after > 0)) rows.reverse();
  const messages = await shapeMessages(db, id, rows, me?.id || null);

  // Opening the chat reads it (and so it has also been delivered).
  const newest = rows.length ? rows[rows.length - 1].id : 0;
  if (mem && newest > mem.last_read_id) {
    const up = await db.from('chat_members').update({ last_read_id: newest, delivered_id: newest }).eq('chat_id', id).eq('profile_id', me!.id);
    if (up.error) await db.from('chat_members').update({ last_read_id: newest }).eq('chat_id', id).eq('profile_id', me!.id); // before migration 0014
  }

  const out: Record<string, unknown> = { messages, more: !(after > 0) && rows.length === PAGE };
  // Every poll carries fresh receipts and the live call, so ticks turn blue and "Join call" appears without new messages.
  if (mem && !(before > 0)) {
    const [reads, call] = await Promise.all([receiptsFor(db, id, me!.id), liveCall(db, id)]);
    out.reads = reads;
    out.call = call;
  }
  if (!(after > 0) && !(before > 0)) {
    const { data: ms } = await db.from('chat_members').select('role, profiles(handle, display_name, avatar_url)')
      .eq('chat_id', id).neq('role', 'banned').order('joined_at', { ascending: true }).limit(c.kind === 'public' ? 60 : 200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const members = ((ms || []) as any[]).filter((m) => m.profiles).map((m) => ({ handle: m.profiles.handle, name: m.profiles.display_name, avatar: m.profiles.avatar_url, role: m.role }));
    const boss = mem?.role === 'owner' || mem?.role === 'admin';
    out.chat = {
      id: c.id, kind: c.kind, title: c.title, about: c.about, avatar: c.avatar_url, mint: c.mint, members: c.member_count,
      invite: c.kind === 'public' || boss ? c.invite_code : null, role: mem?.role || null, muted: !!mem?.muted, adminsOnly: !!c.admins_only,
      peer: c.kind === 'dm' ? members.find((m) => m.handle !== me?.handle) || null : null,
    };
    out.people = members;
  }
  return NextResponse.json(out, nocache);
}

/** POST /api/chat/messages { chat, body, reply_to? } → { message } */
export async function POST(req: Request) {
  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  const { db, me } = ctx;
  const b = (await req.json().catch(() => ({}))) as { chat?: unknown; body?: unknown; reply_to?: unknown };
  if (!isUuid(b.chat)) return json({ error: 'invalid' }, 400);
  const body = cleanBody(b.body);
  if (!body) return json({ error: 'empty' }, 400);
  const c = await getChat(db, b.chat);
  if (!c) return json({ error: 'not_found' }, 404);

  let mem = await memberOf(db, c.id, me.id);
  if (mem?.role === 'banned') return json({ error: 'banned' }, 403);
  if (!mem) {
    if (c.kind !== 'public') return json({ error: 'not_member' }, 403);
    if ((await addMember(db, c.id, me.id)) !== 'ok') return json({ error: 'db_write' }, 500); // talking in a public group joins it
    mem = { role: 'member', muted: false, last_read_id: 0 };
  }

  if (c.admins_only && c.kind !== 'dm' && mem.role !== 'owner' && mem.role !== 'admin') return json({ error: 'admins_only' }, 403);

  const isPublic = c.kind === 'public';
  if (isPublic) {
    const g = guardPublic(body, ownHosts());
    if (!g.ok) return json({ error: 'blocked_' + g.reason, detail: g.detail }, 422);
  } else if (!chatKeyReady()) return json({ error: 'chat_key_missing' }, 503);

  // Slow mode: public groups 5 messages / 15s, private chats 15. Same text twice in a minute is dropped in public.
  const since = new Date(Date.now() - 15e3).toISOString();
  const { count } = await db.from('chat_messages').select('id', { count: 'exact', head: true }).eq('chat_id', c.id).eq('profile_id', me.id).gte('created_at', since);
  if ((count || 0) >= (isPublic ? 5 : 15)) return json({ error: 'slow_down' }, 429);
  if (isPublic) {
    const { data: dup } = await db.from('chat_messages').select('id').eq('chat_id', c.id).eq('profile_id', me.id).eq('body', body)
      .gte('created_at', new Date(Date.now() - 6e4).toISOString()).limit(1);
    if (dup?.length) return json({ error: 'duplicate' }, 429);
  }

  const reply = Number(b.reply_to);
  const row = {
    chat_id: c.id, profile_id: me.id, kind: 'text', enc: !isPublic,
    body: isPublic ? body : seal(c.id, body),
    reply_to: Number.isInteger(reply) && reply > 0 ? reply : null,
  };
  const ins = await db.from('chat_messages').insert(row).select(MSG_COLS).single();
  if (ins.error) return json({ error: 'db_write', detail: ins.error.message }, 500);
  const rd = await db.from('chat_members').update({ last_read_id: ins.data.id, delivered_id: ins.data.id }).eq('chat_id', c.id).eq('profile_id', me.id);
  if (rd.error) await db.from('chat_members').update({ last_read_id: ins.data.id }).eq('chat_id', c.id).eq('profile_id', me.id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [message] = await shapeMessages(db, c.id, [ins.data as any], me.id);

  // Phone pop-ups: everyone in a DM or private group, and anyone @mentioned in a public group. A failed push never fails the send.
  // Awaited because serverless functions can stop as soon as the response is sent.
  await notify(c.kind, c.id, c.title, me, body).catch((e) => console.warn('[chat] push', e?.message));
  return json({ message });

  async function notify(kind: string, chatId: string, title: string | null, from: { id: string; handle: string }, text: string) {
    let ids: string[] = [];
    if (kind === 'dm' || kind === 'private') { // DMs and private groups ping every member; public groups only @mentions
      const { data } = await db.from('chat_members').select('profile_id').eq('chat_id', chatId).eq('muted', false).neq('profile_id', from.id);
      ids = (data || []).map((r) => r.profile_id as string).slice(0, 100);
    } else {
      const tags = [...new Set([...text.matchAll(/@([A-Za-z0-9_]{3,20})/g)].map((m) => m[1].toLowerCase()))].filter((h) => h !== from.handle).slice(0, 20);
      if (!tags.length) return;
      const { data: ps } = await db.from('profiles').select('id').in('handle', tags);
      const pids = (ps || []).map((p) => p.id as string);
      if (!pids.length) return;
      const { data } = await db.from('chat_members').select('profile_id').eq('chat_id', chatId).eq('muted', false).in('profile_id', pids);
      ids = (data || []).map((r) => r.profile_id as string);
    }
    if (!ids.length) return;
    const { data: who } = await db.from('profiles').select('avatar_url').eq('id', from.id).maybeSingle();
    // Attachments travel as [[img:url]] / [[voice:url|secs]] / [[file:url|name]] markers; show them as words.
    const plain = text.replace(/\[\[img:[^\]]+\]\]/g, '📷 Photo').replace(/\[\[gif:[^\]]+\]\]/g, 'GIF').replace(/\[\[voice:[^\]]+\]\]/g, '🎤 Voice note')
      .replace(/\[\[file:[^|\]]+\|?([^\]]*)\]\]/g, (_, n) => '📎 ' + (n || 'File')).trim();
    const preview = plain.length > 90 ? plain.slice(0, 87) + '…' : plain;
    await pushTo(db, ids, {
      title: kind === 'dm' ? `@${from.handle}` : `@${from.handle} in ${title || 'a group'}`,
      body: preview,
      link: `#/messages/c-${chatId}`,
      tag: 'chat-' + chatId,
      icon: (who?.avatar_url as string) || null, // sender's photo on the pop-up
    });
  }
}
