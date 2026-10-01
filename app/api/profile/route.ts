import { NextResponse } from 'next/server';
import { verifyPrivyToken } from '@/lib/auth/privy-server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) || null : undefined);

/** Updates the signed-in user's own profile text fields. */
export async function PATCH(req: Request) {
  const privyId = await verifyPrivyToken(req);
  if (!privyId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, string | null> = {};
  const f: [string, number][] = [['display_name', 40], ['bio', 160], ['website', 80], ['x_handle', 30]];
  for (const [k, max] of f) {
    const v = clean(body[k], max);
    if (v !== undefined) patch[k] = k === 'x_handle' && v ? v.replace(/^@/, '') : v;
  }
  if (patch.website && !/^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(patch.website)) {
    return NextResponse.json({ error: 'invalid_website' }, { status: 400 });
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });

  const { data, error } = await db.from('profiles').update(patch).eq('privy_id', privyId).select('*').single();
  if (error) return NextResponse.json({ error: 'db_write', detail: error.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}
