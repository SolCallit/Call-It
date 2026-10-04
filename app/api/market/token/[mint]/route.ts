import { NextResponse } from 'next/server';
import { isMint, liveToken } from '@/lib/market/sources';
import { rpcUrl, TOKEN_2022_PROGRAM } from '@/lib/solana/rpc';

export const runtime = 'nodejs';

type Tax = { bps: number; t22: boolean };
const TAX = new Map<string, { v: Tax | null; at: number }>();

/** Token-2022 transfer fee ("token tax") from on-chain mint extensions via Helius DAS. Cached ~10 min. */
async function taxOf(mint: string): Promise<Tax | null> {
  const hit = TAX.get(mint);
  if (hit && Date.now() - hit.at < 600_000) return hit.v;
  const url = rpcUrl();
  if (!/helius/.test(url)) return null;
  let v: Tax | null = null;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'tax', method: 'getAsset', params: { id: mint } }),
      signal: AbortSignal.timeout(2500),
    });
    const j = (await r.json()) as { result?: { token_info?: { token_program?: string }; mint_extensions?: { transfer_fee_config?: { newer_transfer_fee?: { transfer_fee_basis_points?: number | string }; older_transfer_fee?: { transfer_fee_basis_points?: number | string } } } } };
    const res = j.result;
    if (res) {
      const cfg = res.mint_extensions?.transfer_fee_config;
      const fee = cfg?.newer_transfer_fee ?? cfg?.older_transfer_fee;
      v = { bps: Number(fee?.transfer_fee_basis_points) || 0, t22: res.token_info?.token_program === TOKEN_2022_PROGRAM };
    }
  } catch { /* leave unknown */ }
  TAX.set(mint, { v, at: Date.now() });
  return v;
}

/** GET /api/market/token/<mint>: live data for one Solana token. */
export async function GET(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  if (!isMint(mint)) return NextResponse.json({ error: 'invalid_mint' }, { status: 400 });
  const [token, tax] = await Promise.all([liveToken(mint), taxOf(mint)]);
  if (!token) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'public, s-maxage=30' } });
  return NextResponse.json({ token: { ...token, tax }, at: Date.now() }, { headers: { 'cache-control': 'public, s-maxage=2, stale-while-revalidate=10' } });
}
