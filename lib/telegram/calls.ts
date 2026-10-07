import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { jupMany } from '@/lib/market/sources';
import { onNewCall } from '@/lib/alerts/triggers';
import { usd } from '@/lib/push/send';

/** The Callit profile a Telegram group posts as (for members who haven't linked Callit). */
export async function groupProfile(db: SupabaseClient, chatId: number, title: string): Promise<{ id: string; handle: string } | null> {
  const privy_id = `tg:${chatId}`;
  const { data: have } = await db.from('profiles').select('id, handle').eq('privy_id', privy_id).maybeSingle();
  if (have) return have as { id: string; handle: string };
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 14) || 'group';
  const tail = String(Math.abs(chatId)).slice(-4);
  for (const handle of [`tg_${slug}`, `tg_${slug.slice(0, 11)}_${tail}`, `tg_${tail}_${Date.now() % 1e5}`]) {
    const h = handle.slice(0, 20);
    const { data, error } = await db.from('profiles')
      .insert({ privy_id, handle: h, display_name: title.slice(0, 40), bio: 'Calls from this Telegram group, posted by the Callit bot.' })
      .select('id, handle').single();
    if (!error && data) return data as { id: string; handle: string };
    if (error && !/duplicate|unique/i.test(error.message)) { console.warn('[tg] group profile', error.message); return null; }
  }
  return null;
}

export type TgCall = { id: string; sym: string; mc: number; handle: string; linked: boolean };

/**
 * Turns a contract address dropped in a Telegram group into a Callit call.
 * One call per token per group per 24h: the first person to drop it gets the call.
 */
export async function callFromTelegram(db: SupabaseClient, o: {
  chatId: number; groupTitle: string; groupProfileId: string; groupHandle: string;
  fromId: number | null; fromName: string; text: string; mint: string;
}): Promise<TgCall | null> {
  const { data: seen } = await db.from('tg_seen').select('created_at').eq('chat_id', o.chatId).eq('mint', o.mint).maybeSingle();
  if (seen && Date.now() - Date.parse(seen.created_at) < 864e5) return null;

  const [t] = await jupMany([o.mint]).catch(() => []);
  if (!t || !t.mc) return null; // not a token we can price (a wallet, a pair address…)

  // Linked members post as themselves (and earn); everyone else posts as the group.
  let profileId = o.groupProfileId, handle = o.groupHandle, linked = false;
  if (o.fromId) {
    const { data: u } = await db.from('tg_users').select('profile_id, profiles(handle)').eq('tg_user_id', o.fromId).maybeSingle();
    const ph = (u as unknown as { profile_id: string; profiles: { handle: string } | null } | null);
    if (ph?.profile_id && ph.profiles?.handle) { profileId = ph.profile_id; handle = ph.profiles.handle; linked = true; }
  }

  // Keep the caller's words, minus links and the CA itself.
  let body = o.text.replace(/https?:\/\/\S+/g, '').replace(new RegExp(o.mint, 'g'), '').replace(/\s+/g, ' ').trim();
  if (body.length < 3) body = `Called in ${o.groupTitle} on Telegram`;
  body = body.slice(0, 280);
  const label = (linked ? o.groupTitle : `${o.groupTitle} · ${o.fromName}`).slice(0, 80);

  const row = {
    profile_id: profileId, kind: 'meme', body, media: [],
    mint: t.mint, token_sym: (t.sym || '').slice(0, 20), token_name: (t.name || '').slice(0, 60), chain: 'Solana',
    entry_mc: t.mc, horizon: '7 days', source: 'telegram', source_label: label,
  };
  const { data, error } = await db.from('posts').insert(row).select('id, kind, mint, token_sym, entry_mc, body').single();
  if (error) {
    if (!/daily_post_limit/.test(error.message)) console.warn('[tg] call insert', error.message);
    return null;
  }
  await db.from('tg_seen').upsert({ chat_id: o.chatId, mint: o.mint, post_id: data.id, created_at: new Date().toISOString() });
  await onNewCall(db, { id: profileId, handle }, data as { id: string; kind: string; mint: string; token_sym: string; entry_mc: number; body: string }).catch(() => {});
  return { id: data.id as string, sym: t.sym || 'token', mc: t.mc, handle, linked };
}

export const mcText = (v: number) => usd(v);
