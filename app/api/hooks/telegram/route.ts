import { supabaseAdmin } from '@/lib/supabase/admin';
import { json } from '@/lib/db/me';
import { botUsername, findMints, h, siteUrl, tg, webhookSecret } from '@/lib/telegram/bot';
import { callFromTelegram, groupProfile, mcText } from '@/lib/telegram/calls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type User = { id: number; is_bot?: boolean; username?: string; first_name?: string };
type Chat = { id: number; type: 'private' | 'group' | 'supergroup' | 'channel'; title?: string };
type Msg = { message_id: number; chat: Chat; from?: User; sender_chat?: Chat; text?: string; caption?: string };
type Update = { message?: Msg; channel_post?: Msg; my_chat_member?: { chat: Chat; from: User; new_chat_member: { status: string } } };

const say = (chat_id: number, text: string, reply_to?: number) =>
  tg('sendMessage', { chat_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(reply_to ? { reply_parameters: { message_id: reply_to, allow_sending_without_reply: true } } : {}) });

async function isGroupAdmin(chatId: number, userId: number | undefined): Promise<boolean> {
  if (!userId) return false;
  const m = await tg<{ status: string }>('getChatMember', { chat_id: chatId, user_id: userId });
  return m?.status === 'creator' || m?.status === 'administrator';
}

/**
 * POST from Telegram (webhook set from the admin panel). The Callit bot:
 *  - in a group/channel: an admin sends /callit to turn it on; every contract address
 *    dropped after that becomes a call on Callit (first drop per token per day).
 *  - in a DM: /start <code> links the person's Telegram to their Callit account,
 *    so their calls post as them and earn caller fees.
 */
export async function POST(req: Request) {
  const secret = webhookSecret();
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) return json({ error: 'unauthorized' }, 401);
  const db = supabaseAdmin();
  if (!db) return json({ ok: true });
  const u = (await req.json().catch(() => ({}))) as Update;
  const site = siteUrl();

  // Bot added to a group: explain how to turn it on.
  if (u.my_chat_member) {
    const { chat, new_chat_member } = u.my_chat_member;
    if (chat.type !== 'private' && (new_chat_member.status === 'member' || new_chat_member.status === 'administrator')) {
      await say(chat.id, '👋 <b>Callit bot here.</b>\nA group admin can send /callit to turn me on. After that, every contract address dropped here becomes a tracked call on Callit.');
    }
    return json({ ok: true });
  }

  const m = u.message || u.channel_post;
  if (!m) return json({ ok: true });
  const text = (m.text || m.caption || '').trim();
  const chat = m.chat;
  const cmd = /^\/([a-z_]+)(?:@\w+)?(?:\s+(.*))?$/i.exec(text);

  // ── Direct messages: account linking ──
  if (chat.type === 'private') {
    const code = cmd && (cmd[1] === 'start' || cmd[1] === 'link') ? (cmd[2] || '').trim().toUpperCase() : '';
    if (!code) {
      await say(chat.id, `Hi! To link this Telegram to Callit, open <b>You → Settings → Link Telegram</b> on ${h(site)} and tap the link it gives you.`);
      return json({ ok: true });
    }
    const { data: c } = await db.from('tg_link_codes').select('profile_id, expires_at').eq('code', code).maybeSingle();
    if (!c || Date.parse(c.expires_at) < Date.now()) {
      await say(chat.id, 'That link expired. Get a fresh one in Callit and try again.');
      return json({ ok: true });
    }
    await db.from('tg_users').delete().or(`tg_user_id.eq.${m.from?.id ?? 0},profile_id.eq.${c.profile_id}`);
    const { error } = await db.from('tg_users').insert({ tg_user_id: m.from!.id, profile_id: c.profile_id, username: m.from?.username ?? null });
    await db.from('tg_link_codes').delete().eq('code', code);
    const { data: p } = await db.from('profiles').select('handle').eq('id', c.profile_id).maybeSingle();
    await say(chat.id, error ? 'Couldn’t link right now. Try again in a minute.'
      : `✅ Linked to <b>@${h(p?.handle || 'your account')}</b>.\nContract addresses you drop in Callit-enabled groups now post as your calls, and you earn from them.`);
    return json({ ok: true });
  }

  // ── Groups and channels ──
  const title = (chat.title || 'Telegram group').slice(0, 60);
  if (cmd && cmd[1].toLowerCase() === 'callit') {
    // In channels only admins can post at all, so a channel post counts as an admin.
    const admin = chat.type === 'channel' || (m.sender_chat?.id === chat.id) || (await isGroupAdmin(chat.id, m.from?.id));
    if (!admin) { await say(chat.id, 'Only a group admin can turn Callit on or off.', m.message_id); return json({ ok: true }); }
    const off = /^off$/i.test((cmd[2] || '').trim());
    const gp = off ? null : await groupProfile(db, chat.id, title);
    if (!off && !gp) { await say(chat.id, 'Callit couldn’t set up this group right now. Try again shortly.'); return json({ ok: true }); }
    await db.from('tg_groups').upsert({ chat_id: chat.id, title, enabled: !off, ...(gp ? { profile_id: gp.id } : {}), added_by: m.from?.id ?? null });
    const bot = await botUsername();
    await say(chat.id, off ? '⏸ Callit is off for this group. Send /callit to turn it back on.'
      : `✅ <b>Callit is on.</b>\nDrop a contract address and it becomes a tracked call on Callit: <a href="${site}/#/profile/${gp!.handle}">@${h(gp!.handle)}</a>.\n\n💸 Want calls posted as <i>you</i>, and paid? Link your Telegram in Callit${bot ? ` (or DM @${h(bot)})` : ''}.`);
    return json({ ok: true });
  }

  if (!text || m.from?.is_bot) return json({ ok: true });
  const mints = findMints(text);
  if (!mints.length) return json({ ok: true });

  const { data: g } = await db.from('tg_groups').select('enabled, profile_id, title, profiles(handle)').eq('chat_id', chat.id).maybeSingle();
  const grp = g as unknown as { enabled: boolean; profile_id: string | null; title: string | null; profiles: { handle: string } | null } | null;
  if (!grp?.enabled || !grp.profile_id || !grp.profiles?.handle) return json({ ok: true });
  if (grp.title !== title) await db.from('tg_groups').update({ title }).eq('chat_id', chat.id);

  const fromName = m.from?.username ? '@' + m.from.username : m.from?.first_name || m.sender_chat?.title || 'member';
  for (const mint of mints) {
    const c = await callFromTelegram(db, {
      chatId: chat.id, groupTitle: title, groupProfileId: grp.profile_id, groupHandle: grp.profiles.handle,
      fromId: m.from?.id ?? null, fromName, text, mint,
    });
    if (!c) continue;
    if (process.env.TELEGRAM_REPLY !== '0') {
      await say(chat.id, `📢 <b>$${h(c.sym)}</b> called at <b>${h(mcText(c.mc))}</b> MC, now tracking on Callit.\n<a href="${site}/#/post/${c.id}">Open the call</a>${c.linked ? ` · by @${h(c.handle)}` : ''}`, m.message_id);
    }
    break; // one call per message
  }
  return json({ ok: true });
}
