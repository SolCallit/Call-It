import { NextResponse } from 'next/server';
import { requireMe, maybeMe, dbOrNull, json } from '@/lib/db/me';
import { notifySocial, postOwner } from '@/lib/notify/social';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/posts/react?ref=<id> — counts for a built-in post (the pinned welcome post isn't a posts row). */
export async function GET(req: Request) {
  const ref = (new URL(req.url).searchParams.get('ref') || '').slice(0, 64);
  const db = dbOrNull();
  if (!db || !/^[A-Za-z0-9_-]{1,64}$/.test(ref)) return json({ likes: 0, reposts: 0, replies: 0 });
  const [re, rp] = await Promise.all([
    db.from('post_reactions').select('kind, profile_id').eq('post_ref', ref).limit(20000),
    db.from('post_replies').select('post_ref', { count: 'exact', head: true }).eq('post_ref', ref).is('deleted_at', null),
  ]);
  const rows = (re.data || []) as { kind: string; profile_id: string }[];
  const me = await maybeMe(req);
  return json({
    likes: rows.filter((x) => x.kind === 'like').length,
    reposts: rows.filter((x) => x.kind === 'repost').length,
    replies: rp.count || 0,
    liked: !!me && rows.some((x) => x.kind === 'like' && x.profile_id === me.id),
    reposted: !!me && rows.some((x) => x.kind === 'repost' && x.profile_id === me.id),
  });
}

/** POST /api/posts/react { ref, kind: 'like'|'repost', on: boolean } */
export async function POST(req: Request) {
  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  const b = (await req.json().catch(() => ({}))) as { ref?: unknown; kind?: unknown; on?: unknown };
  const ref = typeof b.ref === 'string' || typeof b.ref === 'number' ? String(b.ref).slice(0, 64) : '';
  if (!ref || (b.kind !== 'like' && b.kind !== 'repost')) return json({ error: 'invalid' }, 400);
  const row = { post_ref: ref, profile_id: ctx.me.id, kind: b.kind };
  const r = b.on
    ? await ctx.db.from('post_reactions').upsert(row, { onConflict: 'post_ref,profile_id,kind', ignoreDuplicates: true })
    : await ctx.db.from('post_reactions').delete().match(row);
  if (r.error) return json({ error: 'db_write', detail: r.error.message }, 500);
  if (b.on) {
    const owner = await postOwner(ctx.db, ref);
    if (owner) await notifySocial(ctx.db, ctx.me, b.kind === 'like' ? 'likes' : 'reposts', { profileId: owner.profileId }, { link: `#/post/${ref}`, snippet: owner.body });
  }
  return json({ ok: true });
}
