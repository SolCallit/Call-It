import { NextResponse } from 'next/server';
import { requireMe, maybeMe, dbOrNull, json, isHandle, isMint, num, str, ownMediaUrl } from '@/lib/db/me';
import { jupMany } from '@/lib/market/sources';
import { PERP_MARKETS, isPerpMarket } from '@/lib/perps/markets';
import { notifyMentions } from '@/lib/notify/social';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HORIZONS = ['24 hours', '3 days', '7 days', '30 days'];
const KINDS = ['meme', 'perps', 'random'];

type Row = Record<string, unknown> & { id: string; profiles: { handle: string; display_name: string | null; avatar_url: string | null } | null };

/**
 * GET /api/posts?kind=meme|perps|random&handle=<h>&tag=<hashtag>&before=<iso>&limit=<n>
 * Public feed. With a token, also returns which posts the caller liked/reposted.
 */
export async function GET(req: Request) {
  const db = dbOrNull();
  if (!db) return json({ posts: [], configured: false });
  const sp = new URL(req.url).searchParams;
  const kind = sp.get('kind');
  const handle = sp.get('handle');
  const before = sp.get('before');
  // ids=<uuid,uuid,...>: specific posts (bookmarks that aren't in the latest page)
  const ids = (sp.get('ids') || '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 60);
  const limit = Math.min(Math.max(+(sp.get('limit') || 40) || 40, 1), 60);

  let q = db
    .from('posts')
    .select('*, profiles!inner(handle, display_name, avatar_url)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (kind && KINDS.includes(kind)) q = q.eq('kind', kind);
  if (handle && isHandle(handle)) q = q.eq('profiles.handle', handle);
  if (before && !Number.isNaN(Date.parse(before))) q = q.lt('created_at', before);
  if (ids.length) q = q.in('id', ids);
  // tag=<word>: posts containing #word (case-insensitive)
  const tag = (sp.get('tag') || '').replace(/^#/, '');
  if (/^[A-Za-z0-9_]{1,40}$/.test(tag)) q = q.ilike('body', `%#${tag.replace(/_/g, '\\_')}%`);

  const { data, error } = await q;
  if (error) return json({ error: 'db_read', detail: error.message }, 500);
  const rows = (data || []) as Row[];
  const rowIds = rows.map((r) => r.id);

  const counts: Record<string, { likes: number; reposts: number; replies: number }> = {};
  rowIds.forEach((id) => (counts[id] = { likes: 0, reposts: 0, replies: 0 }));
  if (rowIds.length) {
    const [re, rp] = await Promise.all([
      db.from('post_reactions').select('post_ref, kind').in('post_ref', rowIds),
      db.from('post_replies').select('post_ref').in('post_ref', rowIds).is('deleted_at', null),
    ]);
    (re.data || []).forEach((x: { post_ref: string; kind: string }) => {
      const c = counts[x.post_ref];
      if (c) x.kind === 'like' ? c.likes++ : c.reposts++;
    });
    (rp.data || []).forEach((x: { post_ref: string }) => counts[x.post_ref] && counts[x.post_ref].replies++);
  }

  const me = await maybeMe(req);
  const mine: Record<string, { liked?: boolean; reposted?: boolean }> = {};
  if (me && rowIds.length) {
    const { data: r } = await db.from('post_reactions').select('post_ref, kind').eq('profile_id', me.id).in('post_ref', rowIds);
    (r || []).forEach((x: { post_ref: string; kind: string }) => {
      mine[x.post_ref] = { ...(mine[x.post_ref] || {}), [x.kind === 'like' ? 'liked' : 'reposted']: true };
    });
  }

  const posts = rows.map(({ profiles, profile_id: _p, ...r }) => ({
    ...r,
    handle: profiles?.handle,
    display_name: profiles?.display_name ?? null,
    avatar_url: profiles?.avatar_url ?? null,
    ...counts[r.id],
    ...(mine[r.id] || {}),
  }));
  return json({ posts });
}

/** POST /api/posts — create a meme call, perps call or random post. Entries are stamped by the server. */
export async function POST(req: Request) {
  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  const { db, me } = ctx;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const kind = b.kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind)) return json({ error: 'Pick Meme, Perps or Random.' }, 400);
  const body = str(b.body, 280);
  const media = Array.isArray(b.media) ? b.media.filter(ownMediaUrl).slice(0, 4) : [];
  const horizon = typeof b.horizon === 'string' && HORIZONS.includes(b.horizon) ? b.horizon : '7 days';
  const row: Record<string, unknown> = { profile_id: me.id, kind, body, media };

  if (kind === 'meme') {
    if (!isMint(b.mint)) return json({ error: 'Pick a Solana token to call.' }, 400);
    if (body.length < 10) return json({ error: 'Say why, in at least 10 characters.' }, 400);
    const [t] = await jupMany([b.mint]).catch(() => []);
    if (!t || !t.mc) return json({ error: "Couldn't price this token right now. Try again in a moment." }, 422);
    const target = num(b.target_mc);
    if (target != null && !(target > t.mc)) return json({ error: 'Target must be above the current market cap.' }, 400);
    Object.assign(row, {
      mint: t.mint, token_sym: str(t.sym, 20), token_name: str(t.name, 60), chain: 'Solana',
      entry_mc: t.mc, target_mc: target, horizon,
    });
  }

  if (kind === 'perps') {
    if (!isPerpMarket(b.market)) return json({ error: 'Pick SOL, BTC or ETH.' }, 400);
    if (b.side !== 'long' && b.side !== 'short') return json({ error: 'Pick Long or Short.' }, 400);
    const lev = num(b.leverage);
    if (lev == null || lev < 1 || lev > 100) return json({ error: 'Leverage must be between 1x and 100x.' }, 400);
    if (body.length < 10) return json({ error: 'Say why, in at least 10 characters.' }, 400);
    const [t] = await jupMany([PERP_MARKETS[b.market].mint]).catch(() => []);
    if (!t || !t.price) return json({ error: "Couldn't price this market right now. Try again in a moment." }, 422);
    const entry = t.price, target = num(b.target), stop = num(b.stop), long = b.side === 'long';
    if (target != null && (long ? !(target > entry) : !(target < entry))) return json({ error: `Target must be ${long ? 'above' : 'below'} the entry price.` }, 400);
    if (stop != null && (long ? !(stop < entry) : !(stop > entry))) return json({ error: `Stop must be ${long ? 'below' : 'above'} the entry price.` }, 400);
    Object.assign(row, { perp_market: b.market, perp_side: b.side, perp_leverage: lev, perp_entry: entry, perp_target: target, perp_stop: stop, horizon });
  }

  if (kind === 'random' && !body && !media.length) return json({ error: 'Write something or add a photo.' }, 400);

  const { data, error } = await db.from('posts').insert(row).select('*').single();
  if (error) {
    if (/daily_post_limit/.test(error.message)) return json({ error: "You've hit today's posting limit. Try again tomorrow." }, 429);
    return json({ error: 'db_write', detail: error.message }, 500);
  }
  const { profile_id: _p, ...post } = data as Record<string, unknown>;
  if (body) await notifyMentions(db, me, body, `#/post/${(post as { id: string }).id}`);
  const { data: pr } = await db.from('profiles').select('display_name, avatar_url').eq('id', me.id).maybeSingle();
  return json({ post: { ...post, handle: me.handle, display_name: pr?.display_name ?? null, avatar_url: pr?.avatar_url ?? null, likes: 0, reposts: 0, replies: 0 } });
}

/** DELETE /api/posts?id=<uuid> — soft-deletes the caller's own post. */
export async function DELETE(req: Request) {
  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'invalid_id' }, 400);
  const { data, error } = await ctx.db.from('posts').update({ deleted_at: new Date().toISOString() })
    .eq('id', id).eq('profile_id', ctx.me.id).is('deleted_at', null).select('id');
  if (error) return json({ error: 'db_write', detail: error.message }, 500);
  if (!data?.length) return json({ error: 'not_found' }, 404);
  return json({ ok: true });
}
