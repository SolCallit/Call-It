import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { requireMe, json } from '@/lib/db/me';
import { botToken, botUsername } from '@/lib/telegram/bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => Array.from(randomBytes(10), (b) => ALPHA[b % ALPHA.length]).join('');

/** GET — is this account linked to Telegram? */
export async function GET(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  if (!botToken()) return json({ available: false });
  const { data, error } = await a.db.from('tg_users').select('username, created_at').eq('profile_id', a.me.id).maybeSingle();
  if (error) return json({ available: false, reason: 'Run migration 0010 in Supabase.' });
  return json({ available: true, bot: await botUsername(), linked: !!data, username: data?.username ?? null });
}

/** POST — a one-time link (valid 15 minutes) that opens the Callit bot and links this account. */
export async function POST(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  const bot = botToken() ? await botUsername() : null;
  if (!bot) return json({ error: 'Telegram isn’t set up yet.' }, 503);
  await a.db.from('tg_link_codes').delete().eq('profile_id', a.me.id);
  const c = code();
  const { error } = await a.db.from('tg_link_codes').insert({ code: c, profile_id: a.me.id, expires_at: new Date(Date.now() + 15 * 6e4).toISOString() });
  if (error) return json({ error: 'db_write', detail: error.message }, 500);
  return json({ code: c, url: `https://t.me/${bot}?start=${c}` });
}

/** DELETE — unlink Telegram. */
export async function DELETE(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  await a.db.from('tg_users').delete().eq('profile_id', a.me.id);
  return json({ ok: true });
}
