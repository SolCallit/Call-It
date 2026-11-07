import { json } from '@/lib/db/me';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { burst } from '@/lib/ratelimit';
import { attestOn, canonical, hashOf, memoOnChain, type CallFacts } from '@/lib/calls/attest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/calls/verify?id=<call id> — public proof that a call's entry was never edited.
 *
 * Rebuilds the call's canonical line from the database, hashes it, pulls the memo back off Solana
 * and compares. No sign-in: anyone can check anyone's call, which is the point.
 */
export async function GET(req: Request) {
  if (!burst('verify', 30, 60_000)) return json({ error: 'Too many checks. Wait a minute.' }, 429);
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'invalid_id' }, 400);

  const db = supabaseAdmin();
  if (!db) return json({ error: 'unavailable' }, 503);
  const { data, error } = await db
    .from('posts')
    .select('id, kind, mint, token_sym, entry_mc, created_at, attest_sig, attest_hash, profiles(handle)')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) return json({ error: 'db_read' }, 500);
  if (!data || data.kind !== 'meme') return json({ error: 'not_a_call' }, 404);

  const row = data as unknown as { id: string; mint: string; token_sym: string | null; entry_mc: number; created_at: string; attest_sig: string | null; attest_hash: string | null; profiles: { handle: string } | { handle: string }[] | null };
  const handle = Array.isArray(row.profiles) ? row.profiles[0]?.handle : row.profiles?.handle;
  const facts: CallFacts = { id: row.id, mint: row.mint, token_sym: row.token_sym, entry_mc: row.entry_mc, created_at: row.created_at, handle: handle || '' };

  const call = { id: row.id, token: row.token_sym, mint: row.mint, entry_mc: Number(row.entry_mc), called_at: row.created_at, by: '@' + (handle || '') };
  if (!row.attest_sig) {
    return json({ verified: false, status: attestOn() ? 'pending' : 'off', reason: attestOn() ? 'This call has no receipt yet.' : 'On-chain receipts are not switched on.', call });
  }

  const expected = hashOf(facts);
  const chain = await memoOnChain(row.attest_sig);
  const onChainHash = chain?.memo?.match(/sha256 ([0-9a-f]{64})/)?.[1] || null;
  const verified = !!onChainHash && onChainHash === expected;

  return json({
    verified,
    status: chain ? (verified ? 'verified' : 'mismatch') : 'not_found',
    reason: !chain
      ? 'The receipt transaction is not visible on-chain yet.'
      : verified
        ? 'The entry on-chain matches this call exactly.'
        : 'The entry recorded on-chain does not match this call.',
    call,
    receipt: { signature: row.attest_sig, solscan: `https://solscan.io/tx/${row.attest_sig}`, slot: chain?.slot ?? null, block_time: chain?.blockTime ?? null, memo: chain?.memo ?? null },
    proof: { canonical: canonical(facts), sha256: expected, on_chain_sha256: onChainHash },
  });
}
