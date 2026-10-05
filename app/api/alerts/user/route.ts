import { NextResponse } from 'next/server';
import { requireMe, json, isHandle } from '@/lib/db/me';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?handle= → my bell level on that profile ('all' | 'calls' | null). Without handle: all my profile bells. */
export async function GET(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  const h = new URL(req.url).searchParams.get('handle');
  if (h) {
    const { data } = await a.db.from('user_bells').select('level').eq('profile_id', a.me.id).eq('target_handle', h).maybeSingle();
    return json({ level: (data?.level as string) || null });
  }
  const { data } = await a.db.from('user_bells').select('target_handle, level').eq('profile_id', a.me.id).limit(500);
  return json({ bells: data || [] });
}

/** POST { handle, level: 'all' | 'calls' | 'off' } */
export async function POST(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  const b = (await req.json().catch(() => ({}))) as { handle?: string; level?: string };
  if (!isHandle(b.handle) || b.handle === a.me.handle) return json({ error: 'invalid_handle' }, 400);
  if (b.level === 'off') {
    await a.db.from('user_bells').delete().eq('profile_id', a.me.id).eq('target_handle', b.handle);
    return json({ ok: true, level: null });
  }
  const level = b.level === 'calls' ? 'calls' : 'all';
  const { error } = await a.db.from('user_bells').upsert({ profile_id: a.me.id, target_handle: b.handle, level }, { onConflict: 'profile_id,target_handle' });
  if (error) return json({ error: /user_bells/.test(error.message) ? 'Run migration 0008 in Supabase first.' : 'db_write', detail: error.message }, 500);
  return json({ ok: true, level });
}
