import { NextResponse } from 'next/server';
import { requireMe, dbOrNull, json, str, ownMediaUrl } from '@/lib/db/me';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/posts/replies?ref=<post> — public replies, newest first. */
export async function GET(req: Request) {
  const db = dbOrNull();
  if (!db) return json({ replies: [] });
  const ref = (new URL(req.url).searchParams.get('ref') || '').slice(0, 64);
  if (!ref) return json({ error: 'invalid' }, 400);
  const { data, error } = await db.from('post_replies')
    .select('id, body, media, created_at, profiles!inner(handle, avatar_url)')
    .eq('post_ref', ref).is('deleted_at', null).order('created_at', { ascending: false }).limit(100);
  if (error) return json({ error: 'db_read', detail: error.message }, 500);
  const replies = (data || []).map((r: Record<string, unknown>) => {
    const p = r.profiles as { handle: string; avatar_url: string | null } | null;
    return { id: r.id, body: r.body, media: r.media, created_at: r.created_at, handle: p?.handle, avatar_url: p?.avatar_url ?? null };
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
  return json({ reply: data });
}
