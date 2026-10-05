import { supabaseAdmin } from '@/lib/supabase/admin';
import { json } from '@/lib/db/me';
import { alertUsers, bellersOf, usd } from '@/lib/push/send';
import { jupMany, type LiveToken } from '@/lib/market/sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MILESTONES = [2, 3, 5, 10, 25, 50, 100];

async function prices(mints: string[]): Promise<Map<string, LiveToken>> {
  const out = new Map<string, LiveToken>();
  const u = [...new Set(mints)].slice(0, 300);
  for (let i = 0; i < u.length; i += 50) (await jupMany(u.slice(i, i + 50)).catch(() => [])).forEach((t) => out.set(t.mint, t));
  return out;
}

/**
 * GET /api/cron/alerts — run every minute (Supabase pg_cron). Checks:
 *  - token bells: price moved ≥ the user's % since the last alert
 *  - calls: hit 2x / 3x / 5x / 10x / ... since entry (caller + their followers)
 * Auth: header x-cron-secret (or ?key=) must equal CRON_SECRET.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET, u = new URL(req.url);
  const given = req.headers.get('x-cron-secret') || u.searchParams.get('key') || (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!secret || given !== secret) return json({ error: 'unauthorized' }, 401);
  const db = supabaseAdmin();
  if (!db) return json({ ok: false });

  const { data: bells } = await db.from('token_bells').select('profile_id, mint, sym, pct, base_price, base_at').limit(5000);
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const { data: calls } = await db.from('posts').select('id, mint, token_sym, entry_mc, profile_id, profiles!inner(handle)')
    .eq('kind', 'meme').is('deleted_at', null).gte('created_at', since).gt('entry_mc', 0).order('created_at', { ascending: false }).limit(500);

  const P = await prices([...(bells || []).map((b) => b.mint as string), ...(calls || []).map((c) => c.mint as string)]);
  let sent = 0;

  // Token bells
  const reset: { profile_id: string; mint: string; base_price: number }[] = [];
  for (const b of bells || []) {
    const t = P.get(b.mint as string);
    if (!t?.price) continue;
    const base = Number(b.base_price);
    if (!(base > 0)) { reset.push({ profile_id: b.profile_id as string, mint: b.mint as string, base_price: t.price }); continue; }
    const ch = (t.price / base - 1) * 100;
    if (Math.abs(ch) < Number(b.pct)) continue;
    const up = ch > 0, sym = t.sym || (b.sym as string) || 'token';
    sent += await alertUsers(db, [b.profile_id as string], 'bells', `b:${b.mint}:${b.base_at}`, {
      title: `${up ? '🚀' : '🔻'} $${sym} ${up ? 'up' : 'down'} ${Math.abs(ch).toFixed(ch > 100 ? 0 : 1)}%`,
      body: `Now ${usd(t.mc)} MC. Your 🔔 is set to ±${Number(b.pct)}%.`, link: `#/token/${b.mint}`, icon: t.icon,
    });
    reset.push({ profile_id: b.profile_id as string, mint: b.mint as string, base_price: t.price });
  }
  const now = new Date().toISOString();
  for (const r of reset) await db.from('token_bells').update({ base_price: r.base_price, base_at: now }).eq('profile_id', r.profile_id).eq('mint', r.mint);

  // Call milestones
  for (const c of calls || []) {
    const t = P.get(c.mint as string), entry = Number(c.entry_mc);
    if (!t?.mc || !(entry > 0)) continue;
    const x = t.mc / entry, hit = MILESTONES.filter((m) => x >= m).pop();
    if (!hit) continue;
    const handle = (c.profiles as unknown as { handle: string }).handle, sym = c.token_sym || t.sym || 'token';
    const fol = (await bellersOf(db, handle, 'calls')).filter((id) => id !== c.profile_id);
    const a = { link: `#/post/${c.id}`, icon: t.icon };
    sent += await alertUsers(db, [c.profile_id as string], 'milestones', `m:${c.id}:${hit}`, { ...a, title: `🚀 Your $${sym} call hit ${hit}x`, body: `Called at ${usd(entry)} MC → now ${usd(t.mc)}. Share it.` });
    sent += await alertUsers(db, fol, 'milestones', `m:${c.id}:${hit}`, { ...a, title: `🚀 @${handle}'s $${sym} call hit ${hit}x`, body: `Called at ${usd(entry)} MC → now ${usd(t.mc)}.` });
  }
  return json({ ok: true, bells: bells?.length || 0, calls: calls?.length || 0, sent });
}
