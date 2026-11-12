import { NextResponse } from 'next/server';
import { isMint } from '@/lib/market/sources';
import { heliusKey } from '@/lib/solana/rpc';
import { solPrice } from '@/lib/payouts/payout';
import { holderPnl, type HTx, type HolderPnl } from '@/lib/market/holderpnl';

export const runtime = 'nodejs';
export const maxDuration = 30;

type Out = { rows: Record<string, HolderPnl>; solUsd: number | null; at: number };
const CACHE = new Map<string, Out>();
const TTL = 10 * 60_000;
const ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function history(wallet: string, key: string): Promise<HTx[] | null> {
  try {
    const r = await fetch(`https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${key}&limit=100`, { cache: 'no-store', signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    const j = (await r.json()) as unknown;
    return Array.isArray(j) ? (j as HTx[]) : null;
  } catch { return null; }
}

/**
 * GET /api/market/holders/<mint>?w=<wallet,...>&held=<tokens,...>
 * For up to 20 holder wallets: what each paid for this token (average entry, bought, sold), read
 * from the wallet's last 100 transactions. Wallets whose buys are older than that come back
 * without an average. Cached 10 minutes per token: each wallet costs one Helius call.
 */
export async function GET(req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  if (!isMint(mint)) return NextResponse.json({ error: 'invalid_mint' }, { status: 400 });
  const sp = new URL(req.url).searchParams;
  const ws = (sp.get('w') || '').split(',').filter((x) => ADDR.test(x)).slice(0, 20);
  const held = (sp.get('held') || '').split(',').map(Number);
  const headers = { 'cache-control': 'public, s-maxage=600, stale-while-revalidate=1800' };
  const key = heliusKey();
  if (!ws.length || !key) return NextResponse.json({ rows: {}, solUsd: null }, { headers });

  const hit = CACHE.get(mint);
  const fresh = hit && Date.now() - hit.at < TTL ? hit : null;
  const rows: Record<string, HolderPnl> = { ...(fresh?.rows || {}) };
  const todo = ws.filter((w) => !rows[w]);
  const solUsd = fresh?.solUsd ?? (await solPrice());
  if (todo.length && solUsd) {
    // Five at a time keeps us well inside Helius' rate limit.
    for (let i = 0; i < todo.length; i += 5) {
      await Promise.all(todo.slice(i, i + 5).map(async (w) => {
        const txs = await history(w, key);
        if (txs) rows[w] = holderPnl(txs, w, mint, solUsd, Number(held[ws.indexOf(w)]) || 0);
      }));
    }
    CACHE.set(mint, { rows, solUsd, at: fresh?.at ?? Date.now() });
    if (CACHE.size > 300) CACHE.delete(CACHE.keys().next().value as string);
  }
  return NextResponse.json({ rows: Object.fromEntries(ws.filter((w) => rows[w]).map((w) => [w, rows[w]])), solUsd }, { headers });
}
