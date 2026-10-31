import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

type WelcomeTarget = {
  profileId: string;
  handle: string;
  name: string | null;
  email: string | null;
  signupMethod: 'email' | 'google' | 'twitter' | 'wallet' | null;
};

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.callit.buzz';

/**
 * Welcomes a brand-new user:
 *  - everyone gets a welcome notification in their Callit inbox
 *  - users who signed up with email or Google also get a welcome email
 * Never throws: a failed welcome must not block sign-in.
 */
export async function welcomeNewUser(db: SupabaseClient, t: WelcomeTarget): Promise<void> {
  const tasks: PromiseLike<unknown>[] = [
    db.from('notifications').insert({
      profile_id: t.profileId,
      kind: 'welcome',
      title: 'Welcome to Callit',
      body: 'Your Solana wallet is ready and you hold the keys. Make your first call and get paid when people buy through it.',
      link: '#/home',
    }).then(({ error }) => {
      // 23505 = already welcomed (unique index); anything else is worth logging.
      if (error && error.code !== '23505') console.error('[welcome] notification failed:', error.message);
    }),
  ];

  if (t.email && (t.signupMethod === 'email' || t.signupMethod === 'google')) {
    tasks.push(sendWelcomeEmail(db, t));
  }
  await Promise.allSettled(tasks.map((t) => Promise.resolve(t)));
}

async function sendWelcomeEmail(db: SupabaseClient, t: WelcomeTarget): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM; // e.g. "Callit <hello@yourdomain.com>"
  if (!key || !from || !t.email) {
    console.warn('[welcome] email skipped: RESEND_API_KEY or EMAIL_FROM not set');
    return;
  }

  // Claim the send first so a retry or a race can't email twice.
  const claim = await db
    .from('profiles')
    .update({ welcome_email_sent_at: new Date().toISOString() })
    .eq('id', t.profileId)
    .is('welcome_email_sent_at', null)
    .select('id');
  if (claim.error || !claim.data?.length) return;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [t.email],
        subject: 'Welcome to Callit. Call it. Get paid.',
        html: welcomeHtml(t.name || t.handle, t.handle),
        text: welcomeText(t.name || t.handle, t.handle),
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      console.error('[welcome] email failed:', r.status, await r.text().catch(() => ''));
      // Release the claim so it can be retried on a later sign-in.
      await db.from('profiles').update({ welcome_email_sent_at: null }).eq('id', t.profileId);
    }
  } catch (e) {
    console.error('[welcome] email error:', e);
    await db.from('profiles').update({ welcome_email_sent_at: null }).eq('id', t.profileId);
  } finally {
    clearTimeout(timer);
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function welcomeText(name: string, handle: string) {
  return `Welcome to Callit, ${name}.

Your account @${handle} is live, and your Solana wallet is ready. You hold the keys.

How it works:
1. Find a token early.
2. Make a call: entry, target and your thesis, tracked in public.
3. Get paid when people buy through your call.

Make your first call: ${SITE}

Call it. Get paid.
The Callit team`;
}

function welcomeHtml(name: string, handle: string) {
  const n = esc(name), h = esc(handle);
  const step = (num: string, title: string, body: string) => `
    <tr><td style="padding:0 0 16px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
        <td width="36" valign="top"><div style="width:28px;height:28px;border-radius:14px;background:#10263A;color:#4DA8FF;font:700 14px/28px Arial,sans-serif;text-align:center">${num}</div></td>
        <td style="font:15px/1.5 Arial,sans-serif;color:#C9D6E2"><b style="color:#FFFFFF">${title}</b><br>${body}</td>
      </tr></table>
    </td></tr>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#06121C">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#06121C;padding:32px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0B1B27;border:1px solid #1E3A54;border-radius:20px">
      <tr><td style="padding:36px 32px 8px;text-align:center">
        <img src="${SITE}/icon-192.png" width="64" height="64" alt="Callit" style="border-radius:16px;display:inline-block">
        <h1 style="margin:20px 0 6px;font:800 30px/1.1 Arial,sans-serif;color:#FFFFFF;letter-spacing:-0.5px">Call it. Get paid.</h1>
        <p style="margin:0;font:16px/1.5 Arial,sans-serif;color:#8FA6BA">Welcome, ${n}. Your account <b style="color:#FFFFFF">@${h}</b> is live.</p>
      </td></tr>
      <tr><td style="padding:24px 32px 4px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${step('1', 'Your wallet is ready', 'We created a Solana wallet for you. You hold the keys, not us.')}
          ${step('2', 'Make a call', 'Post a token with your entry, target and thesis. Performance is tracked in public.')}
          ${step('3', 'Get paid', 'Earn caller fees when people buy through your call.')}
        </table>
      </td></tr>
      <tr><td style="padding:8px 32px 32px;text-align:center">
        <a href="${SITE}" style="display:inline-block;background:#FFFFFF;color:#0B1B27;font:700 16px Arial,sans-serif;text-decoration:none;padding:14px 32px;border-radius:999px">Make your first call</a>
      </td></tr>
    </table>
    <p style="margin:18px 0 0;font:12px/1.5 Arial,sans-serif;color:#5B7084">You're getting this because you just created a Callit account.<br>Crypto is risky. Calls are opinions, not financial advice.</p>
  </td></tr></table></body></html>`;
}
