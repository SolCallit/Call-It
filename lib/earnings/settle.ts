import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { callerShare, CALLER_MIN_X, JUP_CUT } from '@/lib/fees/model';

/**
 * Feeds this minute's MC readings into each call's rolling average (posts.x_avg / peak_x).
 * Runs inside /api/cron/alerts, which already priced every recent call.
 */
export async function sampleCalls(db: SupabaseClient, samples: { id: string; x: number }[]): Promise<boolean> {
  const ok = samples.filter((s) => Number.isFinite(s.x) && s.x > 0);
  if (!ok.length) return true;
  const { error } = await db.rpc('apply_call_x', { samples: ok });
  if (error) console.warn('[earnings] apply_call_x', error.message); // migration 0010 not run yet
  return !error;
}

type Call = {
  id: string; profile_id: string; mint: string; created_at: string; peak_x: number;
  buy_sig: string | null; qualified_at: string; target_at: string | null;
  profiles: { wallet_address: string | null } | null;
};
type Buy = { signature: string; profile_id: string; call_ref: string; fee_usd: number; created_at: string };

/**
 * Turns buys that came through qualified calls (held 2X) into caller earnings.
 * Idempotent: each trade's signature can only be credited once.
 */
export async function settleEarnings(db: SupabaseClient): Promise<{ credited: number; usd: number }> {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data: calls, error } = await db.from('posts')
    .select('id, profile_id, mint, created_at, peak_x, buy_sig, qualified_at, target_at, profiles!inner(wallet_address)')
    .eq('kind', 'meme').is('deleted_at', null).not('qualified_at', 'is', null).gte('created_at', since)
    .gte('peak_x', CALLER_MIN_X).limit(500);
  if (error || !calls?.length) return { credited: 0, usd: 0 };
  const byId = new Map((calls as unknown as Call[]).map((c) => [c.id, c]));

  const { data: buys } = await db.from('transactions')
    .select('signature, profile_id, call_ref, fee_usd, created_at')
    .eq('kind', 'buy').eq('verified', true).gt('fee_usd', 0).in('call_ref', [...byId.keys()]).limit(5000);
  if (!buys?.length) return { credited: 0, usd: 0 };

  // Skip trades already credited.
  const sigs = (buys as Buy[]).map((b) => b.signature);
  const { data: done } = await db.from('earnings').select('tx_signature').in('tx_signature', sigs);
  const seen = new Set((done || []).map((d: { tx_signature: string }) => d.tx_signature));

  // Did the caller sell this token before the target (or before 2X when there's no target)?
  const soldEarly = new Map<string, boolean>();
  async function sold(c: Call): Promise<boolean> {
    if (soldEarly.has(c.id)) return soldEarly.get(c.id)!;
    const until = c.target_at || c.qualified_at;
    const { data } = await db.from('transactions').select('signature')
      .eq('profile_id', c.profile_id).in('kind', ['sell', 'swap']).eq('in_mint', c.mint)
      .gte('created_at', c.created_at).lt('created_at', until).limit(1);
    const v = !!data?.length;
    soldEarly.set(c.id, v);
    return v;
  }

  const rows: Record<string, unknown>[] = [];
  for (const b of buys as Buy[]) {
    if (seen.has(b.signature)) continue;
    const c = byId.get(b.call_ref);
    if (!c || b.profile_id === c.profile_id) continue;          // your own buys never pay you
    if (!c.profiles?.wallet_address) continue;                   // nowhere to pay (e.g. a Telegram group's profile)
    if (Date.parse(b.created_at) < Date.parse(c.created_at)) continue;
    const boughtIn = !!c.buy_sig && !(await sold(c));
    const share = callerShare(Number(c.peak_x), boughtIn);
    const usd = Number(b.fee_usd) * (1 - JUP_CUT) * (share / 100);
    if (!(usd > 0)) continue;
    rows.push({ profile_id: c.profile_id, call_id: c.id, tx_signature: b.signature, bought_in: boughtIn, share_pct: share, fee_usd: Number(b.fee_usd), usd: +usd.toFixed(6) });
  }
  if (!rows.length) return { credited: 0, usd: 0 };
  const { error: e2 } = await db.from('earnings').upsert(rows, { onConflict: 'tx_signature', ignoreDuplicates: true });
  if (e2) { console.warn('[earnings] insert', e2.message); return { credited: 0, usd: 0 }; }
  return { credited: rows.length, usd: rows.reduce((a, r) => a + (r.usd as number), 0) };
}
