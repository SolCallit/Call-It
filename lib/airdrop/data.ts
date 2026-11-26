import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OPENS, usdAtRef, type Pool } from './config';

export type Alloc = { pool: Pool; community: string; tier: number; rank: number | null; tokens: number; usd: number; opensAt: string; open: boolean };

/** Allocations for a set of wallets. Returns null when the table isn't there yet (migration pending). */
export async function allocationsFor(db: SupabaseClient, wallets: string[]): Promise<Alloc[] | null> {
  if (!wallets.length) return [];
  const { data, error } = await db.from('airdrop_allocations').select('pool, community, tier, rank, tokens').in('wallet', wallets);
  if (error) { if (error.code === '42P01') return null; throw error; }
  const now = Date.now();
  return (data || []).map((r) => {
    const pool = r.pool as Pool, tokens = Number(r.tokens);
    return { pool, community: r.community || '', tier: r.tier, rank: r.rank ?? null, tokens, usd: Math.round(usdAtRef(tokens)), opensAt: OPENS[pool], open: Date.parse(OPENS[pool]) <= now };
  }).sort((a, b) => b.tokens - a.tokens);
}
