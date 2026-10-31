import { burst } from '@/lib/ratelimit';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PRIVY_APP_ID } from '@/lib/config';
import { chatKeyReady } from '@/lib/chat/crypto';
import { pushIssue } from '@/lib/push/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Uptime + config check. Open /api/health in a browser.
 * Reports which pieces are configured and reachable. Never returns secret values.
 */
export async function GET(req: Request) {
  const env = {
    privy_app_id: !!process.env.NEXT_PUBLIC_PRIVY_APP_ID,
    privy_secret: !!process.env.PRIVY_APP_SECRET,
    supabase_url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabase_anon: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    supabase_service: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  let privy_jwks = 'unchecked';
  try {
    const r = await fetch(`https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/jwks.json`, { cache: 'no-store' });
    privy_jwks = r.ok ? 'ok' : `http_${r.status}`;
  } catch (e) {
    privy_jwks = 'unreachable';
  }

  // Privy login settings as the SDK sees them (public app config, no secrets).
  let privy_login: Record<string, unknown> | string = 'unchecked';
  try {
    const r = await fetch(`https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}`, {
      headers: { 'privy-app-id': PRIVY_APP_ID, origin: process.env.NEXT_PUBLIC_SITE_URL || 'https://www.callit.buzz' },
      cache: 'no-store',
    });
    if (!r.ok) privy_login = `http_${r.status}`;
    else {
      const c = (await r.json()) as Record<string, unknown>;
      privy_login = {
        solana_wallet_login: c.solana_wallet_auth ?? null,
        evm_wallet_login: c.wallet_auth ?? null,
        google: c.google_oauth ?? null,
        twitter: c.twitter_oauth ?? null,
        email: c.email_auth ?? null,
        captcha: c.captcha_enabled ?? null,
        allowed_domains: c.allowed_domains ?? null,
      };
    }
  } catch {
    privy_login = 'unreachable';
  }

  let profiles_table = 'no_database_config';
  let notifications_table = 'no_database_config';
  // Migration 0003 (posts, social, ledger, media). Posting and image upload fail if any of these are missing.
  const social: Record<string, string> = {};
  let media_bucket = 'no_database_config';
  // Migration 0005: bookmarks, social notifications, usernames.
  let edit4 = 'no_database_config';
  const db = supabaseAdmin();
  if (db) {
    const q = await db.from('profiles').select('id').limit(1);
    profiles_table = q.error ? `error: ${q.error.message}` : 'ok';
    const n = await db.from('notifications').select('id').limit(1);
    notifications_table = n.error ? `error: ${n.error.message}` : 'ok';
    const tables = ['posts', 'post_reactions', 'post_replies', 'follows', 'watchlist', 'transactions'];
    // Real reads, not HEAD: HEAD requests can't carry an error body, so a missing table looked "ok".
    const res = await Promise.all(tables.map((t) => db.from(t).select('*').limit(1)));
    tables.forEach((t, i) => (social[t] = res[i].error ? `error: ${res[i].error!.message}` : 'ok'));
    // The table can exist with missing columns (created by an older migration). Probe the exact columns the API writes.
    if (social.posts === 'ok') {
      const cols = 'id,profile_id,kind,body,media,mint,token_sym,token_name,chain,entry_mc,target_mc,horizon,buy_usd,buy_sig,perp_market,perp_side,perp_leverage,perp_entry,perp_target,perp_stop,created_at,deleted_at';
      const c = await db.from('posts').select(cols).limit(1);
      if (c.error) social.posts = `error: ${c.error.message}`;
    }
    const [bk, na, ph] = await Promise.all([
      db.from('bookmarks').select('*').limit(1),
      db.from('notifications').select('actor_handle').limit(1),
      db.from('profiles').select('handle_changed_at').limit(1),
    ]);
    const e4 = [bk.error, na.error, ph.error].find(Boolean);
    edit4 = e4 ? `error: ${e4.message}` : 'ok';
    const b = await db.storage.getBucket('media');
    media_bucket = b.error ? `error: ${b.error.message}` : b.data?.public ? 'ok' : 'error: bucket is not public';
  }
  // Migration 0011 + CHAT_KEY: chat. Push: phone pop-ups (VAPID keys).
  let chat: Record<string, string> = { tables: 'no_database_config' };
  if (db) {
    const r = await Promise.all(['chats', 'chat_members', 'chat_messages'].map((t) => db.from(t).select('*').limit(1)));
    const e = r.find((x) => x.error)?.error;
    const f = await db.rpc('chat_inbox', { p: '00000000-0000-0000-0000-000000000000' });
    chat = { tables: e ? `error: ${e.message}` : f.error ? `error: ${f.error.message}` : 'ok' };
  }
  chat.encryption_key = chatKeyReady() ? 'ok' : 'missing: set CHAT_KEY (64 hex characters) in Vercel, then redeploy';
  const push = pushIssue() || 'ok';
  // Assistant: key present, and one tiny live call so we know the key and model actually work.
  let assistant: string = process.env.ANTHROPIC_API_KEY ? 'key_set' : 'not_configured';
  if (process.env.ANTHROPIC_API_KEY && new URL(req.url).searchParams.get('ai') === '1' && burst('health-ai', 3, 60_000)) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: process.env.ASSISTANT_MODEL || 'claude-sonnet-5-5', max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] }),
      });
      assistant = r.ok ? 'working' : `error_${r.status}`;
    } catch { assistant = 'unreachable'; }
  }
  const auto_payouts = process.env.AUTO_PAYOUTS === '1' ? 'on' : 'off';
  const welcome_email = process.env.RESEND_API_KEY && process.env.EMAIL_FROM ? 'configured' : 'not_configured';

  const ok = Object.values(env).every(Boolean) && privy_jwks === 'ok' && profiles_table === 'ok' && notifications_table === 'ok'
    && Object.values(social).every((v) => v === 'ok') && media_bucket === 'ok' && edit4 === 'ok';
  const fix = ok ? null
    : Object.values(social).some((v) => v !== 'ok') ? 'Run supabase/migrations/0004_repair_posts_and_media.sql in Supabase → SQL Editor'
    : media_bucket !== 'ok' ? 'Media bucket missing: it is created automatically on the first image upload, or run supabase/migrations/0004_repair_posts_and_media.sql'
    : edit4 !== 'ok' ? 'Run supabase/migrations/0005_bookmarks_social_notifs_usernames.sql in Supabase → SQL Editor (bookmarks, social notifications, usernames)'
    : null;
  return NextResponse.json({ ok, service: 'callit-web', time: new Date().toISOString(), env, privy_jwks, privy_login, profiles_table, notifications_table, social_tables: social, assistant, auto_payouts, admin_by: process.env.ADMIN_WALLETS ? 'wallet' : process.env.ADMIN_HANDLES ? 'handle' : 'none', media_bucket, bookmarks_and_social_notifs: edit4, fix, welcome_email, chat, push });
}
