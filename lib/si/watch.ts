import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { jupMany, type LiveToken } from '@/lib/market/sources';
import { balances } from '@/lib/si/portfolio';
import { pushTo } from '@/lib/push/send';

/* ---------- SI watch: proactive flags on what you hold ----------
   Rules, not a model call: cheap enough to run for every opted-in user every few minutes, and every flag
   is a plain fact ("liquidity down 46% since the last check"). The model only gets involved when the
   user taps a flag and asks SI to explain it. One flag per user, token and kind per day (dedupe key). */

export type FlagKind = 'dump' | 'pump' | 'liquidity' | 'authority' | 'concentration' | 'danger';
export type Flag = { kind: FlagKind; severity: 1 | 2 | 3; title: string; detail: string; data: Record<string, unknown> };

const usd = (v: number | null | undefined) => v == null ? '—' : '$' + (v >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(2));

/** Pure rules for one holding. `prev` is the last snapshot of the token (for liquidity pulls). */
export function rulesFor(t: LiveToken, valueUsd: number, weightPct: number, prev: { liq: number | null } | null, risk: string): Flag[] {
  const f: Flag[] = [];
  const h1 = t.chg.h1, sym = '$' + t.sym;
  if (h1 != null && h1 <= -25) f.push({ kind: 'dump', severity: h1 <= -50 ? 3 : 2, title: `${sym} down ${Math.abs(h1).toFixed(0)}% in 1h`, detail: `Your ${usd(valueUsd)} position. MC now ${usd(t.mc)}.`, data: { h1, mc: t.mc } });
  if (h1 != null && h1 >= 60) f.push({ kind: 'pump', severity: 1, title: `${sym} up ${h1.toFixed(0)}% in 1h`, detail: `Your position is now ${usd(valueUsd)}. Time to think about taking some off?`, data: { h1, mc: t.mc } });
  if (prev?.liq && t.liq != null && t.liq < prev.liq * 0.6) {
    const drop = (1 - t.liq / prev.liq) * 100;
    f.push({ kind: 'liquidity', severity: drop >= 70 ? 3 : 2, title: `${sym} liquidity down ${drop.toFixed(0)}%`, detail: `From ${usd(prev.liq)} to ${usd(t.liq)} since the last check. Thin liquidity means big slippage when you sell.`, data: { from: prev.liq, to: t.liq } });
  }
  if (t.audit.mintOff === false || t.audit.freezeOff === false) {
    const which = [t.audit.mintOff === false ? 'mint' : '', t.audit.freezeOff === false ? 'freeze' : ''].filter(Boolean).join(' and ');
    f.push({ kind: 'authority', severity: 3, title: `${sym}: ${which} authority is on`, detail: `The team can ${t.audit.mintOff === false ? 'print more tokens' : ''}${which.includes('and') ? ' and ' : ''}${t.audit.freezeOff === false ? 'freeze your tokens' : ''}.`, data: { mintOff: t.audit.mintOff, freezeOff: t.audit.freezeOff } });
  }
  const capW = risk === 'careful' ? 25 : risk === 'degen' ? 70 : 40;
  if (weightPct >= capW && valueUsd >= 50) f.push({ kind: 'concentration', severity: 1, title: `${sym} is ${weightPct.toFixed(0)}% of your wallet`, detail: `That's above the ${capW}% SI keeps an eye on for a ${risk} setup.`, data: { weight: weightPct } });
  if (t.audit.sus) f.push({ kind: 'danger', severity: 3, title: `${sym} flagged suspicious`, detail: 'Jupiter marks this token as suspicious. Check it before adding more.', data: {} });
  return f;
}

/** Runs for up to `limit` opted-in users, least recently checked first. Called from the per-minute cron. */
export async function runWatch(db: SupabaseClient, limit = 25, budgetMs = 15_000): Promise<{ users: number; flags: number; pushed: number } | { skipped: string }> {
  const t0 = Date.now();
  const { data: rows, error } = await db.from('si_profiles').select('profile_id, risk, watched_at, profiles!inner(wallet_address)')
    .eq('watch', true).order('watched_at', { ascending: true, nullsFirst: true }).limit(limit);
  if (error) return { skipped: /does not exist|schema cache/i.test(error.message) ? 'run migration 0026' : error.message };
  let users = 0, flags = 0, pushed = 0;
  for (const r of (rows || []) as unknown as { profile_id: string; risk: string; profiles: { wallet_address: string | null } }[]) {
    if (Date.now() - t0 > budgetMs) break;
    await db.from('si_profiles').update({ watched_at: new Date().toISOString() }).eq('profile_id', r.profile_id);
    const w = r.profiles?.wallet_address;
    if (!w) continue;
    users++;
    try {
      const { sol, tokens } = await balances(w);
      const mints = [...tokens.keys()].slice(0, 50);
      if (!mints.length) continue;
      const priced = await jupMany(['So11111111111111111111111111111111111111112', ...mints]).catch(() => [] as LiveToken[]);
      const by = new Map(priced.map((t) => [t.mint, t]));
      const solPx = by.get('So11111111111111111111111111111111111111112')?.price || 0;
      const vals = mints.map((m) => ({ m, v: (tokens.get(m) || 0) * (by.get(m)?.price || 0) }));
      const total = sol * solPx + vals.reduce((a, x) => a + x.v, 0);
      const { data: marks } = await db.from('si_marks').select('mint, liq').in('mint', mints);
      const prev = new Map((marks || []).map((x) => [x.mint as string, { liq: x.liq == null ? null : Number(x.liq) }]));
      const day = new Date().toISOString().slice(0, 10);
      const out: Record<string, unknown>[] = [];
      for (const { m, v } of vals) {
        const t = by.get(m);
        if (!t || v < 5) continue;                       // dust isn't worth a ping
        for (const fl of rulesFor(t, v, total ? (v / total) * 100 : 0, prev.get(m) || null, r.risk)) {
          out.push({ profile_id: r.profile_id, mint: m, sym: t.sym, kind: fl.kind, severity: fl.severity, title: fl.title, detail: fl.detail, data: fl.data, dedupe: `${r.profile_id}:${m}:${fl.kind}:${day}` });
        }
      }
      await db.from('si_marks').upsert(vals.filter((x) => by.get(x.m)).map((x) => ({ mint: x.m, liq: by.get(x.m)!.liq, price: by.get(x.m)!.price, at: new Date().toISOString() })), { onConflict: 'mint' });
      if (!out.length) continue;
      const { data: fresh } = await db.from('si_flags').upsert(out, { onConflict: 'dedupe', ignoreDuplicates: true }).select('title, detail, severity, mint');
      flags += fresh?.length || 0;
      // Push only the most serious new one, so SI never spams.
      const top = (fresh || []).sort((a, b) => Number(b.severity) - Number(a.severity))[0];
      if (top && Number(top.severity) >= 2) {
        const res = await pushTo(db, [r.profile_id], { title: `SI: ${top.title}`, body: String(top.detail), link: '#/assistant', tag: 'si-flag' }).catch(() => null);
        pushed += res?.sent || 0;
      }
    } catch (e) {
      console.warn('[si-watch]', (e as Error).message);
    }
  }
  return { users, flags, pushed };
}
