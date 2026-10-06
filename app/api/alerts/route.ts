import { NextResponse } from 'next/server';
import { requireMe, json } from '@/lib/db/me';
import { pushReady, pushIssue } from '@/lib/push/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEYS = ['follows', 'bells', 'wallets', 'milestones', 'quiet'] as const;

/** GET: my alert settings, token bells, tracked wallets and how many devices get pushes. */
export async function GET(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  const [p, b, w, d] = await Promise.all([
    a.db.from('alert_prefs').select('follows, bells, wallets, milestones, quiet').eq('profile_id', a.me.id).maybeSingle(),
    a.db.from('token_bells').select('mint, sym, pct, created_at').eq('profile_id', a.me.id).order('created_at', { ascending: false }),
    a.db.from('tracked_wallets').select('address, label, created_at').eq('profile_id', a.me.id).order('created_at', { ascending: false }),
    a.db.from('push_subs').select('endpoint', { count: 'exact', head: true }).eq('profile_id', a.me.id),
  ]);
  if (p.error && /alert_prefs/.test(p.error.message)) return json({ error: 'Run migration 0007 in Supabase first.' }, 503);
  return json({
    prefs: p.data || { follows: true, bells: true, wallets: true, milestones: true, quiet: false },
    bells: b.data || [], wallets: w.data || [], devices: d.count || 0, push: pushReady(), pushIssue: pushIssue(),
  });
}

/** PUT { follows?, bells?, wallets?, milestones?, quiet? } */
export async function PUT(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const row: Record<string, unknown> = { profile_id: a.me.id, updated_at: new Date().toISOString() };
  for (const k of KEYS) if (typeof b[k] === 'boolean') row[k] = b[k];
  const { error } = await a.db.from('alert_prefs').upsert(row, { onConflict: 'profile_id' });
  if (error) return json({ error: 'db_write', detail: error.message }, 500);
  return json({ ok: true });
}
