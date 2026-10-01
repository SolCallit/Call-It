import { NextResponse } from 'next/server';
import { verifyPrivyToken } from '@/lib/auth/privy-server';
import { isAddress, rpc, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '@/lib/solana/rpc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ParsedAccount = { account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } } } } };

/** GET /api/wallet/balances?owner=<address> — SOL plus every SPL / Token-2022 balance above zero. */
export async function GET(req: Request) {
  if (!(await verifyPrivyToken(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const owner = new URL(req.url).searchParams.get('owner');
  if (!isAddress(owner)) return NextResponse.json({ error: 'invalid_owner' }, { status: 400 });

  try {
    const opts = { encoding: 'jsonParsed', commitment: 'confirmed' };
    const [bal, a, b] = await Promise.all([
      rpc<{ value: number }>('getBalance', [owner, { commitment: 'confirmed' }]),
      rpc<{ value: ParsedAccount[] }>('getTokenAccountsByOwner', [owner, { programId: TOKEN_PROGRAM }, opts]),
      rpc<{ value: ParsedAccount[] }>('getTokenAccountsByOwner', [owner, { programId: TOKEN_2022_PROGRAM }, opts]),
    ]);

    // One wallet can hold several accounts for the same mint: sum them.
    const byMint = new Map<string, { raw: bigint; decimals: number }>();
    for (const acc of [...a.value, ...b.value]) {
      const info = acc.account?.data?.parsed?.info;
      if (!info?.mint || !info.tokenAmount) continue;
      const raw = BigInt(info.tokenAmount.amount || '0');
      if (raw === 0n) continue;
      const prev = byMint.get(info.mint);
      byMint.set(info.mint, { raw: (prev?.raw ?? 0n) + raw, decimals: info.tokenAmount.decimals });
    }

    const tokens = [...byMint.entries()].map(([mint, { raw, decimals }]) => ({
      mint,
      amount: raw.toString(),
      decimals,
      ui: Number(raw) / 10 ** decimals,
    }));

    return NextResponse.json(
      { owner, lamports: String(bal.value), sol: bal.value / 1e9, tokens, at: Date.now() },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    console.error('[wallet/balances]', e);
    return NextResponse.json({ error: 'rpc_unavailable' }, { status: 502 });
  }
}
