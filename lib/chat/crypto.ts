import 'server-only';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * DMs and private groups are encrypted at rest with AES-256-GCM.
 * Each chat gets its own key, derived from CHAT_KEY + the chat id (HKDF), so one leaked
 * chat key exposes one chat, and a database dump alone exposes nothing.
 *
 * CHAT_KEY: 32+ random bytes, base64 or hex, set in Vercel. Never change it once chats
 * exist; old messages would no longer open. This is server-side encryption, not end-to-end:
 * the server can read messages to deliver them.
 */
const V = 'v1';

function master(): Buffer | null {
  const raw = (process.env.CHAT_KEY || '').trim();
  if (!raw) return null;
  const buf = /^[0-9a-f]+$/i.test(raw) && raw.length % 2 === 0 ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return buf.length >= 32 ? buf : null;
}

export const chatKeyReady = () => master() !== null;

function keyFor(chatId: string): Buffer {
  const m = master();
  if (!m) throw new Error('chat_key_missing');
  return Buffer.from(hkdfSync('sha256', m, Buffer.from(chatId), Buffer.from('callit-chat'), 32));
}

export function seal(chatId: string, text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyFor(chatId), iv);
  c.setAAD(Buffer.from(chatId));
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [V, iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

/** Returns null when the message can't be opened (wrong key, tampered, malformed). */
export function open(chatId: string, sealed: string): string | null {
  try {
    const [v, iv, tag, ct] = sealed.split(':');
    if (v !== V || !iv || !tag || ct === undefined) return null;
    const d = createDecipheriv('aes-256-gcm', keyFor(chatId), Buffer.from(iv, 'base64'));
    d.setAAD(Buffer.from(chatId));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
