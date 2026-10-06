import { NextResponse } from 'next/server';
import { verifyPrivyToken } from '@/lib/auth/privy-server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const cut = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : null);

/** POST /api/wallet/errors: logs a failed transaction attempt for the admin panel. */
export async function POST(req: Request) {
  const uid = await verifyPrivyToken(req);
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const raw = b.raw && JSON.stringify(b.raw).length < 8000 ? b.raw : null;
  console.error('[tx-error]', b.action, b.stage, b.message);
  const db = supabaseAdmin();
  if (db) {
    await db.from('tx_errors').insert({
      privy_id: uid, wallet: cut(b.wallet, 64), action: cut(b.action, 20) || 'unknown', stage: cut(b.stage, 20),
      message: cut(b.message, 500), raw, user_agent: cut(req.headers.get('user-agent'), 300),
    }).then(({ error }) => { if (error) console.error('[tx-error] insert', error.message); });
  }
  return NextResponse.json({ ok: true });
}
