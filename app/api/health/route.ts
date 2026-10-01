import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PRIVY_APP_ID } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Uptime + config check. Open /api/health in a browser.
 * Reports which pieces are configured and reachable. Never returns secret values.
 */
export async function GET() {
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
      headers: { 'privy-app-id': PRIVY_APP_ID, origin: process.env.NEXT_PUBLIC_SITE_URL || 'https://call-it-chi.vercel.app' },
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
  const db = supabaseAdmin();
  if (db) {
    const q = await db.from('profiles').select('id', { count: 'exact', head: true });
    profiles_table = q.error ? `error: ${q.error.message}` : 'ok';
  }

  const ok = Object.values(env).every(Boolean) && privy_jwks === 'ok' && profiles_table === 'ok';
  return NextResponse.json({ ok, service: 'callit-web', time: new Date().toISOString(), env, privy_jwks, privy_login, profiles_table });
}
