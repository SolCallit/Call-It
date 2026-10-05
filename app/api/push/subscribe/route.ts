import { NextResponse } from 'next/server';
import { requireMe, json } from '@/lib/db/me';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: the public key the browser needs to subscribe. */
export async function GET() {
  return json({ key: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null });
}

/** POST { endpoint, keys: { p256dh, auth } }: saves this device for push alerts. */
export async function POST(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  const b = (await req.json().catch(() => ({}))) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!b.endpoint || !/^https:\/\//.test(b.endpoint) || !b.keys?.p256dh || !b.keys?.auth) return json({ error: 'invalid' }, 400);
  const { error } = await a.db.from('push_subs').upsert({
    endpoint: b.endpoint.slice(0, 1000), profile_id: a.me.id, p256dh: b.keys.p256dh.slice(0, 200), auth: b.keys.auth.slice(0, 100),
    ua: (req.headers.get('user-agent') || '').slice(0, 200),
  }, { onConflict: 'endpoint' });
  if (error) return json({ error: 'db_write', detail: error.message }, 500);
  return json({ ok: true });
}

/** DELETE { endpoint }: stop alerts on this device. */
export async function DELETE(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  const b = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (b.endpoint) await a.db.from('push_subs').delete().eq('endpoint', b.endpoint).eq('profile_id', a.me.id);
  return json({ ok: true });
}
