import { NextResponse } from 'next/server';
import { requireMe, dbOrNull, json, str, ownMediaUrl } from '@/lib/db/me';
import { notifySocial, notifyMentions, postOwner } from '@/lib/notify/social';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/posts/replies?ref=<post> — public replies, newest first. */
export async function GET(req: Request) {
  const db = dbOrNull();
  if (!db) return json({ replies: [] });
  const ref = (new URL(req.url).searchParams.get('ref') || '').slice(0, 64);
  if (!ref) return json({ error: 'invalid' }, 400);
  const { data, error } = await db.from('post_replies')
    .select('id, body, media, created_at, profiles!inner(handle, display_name, avatar_url)')
    .eq('post_ref', ref).is('deleted_at', null).order('created_at', { ascending: false }).limit(100);
  if (error) return json({ error: 'db_read', detail: error.message }, 500);
  const replies = (data || []).map((r: Record<string, unknown>) => {
    const p = r.profiles as { handle: string; display_name: string | null; avatar_url: string | null } | null;
    return { id: r.id, body: r.body, media: r.media, created_at: r.created_at, handle: p?.handle, display_name: p?.display_name ?? null, avatar_url: p?.avatar_url ?? null };
  });
  return json({ replies });
}

/** POST /api/posts/replies { ref, body, media[] } */
export async function POST(req: Request) {
  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ref = typeof b.ref === 'string' || typeof b.ref === 'number' ? String(b.ref).slice(0, 64) : '';
  const body = str(b.body, 280);
  const media = Array.isArray(b.media) ? b.media.filter(ownMediaUrl).slice(0, 4) : [];
  if (!ref || (!body && !media.length)) return json({ error: 'Write something first.' }, 400);
  const { data, error } = await ctx.db.from('post_replies').insert({ post_ref: ref, profile_id: ctx.me.id, body, media }).select('id, created_at').single();
  if (error) return json({ error: 'db_write', detail: error.message }, 500);
  const owner = await postOwner(ctx.db, ref);
  if (owner) await notifySocial(ctx.db, ctx.me, 'replies', { profileId: owner.profileId }, { link: `#/post/${ref}`, snippet: body || 'sent a photo' });
  // The post owner already got a reply notification, so don't also ping them for an @mention.
  if (body) await notifyMentions(ctx.db, ctx.me, body, `#/post/${ref}`, owner ? [owner.profileId] : []);
  return json({ reply: data });
}
