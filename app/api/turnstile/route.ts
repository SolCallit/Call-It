import { NextRequest, NextResponse } from 'next/server';
import { burst, clientIp } from '@/lib/ratelimit';

export const runtime = 'nodejs';

/**
 * POST /api/turnstile { token } -> { ok }
 * Checks a Cloudflare Turnstile token from the sign-in sheet. With no TURNSTILE_SECRET_KEY set the
 * check is off and always passes, so sign-in never breaks while the keys aren't configured.
 */
export async function POST(req: NextRequest) {
  const secret = (process.env.TURNSTILE_SECRET_KEY || '').trim();
  if (!secret) return NextResponse.json({ ok: true, off: true });
  if (!burst(`turnstile:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ ok: false, error: 'Too many tries. Wait a minute.' }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { token?: string } | null;
  const token = body?.token;
  if (!token || typeof token !== 'string' || token.length > 4096) return NextResponse.json({ ok: false, error: 'missing_token' }, { status: 400 });
  try {
    const form = new URLSearchParams({ secret, response: token });
    const ip = clientIp(req);
    if (ip) form.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form, signal: AbortSignal.timeout(8000) });
    const j = (await r.json().catch(() => null)) as { success?: boolean; 'error-codes'?: string[] } | null;
    if (j?.success) return NextResponse.json({ ok: true });
    return NextResponse.json({ ok: false, error: (j?.['error-codes'] || []).join(',') || 'failed' }, { status: 403 });
  } catch {
    // Cloudflare unreachable: don't lock real people out of their wallets.
    return NextResponse.json({ ok: true, degraded: true });
  }
}
