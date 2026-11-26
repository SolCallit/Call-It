import { NextResponse } from 'next/server';
import { json, requireMe, str } from '@/lib/db/me';
import { allocationsFor } from '@/lib/airdrop/data';
import { CALL_MINT, xPost } from '@/lib/airdrop/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CAMPAIGN_START = process.env.AIRDROP_CAMPAIGN_START || '2026-11-29T00:00:00Z';

async function state(db: Parameters<typeof allocationsFor>[0], me: { id: string; wallet_address: string | null }) {
  const wallet = me.wallet_address || '';
  const [allocs, prof, claim, call] = await Promise.all([
    wallet ? allocationsFor(db, [wallet]) : Promise.resolve([]),
    db.from('profiles').select('x_handle').eq('id', me.id).maybeSingle(),
    wallet ? db.from('airdrop_claims').select('share_url, shared_at, unlocked_at, claimed_at, claim_tx').eq('profile_id', me.id).eq('wallet', wallet).maybeSingle() : Promise.resolve({ data: null, error: null }),
    CALL_MINT ? db.from('posts').select('id', { count: 'exact', head: true }).eq('profile_id', me.id).eq('mint', CALL_MINT).gte('created_at', CAMPAIGN_START) : Promise.resolve({ count: 0 }),
  ]);
  const c = (claim as { data: Record<string, string | null> | null }).data;
  return {
    wallet, migration: allocs !== null && !(claim as { error?: { code?: string } | null }).error?.code?.startsWith('42'),
    allocations: allocs || [], x: (prof.data?.x_handle as string | null) || null, mint: CALL_MINT || null,
    steps: { call: ((call as { count: number | null }).count || 0) > 0, share: !!c?.shared_at, unlock: !!c?.unlocked_at, claimed: !!c?.claimed_at },
    shareUrl: c?.share_url || null, claimTx: c?.claim_tx || null,
  };
}

/** GET /api/airdrop/me — the signed-in user's allocation and where they are in call → share → unlock. */
export async function GET(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  try { return json(await state(a.db, a.me)); } catch { return json({ error: 'Couldn’t load your airdrop. Try again.' }, 500); }
}

/**
 * POST /api/airdrop/me { action:'share', url } | { action:'unlock' } | { action:'claim' }
 * share: a post on X from the account linked to this profile. unlock: needs call + share done.
 * claim: opens on the pool's claim day; the Streamflow claim transaction is wired at launch.
 */
export async function POST(req: Request) {
  const a = await requireMe(req);
  if (a instanceof NextResponse) return a;
  const { db, me } = a;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const s = await state(db, me).catch(() => null);
  if (!s) return json({ error: 'Couldn’t load your airdrop. Try again.' }, 500);
  if (!s.wallet) return json({ error: 'Your Callit wallet isn’t set up yet.' }, 400);
  if (!s.allocations.length) return json({ error: 'This wallet has no allocation.' }, 400);
  const now = new Date().toISOString();
  if (b.action === 'share') {
    if (!s.x) return json({ error: 'connect_x', message: 'Connect your X account first.' }, 400);
    const url = xPost(str(b.url, 300), s.x);
    if (!url) return json({ error: `Paste the link to your post from @${s.x}.` }, 400);
    const { error } = await db.from('airdrop_claims').upsert({ profile_id: me.id, wallet: s.wallet, share_url: url, shared_at: now });
    if (error) return json({ error: 'Couldn’t save. Try again.' }, 500);
    return json(await state(db, me));
  }
  if (b.action === 'unlock') {
    if (!s.steps.call) return json({ error: 'Make your $CALL call on Callit first.' }, 400);
    if (!s.steps.share) return json({ error: 'Share your claim post on X first.' }, 400);
    const { error } = await db.from('airdrop_claims').update({ unlocked_at: now }).eq('profile_id', me.id).eq('wallet', s.wallet).is('unlocked_at', null);
    if (error) return json({ error: 'Couldn’t unlock. Try again.' }, 500);
    return json(await state(db, me));
  }
  if (b.action === 'claim') {
    if (!s.steps.unlock) return json({ error: 'Unlock your claim first.' }, 400);
    if (!s.allocations.some((x) => x.open)) return json({ error: 'Claims haven’t opened yet.' }, 400);
    return json({ error: 'Claiming switches on at launch.' }, 503);
  }
  return json({ error: 'invalid' }, 400);
}
