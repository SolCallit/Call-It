import { NextResponse } from 'next/server';
import { requireMe, json } from '@/lib/db/me';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { log_id, rating: 1 | -1, note? } — thumbs on an SI reply. Thumbs-down become eval cases (scripts/si-eval/mine.ts). */
export async function POST(req: Request) {
  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  const b = (await req.json().catch(() => ({}))) as { log_id?: unknown; rating?: unknown; note?: unknown };
  if (typeof b.log_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(b.log_id) || (b.rating !== 1 && b.rating !== -1)) return json({ error: 'invalid' }, 400);
  const { data: log } = await ctx.db.from('si_logs').select('id').eq('id', b.log_id).eq('profile_id', ctx.me.id).maybeSingle();
  if (!log) return json({ error: 'not_found' }, 404);
  const { error } = await ctx.db.from('si_feedback').upsert({
    log_id: b.log_id, profile_id: ctx.me.id, rating: b.rating,
    note: typeof b.note === 'string' ? b.note.trim().slice(0, 500) || null : null,
  }, { onConflict: 'log_id' });
  return error ? json({ error: 'save_failed' }, 500) : json({ ok: true });
}
