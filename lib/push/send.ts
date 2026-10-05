import 'server-only';
import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';

export type Alert = { title: string; body: string; link: string; tag?: string; icon?: string | null };
export type Pref = 'follows' | 'bells' | 'wallets' | 'milestones';

let ready: boolean | null = null;
export function pushReady(): boolean {
  if (ready !== null) return ready;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return (ready = false);
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:alerts@callit.app', pub, priv);
  return (ready = true);
}

const HOURLY_CAP = 40;

/**
 * Sends one alert to many users: respects their prefs and quiet mode, dedupes on `key`,
 * caps each user at 40 pushes an hour, also drops it in their in-app notifications.
 * Never throws.
 */
export async function alertUsers(db: SupabaseClient, ids: string[], pref: Pref, key: string, a: Alert): Promise<number> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return 0;
  try {
    const { data: prefs } = await db.from('alert_prefs').select('profile_id, follows, bells, wallets, milestones, quiet').in('profile_id', uniq);
    const P = new Map((prefs || []).map((p) => [p.profile_id as string, p as Record<string, boolean>]));
    let ok = uniq.filter((id) => { const p = P.get(id); return !p || (p[pref] !== false && !p.quiet); });
    if (!ok.length) return 0;

    // Dedupe: insert the key; users who already had it are skipped.
    const { data: fresh } = await db.from('alert_log').upsert(ok.map((profile_id) => ({ profile_id, key })), { onConflict: 'profile_id,key', ignoreDuplicates: true }).select('profile_id');
    ok = (fresh || []).map((r) => r.profile_id as string);
    if (!ok.length) return 0;

    // Rate limit.
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { data: recent } = await db.from('alert_log').select('profile_id').in('profile_id', ok).gte('created_at', since).limit(5000);
    const count = new Map<string, number>();
    (recent || []).forEach((r) => count.set(r.profile_id as string, (count.get(r.profile_id as string) || 0) + 1));
    ok = ok.filter((id) => (count.get(id) || 0) <= HOURLY_CAP);
    if (!ok.length) return 0;

    await db.from('notifications').insert(ok.map((profile_id) => ({ profile_id, kind: 'alerts', title: a.title.slice(0, 140), body: a.body.slice(0, 400), link: a.link })));

    if (!pushReady()) return ok.length;
    const { data: subs } = await db.from('push_subs').select('endpoint, p256dh, auth').in('profile_id', ok);
    const payload = JSON.stringify({ title: a.title, body: a.body, link: a.link, tag: a.tag || key, icon: a.icon || '/icon-192.png' });
    const dead: string[] = [];
    await Promise.all((subs || []).map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth as string } }, payload, { TTL: 3600, urgency: 'high' })
        .catch((e: { statusCode?: number }) => { if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.endpoint as string); })));
    if (dead.length) await db.from('push_subs').delete().in('endpoint', dead);
    return ok.length;
  } catch (e) {
    console.warn('[push] alertUsers failed', (e as Error).message);
    return 0;
  }
}

/** Profile ids of everyone following a handle. */
export async function followersOf(db: SupabaseClient, handle: string): Promise<string[]> {
  const { data } = await db.from('follows').select('profile_id').eq('target_handle', handle).limit(5000);
  return (data || []).map((r) => r.profile_id as string);
}

/** Profile ids with a 🔔 on this token. */
export async function bellsOn(db: SupabaseClient, mint: string): Promise<string[]> {
  const { data } = await db.from('token_bells').select('profile_id').eq('mint', mint).limit(5000);
  return (data || []).map((r) => r.profile_id as string);
}

export const usd = (v: number | null | undefined) => v == null || !isFinite(v) ? '' : v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(v < 1 ? 4 : 2)}`;

/** Profile ids who rang the 🔔 on a handle. level 'calls' = calls only; 'all' = calls, trades and posts. */
export async function bellersOf(db: SupabaseClient, handle: string, need: 'calls' | 'all'): Promise<string[]> {
  let q = db.from('user_bells').select('profile_id').eq('target_handle', handle).limit(5000);
  if (need === 'all') q = q.eq('level', 'all');
  const { data, error } = await q;
  if (error) return [];
  return (data || []).map((r) => r.profile_id as string);
}
