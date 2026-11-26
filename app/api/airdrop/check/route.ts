import { dbOrNull, json } from '@/lib/db/me';
import { burst, clientIp } from '@/lib/ratelimit';
import { allocationsFor } from '@/lib/airdrop/data';
import { CALLIT_CUTOFF, COMMUNITIES, OPENS, POOLS, REF_MC, isWallet } from '@/lib/airdrop/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/airdrop/check?wallet=… — anyone can check any wallet. No wallet = just the rules.
 * Snapshot not loaded yet → { ready:false } so the page can say "results land at launch".
 */
export async function GET(req: Request) {
  const rules = { pools: POOLS, communities: COMMUNITIES, opens: OPENS, callitCutoff: CALLIT_CUTOFF, refMc: REF_MC };
  const wallet = new URL(req.url).searchParams.get('wallet')?.trim() || '';
  if (!wallet) return json({ rules });
  if (!isWallet(wallet)) return json({ error: 'That isn’t a Solana wallet address.' }, 400);
  if (!burst('adchk:' + clientIp(req), 30, 60_000)) return json({ error: 'Too many checks. Try again in a minute.' }, 429);
  const db = dbOrNull();
  if (!db) return json({ error: 'Checker is unavailable right now.' }, 503);
  const list = await allocationsFor(db, [wallet]).catch(() => undefined);
  if (list === undefined) return json({ error: 'Couldn’t check. Try again.' }, 500);
  if (list === null) return json({ rules, wallet, ready: false, allocations: [] });
  const { count } = await db.from('airdrop_allocations').select('id', { count: 'exact', head: true });
  return json({ rules, wallet, ready: (count || 0) > 0, allocations: list, total: list.reduce((s, a) => s + a.tokens, 0) });
}
