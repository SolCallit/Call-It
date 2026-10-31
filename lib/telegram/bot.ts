import 'server-only';
import { createHash } from 'node:crypto';

/** Telegram Bot API. Needs TELEGRAM_BOT_TOKEN (from @BotFather). */
export const botToken = () => (process.env.TELEGRAM_BOT_TOKEN || '').trim();

/** Secret Telegram sends back on every webhook call. Derived from the token, so there's one env var to set. */
export const webhookSecret = () => (botToken() ? createHash('sha256').update('callit-tg:' + botToken()).digest('hex').slice(0, 48) : '');

export async function tg<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T | null> {
  const t = botToken();
  if (!t) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${t}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), cache: 'no-store',
    });
    const j = (await r.json()) as { ok: boolean; result?: T; description?: string };
    if (!j.ok) { console.warn('[tg]', method, j.description); return null; }
    return j.result ?? null;
  } catch (e) {
    console.warn('[tg]', method, (e as Error).message);
    return null;
  }
}

let usernameP: Promise<string | null> | null = null;
export function botUsername(): Promise<string | null> {
  if (process.env.TELEGRAM_BOT_USERNAME) return Promise.resolve(process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, ''));
  usernameP ||= tg<{ username: string }>('getMe').then((m) => m?.username ?? null);
  return usernameP;
}

export const siteUrl = () => (process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.callit.buzz').replace(/\/$/, '');

/** HTML-escape for Telegram's parse_mode=HTML. */
export const h = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const B58 = /(?<![0-9A-Za-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![0-9A-Za-z])/g;
/** Solana addresses in a message: plain CAs and pump.fun / DexScreener / Birdeye / GMGN / Photon / Axiom links. */
export function findMints(text: string): string[] {
  const out: string[] = [];
  // Whole words only, so a transaction signature (87-88 chars) is never cut into a fake address.
  for (const m of text.match(B58) || []) if (!out.includes(m)) out.push(m);
  return out.slice(0, 3);
}
