import { NextResponse } from 'next/server';
import { requireMe, json } from '@/lib/db/me';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/overview: users, trades and posts for the admin panel.
 * Access: signed-in users whose handle is in ADMIN_HANDLES (or wallet in ADMIN_WALLETS), comma-separated env vars.
 * ?ping=1 only checks access.
 */
export async function GET(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  const { db, me } = a;
  const handles = (process.env.ADMIN_HANDLES || '').toLowerCase().split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean);
  const wallets = (process.env.ADMIN_WALLETS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!handles.length && !wallets.length) return json({ error: 'Admin access isn’t set up yet' }, 403);
  const ok = handles.includes(me.handle.toLowerCase()) || (!!me.wallet_address && wallets.includes(me.wallet_address));
  if (!ok) return json({ error: 'This account isn’t an admin' }, 403);
  if (new URL(req.url).searchParams.get('ping')) return json({ ok: true });

  const d1 = new Date(Date.now() - 864e5).toISOString();
  const d7 = new Date(Date.now() - 7 * 864e5).toISOString();
  const cnt = (t: string, f?: (q: any) => any) => { let q: any = db.from(t).select('id', { count: 'exact', head: true }); if (f) q = f(q); return q.then((r: { count: number | null }) => r.count || 0); };
  const [users, users24h, users7d, posts, posts24h, txs24h, vol, ul, tl, pl] = await Promise.all([
    cnt('profiles'), cnt('profiles', (q) => q.gte('created_at', d1)), cnt('profiles', (q) => q.gte('created_at', d7)),
    cnt('posts', (q) => q.is('deleted_at', null)), cnt('posts', (q) => q.gte('created_at', d1)), cnt('transactions', (q) => q.gte('created_at', d1)),
    db.from('transactions').select('usd_value').gte('created_at', d1).limit(10000),
    db.from('profiles').select('id, handle, display_name, avatar_url, wallet_address, created_at').order('created_at', { ascending: false }).limit(80),
    db.from('transactions').select('id, profile_id, kind, label, signature, usd_value, verified, created_at').order('created_at', { ascending: false }).limit(100),
    db.from('posts').select('id, profile_id, kind, body, token_sym, entry_mc, buy_usd, created_at').is('deleted_at', null).order('created_at', { ascending: false }).limit(80),
  ]);
  const vol24h = (vol.data || []).reduce((s: number, r: { usd_value: number | null }) => s + (Number(r.usd_value) || 0), 0);
  const uids = new Set<string>([...(tl.data || []).map((x) => x.profile_id), ...(pl.data || []).map((x) => x.profile_id)]);
  const { data: more } = uids.size ? await db.from('profiles').select('id, handle').in('id', [...uids]) : { data: [] };
  const H = new Map<string, string>([...(ul.data || []), ...(more || [])].map((p) => [p.id as string, p.handle as string]));
  // per-user activity counts for the users list
  const ids = (ul.data || []).map((u) => u.id);
  const [pc, tc] = ids.length ? await Promise.all([
    db.from('posts').select('profile_id').in('profile_id', ids).is('deleted_at', null).limit(20000),
    db.from('transactions').select('profile_id').in('profile_id', ids).limit(20000),
  ]) : [{ data: [] }, { data: [] }];
  const count = (rows: { profile_id: string }[] | null) => { const m = new Map<string, number>(); (rows || []).forEach((r) => m.set(r.profile_id, (m.get(r.profile_id) || 0) + 1)); return m; };
  const PC = count(pc.data as { profile_id: string }[]), TC = count(tc.data as { profile_id: string }[]);
  return json({
    stats: { users, users24h, users7d, posts, posts24h, txs24h, vol24h },
    users: (ul.data || []).map((u) => ({ handle: u.handle, display_name: u.display_name, avatar_url: u.avatar_url, wallet_address: u.wallet_address, created_at: u.created_at, calls: PC.get(u.id) || 0, trades: TC.get(u.id) || 0 })),
    txs: (tl.data || []).map((x) => ({ ...x, profile_id: undefined, handle: H.get(x.profile_id) || null })),
    posts: (pl.data || []).map((x) => ({ ...x, profile_id: undefined, handle: H.get(x.profile_id) || null })),
  });
}
