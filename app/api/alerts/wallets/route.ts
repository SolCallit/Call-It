import { NextResponse } from 'next/server';
import { requireMe, json } from '@/lib/db/me';
import { isMint } from '@/lib/market/sources';
import { syncHeliusWebhook } from '@/lib/alerts/helius';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { address, label }: track an outside wallet's buys and sells. */
export async function POST(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  const b = (await req.json().catch(() => ({}))) as { address?: string; label?: string };
  const address = String(b.address || '').trim();
  if (!isMint(address)) return json({ error: 'That isn’t a Solana wallet address.' }, 400);
  const { count } = await a.db.from('tracked_wallets').select('address', { count: 'exact', head: true }).eq('profile_id', a.me.id);
  if ((count || 0) >= 30) return json({ error: 'You can track up to 30 wallets.' }, 400);
  const label = String(b.label || '').trim().slice(0, 30) || null;
  const { error } = await a.db.from('tracked_wallets').upsert({ profile_id: a.me.id, address, label }, { onConflict: 'profile_id,address' });
  if (error) return json({ error: 'db_write', detail: error.message }, 500);
  const sync = await syncHeliusWebhook(a.db, new URL(req.url).origin);
  return json({ ok: true, live: sync.ok, detail: sync.ok ? undefined : sync.detail });
}

/** DELETE ?address= */
export async function DELETE(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  const address = new URL(req.url).searchParams.get('address') || '';
  await a.db.from('tracked_wallets').delete().eq('profile_id', a.me.id).eq('address', address);
  await syncHeliusWebhook(a.db, new URL(req.url).origin);
  return json({ ok: true });
}
