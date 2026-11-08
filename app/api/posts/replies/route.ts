import { NextResponse } from 'next/server';
import { requireMe, dbOrNull, json, str, ownMediaUrl } from '@/lib/db/me';
import { notifySocial, notifyMentions, postOwner } from '@/lib/notify/social';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COLS = 'id, body, media, created_at, profiles!inner(handle, display_name, avatar_url)';
/** Migration 0022 adds parent_id. Until it's run, fall back to the flat shape instead of 500ing. */
const COLS_T = `${COLS}, parent_id`;
const missingParent = (m?: string) => /parent_id/i.test(m || '');

type Row = Record<string, unknown>;
const shape = (r: Row) => {
  const p = r.profiles as { handle: string; display_name: string | null; avatar_url: string | null } | null;
  return {
    id: r.id, body: r.body, media: r.media, created_at: r.created_at,
    parent_id: (r.parent_id as string | null) ?? null,
    handle: p?.handle, display_name: p?.display_name ?? null, avatar_url: p?.avatar_url ?? null,
  };
};

/**
 * GET /api/posts/replies?ref=<post>
 * Every reply on the post, newest first. Each carries parent_id, so the app can show
 * top-level replies with their responses collapsed underneath.
 */
export async function GET(req: Request) {
  const db = dbOrNull();
  if (!db) return json({ replies: [] });
  const ref = (new URL(req.url).searchParams.get('ref') || '').slice(0, 64);
  if (!ref) return json({ error: 'invalid' }, 400);

  const q = (cols: string) => db.from('post_replies').select(cols)
    .eq('post_ref', ref).is('deleted_at', null).order('created_at', { ascending: false }).limit(200);

  let { data, error } = await q(COLS_T);
  if (error && missingParent(error.message)) ({ data, error } = await q(COLS));
  if (error) return json({ error: 'db_read', detail: error.message }, 500);
  return json({ replies: ((data || []) as unknown as Row[]).map(shape) });
}

/**
 * POST /api/posts/replies { ref, body, media[], parent? }
 * `parent` is the id of the reply being answered. Threads stay one level deep: answering
 * a child attaches to the same top-level reply, so a conversation never runs off the screen.
 */
export async function POST(req: Request) {
  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ref = typeof b.ref === 'string' || typeof b.ref === 'number' ? String(b.ref).slice(0, 64) : '';
  const body = str(b.body, 280);
  const media = Array.isArray(b.media) ? b.media.filter(ownMediaUrl).slice(0, 4) : [];
  const parentIn = typeof b.parent === 'string' && /^[0-9a-f-]{36}$/i.test(b.parent) ? b.parent : null;
  if (!ref || (!body && !media.length)) return json({ error: 'Write something first.' }, 400);

  // Keep threads one level deep, and make sure the parent is really on this post.
  let parent: string | null = null;
  let parentOwner: string | null = null;
  if (parentIn) {
    const { data: p, error: pe } = await ctx.db.from('post_replies')
      .select('id, post_ref, parent_id, profile_id').eq('id', parentIn).is('deleted_at', null).maybeSingle();
    if (!pe && p && p.post_ref === ref) {
      parent = (p.parent_id as string | null) || (p.id as string);
      parentOwner = p.profile_id as string;
    }
  }

  const row: Record<string, unknown> = { post_ref: ref, profile_id: ctx.me.id, body, media };
  if (parent) row.parent_id = parent;
  let { data, error } = await ctx.db.from('post_replies').insert(row).select('id, created_at').single();
  if (error && parent && missingParent(error.message)) {
    delete row.parent_id; // migration 0022 not run yet: post it flat rather than lose the reply
    ({ data, error } = await ctx.db.from('post_replies').insert(row).select('id, created_at').single());
  }
  if (error) return json({ error: 'db_write', detail: error.message }, 500);

  const owner = await postOwner(ctx.db, ref);
  const told: string[] = [];
  if (owner) { await notifySocial(ctx.db, ctx.me, 'replies', { profileId: owner.profileId }, { link: `#/post/${ref}`, snippet: body || 'sent a photo' }); told.push(owner.profileId); }
  // Whoever you answered inside the thread hears about it too.
  if (parentOwner && !told.includes(parentOwner)) {
    await notifySocial(ctx.db, ctx.me, 'replies', { profileId: parentOwner }, { link: `#/post/${ref}`, snippet: body || 'sent a photo' });
    told.push(parentOwner);
  }
  if (body) await notifyMentions(ctx.db, ctx.me, body, `#/post/${ref}`, told);
  return json({ reply: { ...data, parent_id: parent } });
}
