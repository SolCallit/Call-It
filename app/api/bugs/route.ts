import { NextResponse } from 'next/server';
import { dbOrNull, json, maybeMe, str } from '@/lib/db/me';
import { requireAdmin } from '@/lib/db/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS = ['bug', 'security', 'idea'];
/** A private key (base58, 64 bytes) or a 12/24-word phrase pasted next to "seed"/"key": refuse to store it. */
const SECRETISH = /\b[1-9A-HJ-NP-Za-km-z]{85,90}\b/;

/**
 * POST /api/bugs — anyone can report a bug, security issue or idea (signed-in users are attached).
 * Limit: 5 per hour per user (or per IP for guests).
 */
export async function POST(req: Request) {
  const db = dbOrNull();
  if (!db) return json({ error: 'Reports are unavailable right now.' }, 503);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = KINDS.includes(String(b.kind)) ? String(b.kind) : 'bug';
  const body = str(b.text, 2000);
  if (body.length < 10) return json({ error: 'Tell us a little more (at least 10 characters).' }, 400);
  if (SECRETISH.test(body)) return json({ error: 'That looks like a private key. Remove it, we never need it.' }, 400);

  const me = await maybeMe(req);
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 64) || null;
  const since = new Date(Date.now() - 3600_000).toISOString();
  let q = db.from('bug_reports').select('id', { count: 'exact', head: true }).gte('created_at', since);
  q = me ? q.eq('profile_id', me.id) : q.eq('ip', ip);
  const { count, error: ce } = await q;
  if (ce) return json({ error: ce.code === '42P01' ? 'Reports are not set up yet.' : 'Couldn’t send. Try again.' }, ce.code === '42P01' ? 503 : 500);
  if ((count || 0) >= 5) return json({ error: 'You’ve sent a few already. Try again in an hour.' }, 429);

  const { error } = await db.from('bug_reports').insert({
    profile_id: me?.id ?? null, kind, body,
    contact: str(b.contact, 120) || null, page: str(b.page, 200) || null,
    user_agent: str(b.ua, 300) || null, viewport: typeof b.w === 'number' ? Math.round(b.w) : null, ip,
  });
  if (error) return json({ error: 'Couldn’t send. Try again.' }, 500);
  return json({ ok: true });
}

/** GET /api/bugs — admins only: the latest 200 reports. */
export async function GET(req: Request) {
  const a = await requireAdmin(req);
  if (a instanceof NextResponse) return a;
  const { data, error } = await a.db.from('bug_reports')
    .select('id, kind, body, contact, page, user_agent, viewport, created_at, profile_id')
    .order('created_at', { ascending: false }).limit(200);
  if (error) return error.code === '42P01' ? json({ reports: [], migration: false }) : json({ error: error.message }, 500);
  const ids = [...new Set((data || []).map((r) => r.profile_id).filter(Boolean))] as string[];
  const { data: ps } = ids.length ? await a.db.from('profiles').select('id, handle').in('id', ids) : { data: [] };
  const H = new Map((ps || []).map((p) => [p.id as string, p.handle as string]));
  return json({ reports: (data || []).map(({ profile_id, ...r }) => ({ ...r, handle: profile_id ? H.get(profile_id) || null : null })) });
}
