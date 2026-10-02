import { NextResponse } from 'next/server';
import { requireMe, json } from '@/lib/db/me';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX = 5 * 1024 * 1024;

/**
 * POST /api/media { data: "data:image/...;base64,...", kind?: 'post'|'avatar'|'banner' }
 * Uploads one image to the public `media` bucket and returns its URL.
 */
export async function POST(req: Request) {
  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  const b = (await req.json().catch(() => ({}))) as { data?: unknown; kind?: unknown };
  const m = typeof b.data === 'string' ? /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(b.data) : null;
  if (!m) return json({ error: 'Images only (JPG, PNG, WebP or GIF).' }, 400);
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > MAX) return json({ error: 'Image is over 5 MB.' }, 413);
  const kind = b.kind === 'avatar' || b.kind === 'banner' ? b.kind : 'post';
  const path = `${ctx.me.id}/${kind}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${TYPES[m[1]]}`;
  const put = () => ctx.db.storage.from('media').upload(path, bytes, { contentType: m[1], cacheControl: '31536000', upsert: false });
  let up = await put();
  // Self-heal: create the public `media` bucket the first time it's missing, then retry once.
  if (up.error && /bucket not found/i.test(up.error.message)) {
    const mk = await ctx.db.storage.createBucket('media', { public: true, fileSizeLimit: MAX, allowedMimeTypes: Object.keys(TYPES) });
    if (mk.error && !/already exists/i.test(mk.error.message)) return json({ error: 'upload_failed', detail: mk.error.message }, 500);
    up = await put();
  }
  if (up.error) return json({ error: 'upload_failed', detail: up.error.message }, 500);
  const { data } = ctx.db.storage.from('media').getPublicUrl(path);
  return json({ url: data.publicUrl });
}
