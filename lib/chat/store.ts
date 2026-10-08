import 'server-only';
import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { open } from '@/lib/chat/crypto';

export type Kind = 'dm' | 'private' | 'public';
export type Role = 'owner' | 'admin' | 'member' | 'banned';
export type ChatRow = {
  id: string; kind: Kind; title: string | null; about: string | null; avatar_url: string | null; mint: string | null;
  owner_id: string | null; invite_code: string | null; member_count: number; last_at: string; created_at: string;
};
export type Person = { handle: string; name: string | null; avatar: string | null };

export const CHAT_COLS = 'id, kind, title, about, avatar_url, mint, owner_id, invite_code, member_count, last_at, created_at';
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
  return rows.map((r) => {
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
