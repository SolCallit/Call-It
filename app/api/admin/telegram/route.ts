import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/db/admin';
import { json } from '@/lib/db/me';
import { botToken, botUsername, siteUrl, tg, webhookSecret } from '@/lib/telegram/bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/telegram — bot + webhook status and the groups using it. */
export async function GET(req: Request) {
  const a = await requireAdmin(req);
  if (a instanceof NextResponse) return a;
  if (!botToken()) return json({ configured: false });
  const [info, bot] = await Promise.all([tg<{ url: string; pending_update_count: number; last_error_message?: string }>('getWebhookInfo'), botUsername()]);
  const want = `${siteUrl()}/api/hooks/telegram`;
  const { data: groups, error } = await a.db.from('tg_groups').select('chat_id, title, enabled, created_at, profiles(handle)').order('created_at', { ascending: false }).limit(100);
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const { count } = await a.db.from('posts').select('id', { count: 'exact', head: true }).eq('source', 'telegram').gte('created_at', since);
  return json({
    configured: true, bot, connected: info?.url === want, webhook: info?.url || null, want,
    pending: info?.pending_update_count ?? 0, lastError: info?.last_error_message ?? null,
    migration: !error, calls7d: count || 0,
    groups: (groups || []).map((g) => { const x = g as unknown as { profiles: { handle: string } | null } & Record<string, unknown>; return { ...x, chat_id: String(x.chat_id), handle: x.profiles?.handle ?? null, profiles: undefined }; }),
  });
}

/**
 * POST /api/admin/telegram
 *  { action: 'connect' }                       — points the bot's webhook at this site
 *  { action: 'group', chat_id, enabled }       — turn a group on/off
 */
export async function POST(req: Request) {
  const a = await requireAdmin(req);
  if (a instanceof NextResponse) return a;
  if (!botToken()) return json({ error: 'Add TELEGRAM_BOT_TOKEN in Vercel first.' }, 400);
  const b = (await req.json().catch(() => ({}))) as { action?: string; chat_id?: string; enabled?: boolean };

  if (b.action === 'connect') {
    const ok = await tg('setWebhook', {
      url: `${siteUrl()}/api/hooks/telegram`, secret_token: webhookSecret(),
      allowed_updates: ['message', 'channel_post', 'my_chat_member', 'callback_query'], drop_pending_updates: true,
    });
    if (!ok) return json({ error: 'Telegram refused the webhook. Check the bot token.' }, 502);
    await tg('setMyCommands', { commands: [{ command: 'callit', description: 'Turn Callit on for this group (admins). /callit off to stop' }], scope: { type: 'all_group_chats' } });
    await tg('setMyCommands', { commands: [{ command: 'start', description: 'Link your Callit account' }], scope: { type: 'all_private_chats' } });
    return json({ ok: true });
  }
  if (b.action === 'group' && typeof b.chat_id === 'string' && /^-?\d{1,20}$/.test(b.chat_id)) {
    const { error } = await a.db.from('tg_groups').update({ enabled: !!b.enabled }).eq('chat_id', b.chat_id);
    if (error) return json({ error: 'db_write', detail: error.message }, 500);
    return json({ ok: true });
  }
  return json({ error: 'invalid_action' }, 400);
}
