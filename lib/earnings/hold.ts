import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HOLD, JUP_CUT, holdOn, holdPct } from '@/lib/fees/model';
import { rpc } from '@/lib/solana/rpc';
import { jupMany } from '@/lib/market/sources';
import { alertUsers, usd as fmt } from '@/lib/push/send';

/**
 * Hold bonus engine (see HOLD in lib/fees/model.ts). Runs every minute from /api/cron/alerts.
 * 1. Opens a hold for each call that just hit its target, if the caller bought in and didn't sell before target.
 * 2. Every HOLD.sampleMin minutes, checks the caller's on-chain balance of the token and adds held time.
 * 3. Sold out (anywhere, not just on Callit) or HOLD.windowDays after target: locks the bonus and credits it.
 * Survives an unrun migration 0024: every query failure just returns quietly.
 */

type Post = {
  id: string; profile_id: string; mint: string; token_sym: string | null; created_at: string; target_at: string;
  entry_mc: number | null; target_mc: number | null; x_avg: number | null; buy_sig: string | null;
  profiles: { wallet_address: string | null } | null;
};
type Hold = {
  call_id: string; profile_id: string; started_at: string; last_at: string; held_min: number; max_ui: number;
  posts: Post | null;
};

const POST_COLS = 'id, profile_id, mint, token_sym, created_at, target_at, entry_mc, target_mc, x_avg, buy_sig, profiles!inner(wallet_address)';

async function balance(owner: string, mint: string): Promise<number | null> {
  try {
    const r = await rpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }[] }>(
      'getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    return (r.value || []).reduce((a, v) => a + (Number(v.account.data.parsed.info.tokenAmount.uiAmount) || 0), 0);
  } catch { return null; }
}

/** Sum of fees on other users' verified buys through this call. */
async function callFees(db: SupabaseClient, p: Post): Promise<number> {
  const { data } = await db.from('transactions').select('fee_usd')
    .eq('call_ref', p.id).eq('kind', 'buy').eq('verified', true).gt('fee_usd', 0)
    .neq('profile_id', p.profile_id).gte('created_at', p.created_at).limit(10000);
  return (data || []).reduce((a: number, r: { fee_usd: number }) => a + Number(r.fee_usd), 0);
}

async function soldBeforeTarget(db: SupabaseClient, p: Post): Promise<boolean> {
  const { data } = await db.from('transactions').select('signature')
    .eq('profile_id', p.profile_id).in('kind', ['sell', 'swap']).eq('in_mint', p.mint)
    .gte('created_at', p.created_at).lt('created_at', p.target_at).limit(1);
  return !!data?.length;
}

export async function runHolds(db: SupabaseClient): Promise<{ opened: number; checked: number; settled: number } | null> {
  if (!holdOn()) return null;
  const now = Date.now(), nowIso = new Date(now).toISOString();
  let opened = 0, checked = 0, settled = 0;

  // 1. Open holds for fresh target hits.
  const since = new Date(now - HOLD.windowDays * 864e5).toISOString();
  const { data: hits, error } = await db.from('posts').select(POST_COLS)
    .eq('kind', 'meme').is('deleted_at', null).not('target_at', 'is', null).not('buy_sig', 'is', null)
    .gte('target_at', since).limit(500);
  if (error) return null;
  const list = (hits || []) as unknown as Post[];
  if (list.length) {
    const { data: have, error: e2 } = await db.from('call_holds').select('call_id').in('call_id', list.map((p) => p.id));
    if (e2) return null; // migration 0024 not run yet
    const seen = new Set((have || []).map((h: { call_id: string }) => h.call_id));
    for (const p of list) {
      if (seen.has(p.id) || !p.profiles?.wallet_address) continue;
      const early = await soldBeforeTarget(db, p);
      const recent = now - Date.parse(p.target_at) < 15 * 60_000;
      const row = {
        call_id: p.id, profile_id: p.profile_id, started_at: p.target_at, last_at: recent ? p.target_at : nowIso,
        status: early ? 'void' : 'open', note: early ? 'sold before target' : null,
      };
      const { error: e3 } = await db.from('call_holds').upsert(row, { onConflict: 'call_id', ignoreDuplicates: true });
      if (e3) continue;
      opened++;
      if (!early) {
        await alertUsers(db, [p.profile_id], 'milestones', `hold:${p.id}`, {
          title: `🎯 $${p.token_sym || 'token'} hit your target. You got paid.`,
          body: `Keep holding $${HOLD.minUsd}+ and stack up to +${HOLD.maxPct}% more on every buy your call brought in. Sell and it locks.`,
          link: '#/you',
        }).catch(() => 0);
      }
    }
  }

  // 2. Check open holds that are due.
  const due = new Date(now - HOLD.sampleMin * 60_000 + 20_000).toISOString();
  const { data: open } = await db.from('call_holds')
    .select(`call_id, profile_id, started_at, last_at, held_min, max_ui, posts!inner(${POST_COLS})`)
    .eq('status', 'open').lte('last_at', due).order('last_at', { ascending: true }).limit(60);
  const holds = (open || []) as unknown as Hold[];
  if (!holds.length) return { opened, checked, settled };

  const mints = [...new Set(holds.map((h) => h.posts?.mint).filter(Boolean) as string[])];
  const price = new Map<string, { price: number | null; mc: number | null }>();
  for (let i = 0; i < mints.length; i += 50) {
    (await jupMany(mints.slice(i, i + 50)).catch(() => [])).forEach((t) => price.set(t.mint, { price: t.price, mc: t.mc }));
  }

  for (const h of holds) {
    const p = h.posts, wallet = p?.profiles?.wallet_address;
    if (!p || !wallet) continue;
    const t = price.get(p.mint);
    const ui = await balance(wallet, p.mint);
    if (ui == null || !t?.price) continue; // can't see it right now: try again next run, no time lost or gained
    checked++;
    const value = ui * t.price;
    const maxUi = Math.max(Number(h.max_ui) || 0, ui);
    const frac = maxUi > 0 ? Math.min(1, ui / maxUi) : 0;
    const entry = Number(p.entry_mc) || 0, tgt = Number(p.target_mc) || 0;
    const targetX = entry > 0 && tgt > 0 ? tgt / entry : 2;
    const xNow = Number(p.x_avg) > 0 ? Number(p.x_avg) : entry > 0 && t.mc ? t.mc / entry : 0;
    const keep = Math.min(1, Math.max(0, xNow / targetX));
    const mins = Math.min(15, Math.max(0, (now - Date.parse(h.last_at)) / 60_000));
    const held = Number(h.held_min) + (value >= HOLD.minUsd ? mins * frac * keep : 0);
    const pct = holdPct(held);
    const soldOut = !(value >= 1);
    const expired = now >= Date.parse(h.started_at) + HOLD.windowDays * 864e5;

    if (!soldOut && !expired) {
      await db.from('call_holds').update({ last_at: nowIso, held_min: held, max_ui: maxUi, last_ui: ui, last_usd: value, bonus_pct: pct }).eq('call_id', h.call_id).eq('status', 'open');
      continue;
    }
    // 3. Lock it in.
    const fees = await callFees(db, p);
    const bonus = +(fees * (1 - JUP_CUT) * (pct / 100)).toFixed(6);
    if (bonus > 0) {
      const { error: e4 } = await db.from('earnings').upsert({
        profile_id: p.profile_id, kind: 'hold', call_id: p.id, tx_signature: 'hold:' + p.id, bought_in: true,
        share_pct: pct, fee_usd: fees, usd: bonus,
      }, { onConflict: 'tx_signature', ignoreDuplicates: true });
      if (e4) { console.warn('[hold] credit', e4.message); continue; }
    }
    await db.from('call_holds').update({
      status: 'settled', settled_at: nowIso, last_at: nowIso, held_min: held, max_ui: maxUi, last_ui: ui, last_usd: value,
      bonus_pct: pct, bonus_usd: bonus, note: soldOut ? 'sold' : 'window ended',
    }).eq('call_id', h.call_id).eq('status', 'open');
    settled++;
    if (bonus > 0) {
      await alertUsers(db, [p.profile_id], 'milestones', `holdx:${p.id}`, {
        title: `💰 Hold bonus locked: +${pct.toFixed(1)}% on $${p.token_sym || 'token'}`,
        body: `${fmt(bonus)} added to your earnings. Claim it from YOU.`, link: '#/you',
      }).catch(() => 0);
    }
  }
  return { opened, checked, settled };
}
