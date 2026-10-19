import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { callerShare, CALLER_MIN_X, JUP_CUT, CASHBACK_PCT, POINTS, MILESTONES, MOONSHOT_FROM_X, moonshotMinMc } from '@/lib/fees/model';

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

/**
 * Buyer cashback: a slice of the fee on every verified buy, credited right away as an earnings row
 * (kind 'cashback'). It only becomes payable once the buyer has enough points (see earning_ready).
 * Idempotent: keyed on "cb:" + the trade signature.
 */
export async function creditCashback(db: SupabaseClient): Promise<{ credited: number; usd: number }> {
  const since = new Date(Date.now() - 3 * 864e5).toISOString();
  const { data: buys, error } = await db.from('transactions').select('signature, profile_id, fee_usd')
    .eq('kind', 'buy').eq('verified', true).gt('fee_usd', 0).gte('created_at', since).limit(3000);
  if (error || !buys?.length) return { credited: 0, usd: 0 };
  const rows = (buys as { signature: string; profile_id: string; fee_usd: number }[]).map((b) => ({
    profile_id: b.profile_id, kind: 'cashback', call_id: null, tx_signature: 'cb:' + b.signature, bought_in: false,
    share_pct: CASHBACK_PCT, fee_usd: Number(b.fee_usd), usd: +(Number(b.fee_usd) * (1 - JUP_CUT) * (CASHBACK_PCT / 100)).toFixed(6),
  })).filter((r) => r.usd > 0);
  if (!rows.length) return { credited: 0, usd: 0 };
  const { error: e2 } = await db.from('earnings').upsert(rows, { onConflict: 'tx_signature', ignoreDuplicates: true });
  if (e2) { console.warn('[cashback]', e2.message); return { credited: 0, usd: 0 }; } // migration 0015 not run yet
  return { credited: rows.length, usd: rows.reduce((a, r) => a + r.usd, 0) };
}

/**
 * Points from verified facts only: trading volume through Callit, and calls that held 2X or hit target.
 * Each source has a unique ref, so re-running never double counts.
 */
export async function awardPoints(db: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - 3 * 864e5).toISOString();
  const rows: { profile_id: string; kind: string; amount: number; ref: string; note: string }[] = [];
  const { data: tx } = await db.from('transactions').select('signature, profile_id, kind, usd_value')
    .in('kind', ['buy', 'sell', 'swap']).eq('verified', true).gt('usd_value', 0).gte('created_at', since).limit(5000);
  for (const t of (tx || []) as { signature: string; profile_id: string; kind: string; usd_value: number }[]) {
    const amt = Math.min(POINTS.perTradeCap, +(Number(t.usd_value) * POINTS.perUsd).toFixed(2));
    if (amt > 0) rows.push({ profile_id: t.profile_id, kind: 'trade', amount: amt, ref: 't:' + t.signature, note: t.kind });
  }
  const { data: calls } = await db.from('posts').select('id, profile_id, token_sym, qualified_at, target_at')
    .eq('kind', 'meme').is('deleted_at', null).not('qualified_at', 'is', null).gte('qualified_at', since).limit(2000);
  for (const c of (calls || []) as { id: string; profile_id: string; token_sym: string | null; qualified_at: string; target_at: string | null }[]) {
    rows.push({ profile_id: c.profile_id, kind: 'call', amount: POINTS.qualified, ref: 'q:' + c.id, note: `$${c.token_sym || '?'} held 2X` });
    if (c.target_at) rows.push({ profile_id: c.profile_id, kind: 'call', amount: POINTS.target, ref: 'tg:' + c.id, note: `$${c.token_sym || '?'} hit target` });
  }
  // Targets can be hit long after 2X: pick up recent target hits too.
  const { data: tg } = await db.from('posts').select('id, profile_id, token_sym').eq('kind', 'meme').is('deleted_at', null)
    .not('target_at', 'is', null).gte('target_at', since).limit(2000);
  for (const c of (tg || []) as { id: string; profile_id: string; token_sym: string | null }[]) {
    rows.push({ profile_id: c.profile_id, kind: 'call', amount: POINTS.target, ref: 'tg:' + c.id, note: `$${c.token_sym || '?'} hit target` });
  }
  // Milestone points (5X … 10,000X). Runners can take weeks, so look back further than 3 days.
  const { data: runs } = await db.from('posts').select('id, profile_id, token_sym, peak_x, entry_mc')
    .eq('kind', 'meme').is('deleted_at', null).gte('peak_x', MILESTONES[0].x)
    .gte('created_at', new Date(Date.now() - 120 * 864e5).toISOString()).limit(3000);
  const minMc = moonshotMinMc();
  for (const c of (runs || []) as { id: string; profile_id: string; token_sym: string | null; peak_x: number; entry_mc: number | null }[]) {
    const px = Number(c.peak_x), peakMc = Number(c.entry_mc || 0) * px;
    for (const m of MILESTONES) {
      if (px < m.x) break;
      if (m.x >= MOONSHOT_FROM_X && !(peakMc >= minMc)) break;
      rows.push({ profile_id: c.profile_id, kind: 'call', amount: m.pts, ref: `m${m.x}:` + c.id, note: `$${c.token_sym || '?'} held ${m.x.toLocaleString('en-US')}X` });
    }
  }
  if (!rows.length) return 0;
  const uniq = [...new Map(rows.map((r) => [r.ref, r])).values()];
  let n = 0;
  for (let i = 0; i < uniq.length; i += 500) {
    const { error } = await db.from('points').upsert(uniq.slice(i, i + 500), { onConflict: 'ref', ignoreDuplicates: true });
    if (error) { console.warn('[points]', error.message); return n; }
    n += Math.min(500, uniq.length - i);
  }
  return n;
}
