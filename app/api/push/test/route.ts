import { NextResponse } from 'next/server';
import { requireMe, json } from '@/lib/db/me';
import { pushIssue, pushTo } from '@/lib/push/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST: sends a test pop-up to every device of the signed-in user and reports exactly what happened. */
export async function POST(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  const issue = pushIssue();
  if (issue) return json({ ok: false, reason: 'server', detail: issue });
  const { count, error } = await a.db.from('push_subs').select('endpoint', { count: 'exact', head: true }).eq('profile_id', a.me.id);
  if (error) return json({ ok: false, reason: 'db', detail: error.message });
  if (!count) return json({ ok: false, reason: 'no_device', detail: 'No device is saved for your account.' });
  const r = await pushTo(a.db, [a.me.id], { title: '🔔 Callit test', body: 'Notifications are working on this device.', link: '#/alerts', tag: 'callit-test' });
  return json({ ok: r.sent > 0, devices: count, ...r });
}
