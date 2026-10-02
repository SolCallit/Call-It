import { NextResponse } from 'next/server';
import { requireMe, json } from '@/lib/db/me';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  return json({ ok: true });
}
