import { NextResponse } from 'next/server';
import { requireMe, json } from '@/lib/db/me';
import { isMint } from '@/lib/market/sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { mint, sym, pct, price }: 🔔 a token (alert when price moves pct% from here, or someone calls it). */
export async function POST(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  const b = (await req.json().catch(() => ({}))) as { mint?: string; sym?: string; pct?: number; price?: number };
  if (!b.mint || !isMint(b.mint)) return json({ error: 'invalid_mint' }, 400);
  const { count } = await a.db.from('token_bells').select('mint', { count: 'exact', head: true }).eq('profile_id', a.me.id);
  if ((count || 0) >= 50) return json({ error: 'You can have up to 50 token bells.' }, 400);
  const pct = Math.min(500, Math.max(5, Number(b.pct) || 20));
  const { error } = await a.db.from('token_bells').upsert({
    profile_id: a.me.id, mint: b.mint, sym: String(b.sym || '').slice(0, 20) || null, pct,
    base_price: Number(b.price) > 0 ? Number(b.price) : null, base_at: new Date().toISOString(),
  }, { onConflict: 'profile_id,mint' });
  if (error) return json({ error: 'db_write', detail: error.message }, 500);
  return json({ ok: true, pct });
}

/** DELETE ?mint= */
export async function DELETE(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  const mint = new URL(req.url).searchParams.get('mint') || '';
  await a.db.from('token_bells').delete().eq('profile_id', a.me.id).eq('mint', mint);
  return json({ ok: true });
}
