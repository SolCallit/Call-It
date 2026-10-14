import 'server-only';
import { createHmac } from 'node:crypto';
import { SUPABASE_URL } from '@/lib/config';

/**
 * Live call signalling rides Supabase Realtime "broadcast" (no database rows, free tier).
 *
 * - Every signed-in person listens on a private ring channel whose name is an HMAC of their
 *   profile id, so nobody can guess someone else's channel and ring or snoop on them.
 * - Each call gets its own channel named after the call's random id, handed only to members.
 *
 * Audio and video never touch Callit's servers: they go device to device over WebRTC,
 * encrypted end to end (DTLS-SRTP).
 */
const secret = () => process.env.CHAT_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export function ringTopic(profileId: string): string | null {
  const s = secret();
  if (!s) return null;
  return 'ring-' + createHmac('sha256', s).update('ring:' + profileId).digest('hex').slice(0, 32);
}

export const callTopic = (callId: string) => 'call-' + callId;

/** Server → browsers. Sends one event to many ring channels in a single request. Never throws. */
export async function broadcast(topics: string[], event: string, payload: Record<string, unknown>): Promise<boolean> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !key || !topics.length) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: topics.map((topic) => ({ topic, event, payload })) }),
      signal: AbortSignal.timeout(4000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * ICE servers for WebRTC. STUN works on most home Wi-Fi; mobile data (carrier NAT) usually
 * needs a TURN relay, which is optional and set in Vercel:
 *   TURN_URLS        comma separated, e.g. turn:global.relay.metered.ca:80,turns:global.relay.metered.ca:443?transport=tcp
 *   TURN_USERNAME
 *   TURN_CREDENTIAL
 */
export function iceServers(): RTCIceServer[] {
  const out: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  const urls = (process.env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (urls.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    out.push({ urls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  }
  return out;
}

type RTCIceServer = { urls: string | string[]; username?: string; credential?: string };
