import { NextResponse } from 'next/server';
import { verifyPrivyToken, getPrivyUser } from '@/lib/auth/privy-server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toHandle } from '@/lib/auth/handle';
import type { CallitProfile } from '@/lib/auth/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Called by the client right after Privy sign-in.
 * Verifies the Privy token, then creates or refreshes the user's Callit profile.
 */
export async function POST(req: Request) {
  const privyId = await verifyPrivyToken(req);
  if (!privyId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const info = await getPrivyUser(privyId);
  const db = supabaseAdmin();

  // No database yet: still let the user in with a derived profile.
  if (!db) {
    const p: CallitProfile = {
      id: privyId, privy_id: privyId, handle: toHandle(info.xUsername || info.emailLocal, info.solanaWallet),
      display_name: info.name, bio: null, website: null, x_handle: info.xUsername, avatar_url: null, banner_url: null,
      wallet_address: info.solanaWallet,
    };
    return NextResponse.json({ profile: p, isNew: false, persisted: false });
  }

  const existing = await db.from('profiles').select('*').eq('privy_id', privyId).maybeSingle();
  if (existing.error) return NextResponse.json({ error: 'db_read', detail: existing.error.message }, { status: 500 });

  if (existing.data) {
    const patch: Record<string, unknown> = {};
    if (info.solanaWallet && existing.data.wallet_address !== info.solanaWallet) patch.wallet_address = info.solanaWallet;
    if (Object.keys(patch).length) {
      const up = await db.from('profiles').update(patch).eq('privy_id', privyId).select('*').single();
      if (!up.error) return NextResponse.json({ profile: up.data, isNew: false, persisted: true });
    }
    return NextResponse.json({ profile: existing.data, isNew: false, persisted: true });
  }

  // New user: pick a unique handle.
  const base = toHandle(info.xUsername || info.emailLocal, info.solanaWallet);
  for (let i = 0; i < 6; i++) {
    const handle = i === 0 ? base : (base.slice(0, 16) + Math.floor(100 + Math.random() * 900)).slice(0, 20);
    const ins = await db
      .from('profiles')
      .insert({ privy_id: privyId, handle, display_name: info.name, x_handle: info.xUsername, wallet_address: info.solanaWallet })
      .select('*')
      .single();
    if (!ins.error) return NextResponse.json({ profile: ins.data, isNew: true, persisted: true });
    if (ins.error.code !== '23505') return NextResponse.json({ error: 'db_write', detail: ins.error.message }, { status: 500 });
    // 23505 = unique violation. If it was privy_id (race), read it back; otherwise try another handle.
    const again = await db.from('profiles').select('*').eq('privy_id', privyId).maybeSingle();
    if (again.data) return NextResponse.json({ profile: again.data, isNew: false, persisted: true });
  }
  return NextResponse.json({ error: 'handle_taken' }, { status: 409 });
}
