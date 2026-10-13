import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Burst limiter, per server instance. Cheap first line of defence against scripts hammering a route.
 * Serverless instances don't share memory, so this slows abuse rather than stopping it outright;
 * anything that costs money also uses dailyCount() below.
 */
const hits = new Map<string, number[]>();
export function burst(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) { hits.set(key, list); return false; }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  return true;
}

export const clientIp = (req: Request) =>
  (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';

/** Counts one use for today (UTC) in app_kv and returns the new total. Shared across all instances. */
export async function dailyCount(db: SupabaseClient, key: string): Promise<number> {
  const k = `rl:${key}:${new Date().toISOString().slice(0, 10)}`;
  const { data } = await db.from('app_kv').select('v').eq('k', k).maybeSingle();
  const n = (Number(data?.v) || 0) + 1;
  await db.from('app_kv').upsert({ k, v: String(n), updated_at: new Date().toISOString() });
  return n;
}
