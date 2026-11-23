import { NextResponse } from 'next/server';
import { requireMe, json } from '@/lib/db/me';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIG = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/;

/**
 * POST { id, action: 'approve' | 'decline' | 'executed' | 'failed', signature? }
 * The only way an SI trade moves forward: the owner approves it here, then signs it in their own wallet
 * (the app runs the normal swap). 'executed' links the landed signature for the record.
 */
export async function POST(req: Request) {
  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  const b = (await req.json().catch(() => ({}))) as { id?: unknown; action?: unknown; signature?: unknown };
  if (typeof b.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(b.id)) return json({ error: 'invalid_id' }, 400);
  const { data: p } = await ctx.db.from('si_proposals').select('id, side, mint, sym, sol_amount, sell_pct, status, expires_at').eq('id', b.id).eq('profile_id', ctx.me.id).maybeSingle();
  if (!p) return json({ error: 'not_found' }, 404);
  const now = new Date().toISOString();

  if (b.action === 'approve') {
    if (p.status !== 'pending') return json({ error: `This trade is already ${p.status}.` }, 409);
    if (Date.parse(p.expires_at) < Date.now()) {
      await ctx.db.from('si_proposals').update({ status: 'expired', decided_at: now }).eq('id', p.id);
      return json({ error: 'This proposal expired. Ask SI again for fresh numbers.' }, 410);
    }
    const { data: ok } = await ctx.db.from('si_proposals').update({ status: 'approved', decided_at: now }).eq('id', p.id).eq('status', 'pending').select('id').maybeSingle();
    if (!ok) return json({ error: 'Already handled.' }, 409);
    return json({ proposal: { ...p, status: 'approved' } });
  }
  if (b.action === 'decline') {
    await ctx.db.from('si_proposals').update({ status: 'declined', decided_at: now }).eq('id', p.id).eq('status', 'pending');
    return json({ ok: true });
  }
  if (b.action === 'executed' || b.action === 'failed') {
    if (p.status !== 'approved') return json({ error: 'not_approved' }, 409);
    const sig = typeof b.signature === 'string' && SIG.test(b.signature) ? b.signature : null;
    await ctx.db.from('si_proposals').update({ status: b.action === 'executed' && sig ? 'executed' : 'failed', signature: sig }).eq('id', p.id);
    return json({ ok: true });
  }
  return json({ error: 'invalid_action' }, 400);
}
