import 'server-only';
import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { open } from '@/lib/chat/crypto';

export type Kind = 'dm' | 'private' | 'public';
export type Role = 'owner' | 'admin' | 'member' | 'banned';
export type ChatRow = {
  id: string; kind: Kind; title: string | null; about: string | null; avatar_url: string | null; mint: string | null;
  owner_id: string | null; invite_code: string | null; member_count: number; last_at: string; created_at: string;
  admins_only?: boolean; // migration 0014
};
export type Person = { handle: string; name: string | null; avatar: string | null };

// '*' so newer columns (admins_only, 0014) show up when the migration has run, and nothing breaks before it has.
export const CHAT_COLS = '*';
export const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
export const isCode = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9]{6,16}$/.test(s);

const B62 = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export function newInvite(len = 9): string {
  const b = randomBytes(len);
  return Array.from(b, (x) => B62[x % B62.length]).join('');
}

export async function getChat(db: SupabaseClient, id: string): Promise<ChatRow | null> {
  const { data } = await db.from('chats').select(CHAT_COLS).eq('id', id).maybeSingle();
  return (data as ChatRow) || null;
}

export async function memberOf(db: SupabaseClient, chatId: string, profileId: string) {
  const { data } = await db.from('chat_members').select('role, muted, last_read_id').eq('chat_id', chatId).eq('profile_id', profileId).maybeSingle();
  return (data as { role: Role; muted: boolean; last_read_id: number } | null) || null;
}

/** Plain text of a stored message body ('' if it can't be opened). */
export function bodyOf(chatId: string, body: string, enc: boolean): string {
  if (!enc) return body;
  return open(chatId, body) ?? '';
}

export const person = (p: { handle?: string; display_name?: string | null; avatar_url?: string | null } | null | undefined): Person | null =>
  p && p.handle ? { handle: p.handle, name: p.display_name || null, avatar: p.avatar_url || null } : null;

type MsgRow = {
  id: number; chat_id: string; profile_id: string | null; kind: 'text' | 'system'; body: string; enc: boolean;
  reply_to: number | null; created_at: string; deleted_at: string | null;
  profiles: { handle: string; display_name: string | null; avatar_url: string | null } | null;
};
export const MSG_COLS = 'id, chat_id, profile_id, kind, body, enc, reply_to, created_at, deleted_at, profiles(handle, display_name, avatar_url)';

export type Msg = {
  id: number; from: Person | null; mine: boolean; kind: 'text' | 'system'; body: string; at: string; deleted: boolean;
  reply: { id: number; from: string | null; body: string } | null;
};

/** Shapes rows for the browser: decrypts, resolves replies, hides deleted text. */
export async function shapeMessages(db: SupabaseClient, chatId: string, rows: MsgRow[], meId: string | null): Promise<Msg[]> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = [...new Set(rows.map((r) => r.reply_to).filter((x): x is number => !!x && !byId.has(x)))];
  if (missing.length) {
    const { data } = await db.from('chat_messages').select(MSG_COLS).in('id', missing).eq('chat_id', chatId);
    ((data || []) as unknown as MsgRow[]).forEach((r) => byId.set(r.id, r));
  }
  const out = rows.map((r) => {
    const q = r.reply_to ? byId.get(r.reply_to) : null;
    return {
      id: r.id,
      from: person(r.profiles),
      mine: !!meId && r.profile_id === meId,
      kind: r.kind,
      body: r.deleted_at ? '' : bodyOf(chatId, r.body, r.enc),
      at: r.created_at,
      deleted: !!r.deleted_at,
      reply: q ? { id: q.id, from: q.profiles?.handle || null, body: q.deleted_at ? '' : bodyOf(chatId, q.body, q.enc).slice(0, 140) } : null,
    };
  });
  return signAttachments(db, out);
}

/* Chat files live in a PRIVATE bucket. Messages store a stable reference; members only ever get
   short-lived signed links, handed out after the membership check in /api/chat/messages. */
const CHAT_REF = /https:\/\/[^\s\]|]+\/storage\/v1\/object\/(?:public|sign)\/chat\/([^\s\]|?]+)(?:\?[^\s\]|]*)?/g;
async function signAttachments(db: SupabaseClient, msgs: Msg[]): Promise<Msg[]> {
  const paths = new Set<string>();
  for (const m of msgs) for (const x of m.body.matchAll(CHAT_REF)) paths.add(decodeURIComponent(x[1]));
  if (!paths.size) return msgs;
  const { data } = await db.storage.from('chat').createSignedUrls([...paths], 6 * 3600);
  const map = new Map((data || []).filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl as string]));
  return msgs.map((m) => ({ ...m, body: m.body.replace(CHAT_REF, (all, p) => map.get(decodeURIComponent(p)) || all) }));
}

/** Adds a member (or re-activates one). Banned people stay out. */
export async function addMember(db: SupabaseClient, chatId: string, profileId: string, role: Role = 'member'): Promise<'ok' | 'banned' | 'error'> {
  const cur = await memberOf(db, chatId, profileId);
  if (cur?.role === 'banned') return 'banned';
  if (cur) return 'ok';
  const { data: last } = await db.from('chat_messages').select('id').eq('chat_id', chatId).order('id', { ascending: false }).limit(1).maybeSingle();
  // New members start "read" at the latest message, so they don't open a group with 99 unread.
  const { error } = await db.from('chat_members').insert({ chat_id: chatId, profile_id: profileId, role, last_read_id: (last?.id as number) || 0 });
  return error && error.code !== '23505' ? 'error' : 'ok';
}

export async function systemMsg(db: SupabaseClient, chatId: string, text: string) {
  await db.from('chat_messages').insert({ chat_id: chatId, profile_id: null, kind: 'system', body: text.slice(0, 200), enc: false });
}

/**
 * Delivery receipts for the other members: [delivered_id, last_read_id] each. The browser turns
 * these into ticks on your own messages (sent → delivered → seen). Null if unavailable.
 */
export async function receiptsFor(db: SupabaseClient, chatId: string, meId: string): Promise<[number, number][] | null> {
  const base = () => db.from('chat_members').select('*').eq('chat_id', chatId).neq('role', 'banned').neq('profile_id', meId).limit(300);
  const { data, error } = await base();
  if (error) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data || []) as any[]).map((r) => {
    const read = Number(r.last_read_id) || 0;
    return [Math.max(Number(r.delivered_id) || 0, read), read];
  });
}

/** The call happening in this chat right now, if anyone is still on it. */
export async function liveCall(db: SupabaseClient, chatId: string) {
  const since = new Date(Date.now() - 45e3).toISOString();
  const { data, error } = await db.from('chat_calls').select('id, kind, started_at, profiles:started_by(handle)')
    .eq('chat_id', chatId).is('ended_at', null).gte('alive_at', since).order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  return { id: d.id as string, kind: d.kind as 'audio' | 'video', at: d.started_at as string, by: (d.profiles?.handle as string) || null };
}

/** Marks every chat this person is in as delivered up to its newest message. Never throws. */
export async function markDelivered(db: SupabaseClient, profileId: string) {
  try { await db.rpc('chat_mark_delivered', { p: profileId }); } catch { /* migration 0014 not run yet */ }
}

/**
 * Friends = you follow each other. In a DM, calls and links are for friends only, so a stranger can
 * message you but can't ring your phone or drop a link on you. Returns true for anything that isn't a
 * two-person DM, and true if the lookup fails (never lock people out of chat on a database hiccup).
 */
export async function dmFriends(db: SupabaseClient, chatId: string, me: { id: string; handle: string }): Promise<boolean> {
  try {
    const { data: ms } = await db.from('chat_members').select('profile_id, profiles(handle)').eq('chat_id', chatId).neq('profile_id', me.id).limit(2);
    const peer = (ms || [])[0] as unknown as { profile_id: string; profiles: { handle: string } | { handle: string }[] | null } | undefined;
    const ph = peer ? (Array.isArray(peer.profiles) ? peer.profiles[0]?.handle : peer.profiles?.handle) : null;
    if (!peer || !ph) return true;
    const [a, b] = await Promise.all([
      db.from('follows').select('profile_id', { count: 'exact', head: true }).eq('profile_id', me.id).eq('target_handle', ph),
      db.from('follows').select('profile_id', { count: 'exact', head: true }).eq('profile_id', peer.profile_id).eq('target_handle', me.handle),
    ]);
    if (a.error || b.error) return true;
    return (a.count || 0) > 0 && (b.count || 0) > 0;
  } catch { return true; }
}
