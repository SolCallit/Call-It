import { NextResponse } from 'next/server';
import { requireMe, json } from '@/lib/db/me';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/me — everything the app keeps for the signed-in user, in one round trip. */
export async function GET(req: Request) {
  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  const { db, me } = ctx;
  const [fo, mu, bl, li, wa, re, tx, fr] = await Promise.all([
    db.from('follows').select('target_handle').eq('profile_id', me.id),
    db.from('mutes').select('target_handle').eq('profile_id', me.id),
    db.from('blocks').select('target_handle').eq('profile_id', me.id),
    db.from('lists').select('id, name, list_members(target_handle)').eq('profile_id', me.id).order('created_at'),
    db.from('watchlist').select('token_key').eq('profile_id', me.id),
    db.from('post_reactions').select('post_ref, kind').eq('profile_id', me.id).order('created_at', { ascending: false }).limit(1000),
    db.from('transactions').select('kind, signature, in_mint, in_amount, out_mint, out_amount, usd_value, to_address, label, verified, created_at')
      .eq('profile_id', me.id).order('created_at', { ascending: false }).limit(100),
    db.from('follows').select('profile_id', { count: 'exact', head: true }).eq('target_handle', me.handle),
  ]);
  const h = (r: { data: { target_handle: string }[] | null }) => (r.data || []).map((x) => x.target_handle);
  return json({
    following: h(fo), muted: h(mu), blocked: h(bl),
    lists: (li.data || []).map((l: { id: string; name: string; list_members: { target_handle: string }[] }) => ({ id: l.id, name: l.name, members: l.list_members.map((m) => m.target_handle) })),
    watchlist: (wa.data || []).map((x: { token_key: string }) => x.token_key),
    reactions: re.data || [],
    transactions: tx.data || [],
    followers: fr.count || 0,
  });
}
