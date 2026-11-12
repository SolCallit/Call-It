import { NextResponse, after } from 'next/server';
import { requireMe, maybeMe, dbOrNull, json, isHandle, isMint, num, str, ownMediaUrl } from '@/lib/db/me';
import { jupMany } from '@/lib/market/sources';
import { PERP_MARKETS, isPerpMarket } from '@/lib/perps/markets';
import { notifyMentions, notifySocial, postOwner } from '@/lib/notify/social';
import { onNewCall } from '@/lib/alerts/triggers';

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
  // q=<text>: search calls and posts by ticker, token name or text. Only safe characters reach the filter.
  const term = (sp.get('q') || '').replace(/^[$#@]/, '').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 40);
  if (term.length >= 2) { const like = `"%${term}%"`; q = q.or(`token_sym.ilike.${like},token_name.ilike.${like},body.ilike.${like}`); }
  if (sp.get('calls') === '1') q = q.eq('kind', 'meme');
  // quote_of=<post id>: posts quoting that post
  const quoteOf = sp.get('quote_of') || '';
  if (/^([0-9a-f-]{36}|welcome)$/i.test(quoteOf)) q = q.eq('quote_ref', quoteOf);

  const { data, error } = await q;
  if (error) return json({ error: 'db_read', detail: error.message }, 500);
  const rows = (data || []) as Row[];
  const rowIds = rows.map((r) => r.id);

  const counts: Record<string, { likes: number; reposts: number; replies: number; quotes: number }> = {};
  rowIds.forEach((id) => (counts[id] = { likes: 0, reposts: 0, replies: 0, quotes: 0 }));
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
    // Quote counts (ignored until migration 0009 adds quote_ref).
    const qs = await db.from('posts').select('quote_ref').in('quote_ref', rowIds).is('deleted_at', null);
    if (!qs.error) (qs.data || []).forEach((x: { quote_ref: string }) => counts[x.quote_ref] && counts[x.quote_ref].quotes++);
  }

  const me = await maybeMe(req);
  const mine: Record<string, { liked?: boolean; reposted?: boolean }> = {};
  if (me && rowIds.length) {
    const { data: r } = await db.from('post_reactions').select('post_ref, kind').eq('profile_id', me.id).in('post_ref', rowIds);
    (r || []).forEach((x: { post_ref: string; kind: string }) => {
      mine[x.post_ref] = { ...(mine[x.post_ref] || {}), [x.kind === 'like' ? 'liked' : 'reposted']: true };
    });
  }

  // Did the caller sell after calling? Sum their Callit sells of the token since the call vs what they bought.
  // sold_x is the exit price as a multiple of the caller's own entry price, fixed at the moment they sold;
  // sold_usd is what the sells brought in. Both stay put while the token keeps moving.
  const sold: Record<string, { pct: number; at: string; x: number | null; usd: number | null }> = {};
  const memes = rows.filter((r) => r.kind === 'meme' && r.mint && Number(r.buy_usd) > 0);
  if (memes.length) {
    const owners = [...new Set(memes.map((r) => r.profile_id as string))];
    const mints = [...new Set(memes.map((r) => r.mint as string))];
    const { data: tx } = await db.from('transactions')
      .select('profile_id, kind, in_mint, in_amount, out_mint, out_amount, usd_value, created_at')
      .in('profile_id', owners).in('kind', ['buy', 'sell'])
      .or(`in_mint.in.(${mints.join(',')}),out_mint.in.(${mints.join(',')})`)
      .order('created_at', { ascending: true }).limit(2000);
    for (const r of memes) {
      const since = Date.parse(r.created_at as string) - 10 * 60e3; // buy-in can land just before the post
      let bought = 0, sell = 0, at = '', buyUsd = 0, sellUsd = 0, priced = true;
      for (const t of (tx || []) as { profile_id: string; kind: string; in_mint: string; in_amount: number; out_mint: string; out_amount: number; usd_value: number | null; created_at: string }[]) {
        if (t.profile_id !== r.profile_id || Date.parse(t.created_at) < since) continue;
        const usd = Number(t.usd_value) || 0;
        if (t.kind === 'buy' && t.out_mint === r.mint) { bought += Number(t.out_amount) || 0; buyUsd += usd; if (!usd) priced = false; }
        if (t.kind === 'sell' && t.in_mint === r.mint) { sell += Number(t.in_amount) || 0; sellUsd += usd; at = t.created_at; if (!usd) priced = false; }
      }
      if (sell > 0) {
        const ok = priced && bought > 0 && buyUsd > 0 && sellUsd > 0;
        const x = ok ? (sellUsd / sell) / (buyUsd / bought) : null;
        sold[r.id] = {
          pct: bought > 0 ? Math.min(100, Math.round((sell / bought) * 100)) : 100, at,
          x: x && Number.isFinite(x) && x > 0 && x < 1e6 ? Math.round(x * 1e4) / 1e4 : null,
          usd: sellUsd > 0 && priced ? Math.round(sellUsd * 100) / 100 : null,
        };
      }
    }
  }

  // What a call brought in: verified buys by OTHER people through the call's Buy button, and what the caller
  // earned from them. Only the caller sees this on their own calls (NEXT_PUBLIC_CALL_VOLUME=public shows it to all).
  const pubVol = (process.env.NEXT_PUBLIC_CALL_VOLUME || '').trim().toLowerCase() === 'public';
  const brought: Record<string, { usd: number; buyers: number; earned: number }> = {};
  const volFor = rows.filter((r) => r.kind === 'meme' && (pubVol || (me && r.profile_id === me.id)));
  if (volFor.length) {
    const ids = volFor.map((r) => r.id as string), owner = new Map(volFor.map((r) => [r.id as string, r.profile_id as string]));
    const [{ data: bt }, { data: er }] = await Promise.all([
      db.from('transactions').select('profile_id, call_ref, usd_value').eq('kind', 'buy').eq('verified', true).in('call_ref', ids).limit(5000),
      db.from('earnings').select('call_id, usd').in('call_id', ids).limit(5000),
    ]);
    const who: Record<string, Set<string>> = {};
    for (const t of (bt || []) as { profile_id: string; call_ref: string; usd_value: number | null }[]) {
      if (t.profile_id === owner.get(t.call_ref)) continue; // your own buys never count
      const b = (brought[t.call_ref] ||= { usd: 0, buyers: 0, earned: 0 });
      b.usd += Number(t.usd_value) || 0;
      (who[t.call_ref] ||= new Set()).add(t.profile_id);
    }
    for (const e of (er || []) as { call_id: string; usd: number }[]) (brought[e.call_id] ||= { usd: 0, buyers: 0, earned: 0 }).earned += Number(e.usd) || 0;
    for (const id of Object.keys(brought)) {
      const b = brought[id];
      b.buyers = who[id]?.size || 0; b.usd = Math.round(b.usd * 100) / 100; b.earned = Math.round(b.earned * 100) / 100;
    }
    for (const id of ids) brought[id] ||= { usd: 0, buyers: 0, earned: 0 };
  }

  const posts = rows.map(({ profiles, profile_id: _p, ...r }) => ({
    brought: brought[r.id] ?? null,
    ...r,
    sold_pct: sold[r.id]?.pct ?? null,
    sold_at: sold[r.id]?.at ?? null,
    sold_x: sold[r.id]?.x ?? null,
    sold_usd: sold[r.id]?.usd ?? null,
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
  // Quote another post (a call or a regular post) with your own take.
  if (typeof b.quote_ref === 'string' && /^([0-9a-f-]{36}|welcome)$/i.test(b.quote_ref)) row.quote_ref = b.quote_ref;

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

  let { data, error } = await db.from('posts').insert(row).select('*').single();
  // Migration 0009 not run yet: post anyway, without the quote.
  let quoteSaved = !!row.quote_ref;
  if (error && /quote_ref/.test(error.message)) { delete row.quote_ref; quoteSaved = false; ({ data, error } = await db.from('posts').insert(row).select('*').single()); }
  if (error) {
    if (/daily_post_limit/.test(error.message)) return json({ error: "You've hit today's posting limit. Try again tomorrow." }, 429);
    return json({ error: 'db_write', detail: error.message }, 500);
  }
  const { profile_id: _p, ...post } = data as Record<string, unknown>;
  if (body) await notifyMentions(db, me, body, `#/post/${(post as { id: string }).id}`);
  // Tell the quoted post's author.
  if (quoteSaved && typeof b.quote_ref === 'string') {
    const owner = await postOwner(db, b.quote_ref);
    if (owner) await notifySocial(db, me, 'quotes', { profileId: owner.profileId }, { link: `#/post/${(post as { id: string }).id}`, snippet: body });
  }
  after(() => onNewCall(db, me, post as { id: string; kind: string; mint?: string | null; token_sym?: string | null; entry_mc?: number | null; body?: string | null }).catch(() => {}));
  const { data: pr } = await db.from('profiles').select('display_name, avatar_url').eq('id', me.id).maybeSingle();
  return json({ quoteSaved: typeof b.quote_ref === 'string' ? quoteSaved : undefined, post: { ...post, handle: me.handle, display_name: pr?.display_name ?? null, avatar_url: pr?.avatar_url ?? null, likes: 0, reposts: 0, replies: 0 } });
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
