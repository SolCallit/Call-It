import { NextResponse } from 'next/server';
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
  type Instruction,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
} from '@solana-program/token';
import { verifyPrivyToken } from '@/lib/auth/privy-server';
import { isAddress, rpc, SOL_MINT, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '@/lib/solana/rpc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPUTE_BUDGET = address('ComputeBudget111111111111111111111111111111');

/** Small priority fee so withdrawals land during congestion (~0.00001 SOL). */
function computeBudget(): Instruction[] {
  const limit = new Uint8Array(5);
  limit[0] = 2;
  new DataView(limit.buffer).setUint32(1, 200_000, true);
  const price = new Uint8Array(9);
  price[0] = 3;
  new DataView(price.buffer).setBigUint64(1, 50_000n, true); // micro-lamports per CU
  return [
    { programAddress: COMPUTE_BUDGET, data: limit },
    { programAddress: COMPUTE_BUDGET, data: price },
  ];
}

/**
 * POST /api/wallet/transfer { from, to, mint: 'SOL' | <mint>, amount: <base units> }
 * Builds an unsigned withdrawal transaction. The user signs it in their own wallet;
 * the server never sees a key.
 */
export async function POST(req: Request) {
  if (!(await verifyPrivyToken(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { from?: unknown; to?: unknown; mint?: unknown; amount?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const { from, to, mint, amount } = body;
  if (!isAddress(from) || !isAddress(to)) return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
  if (from === to) return NextResponse.json({ error: "That's your own Callit wallet. Use a different address." }, { status: 400 });
  if (typeof amount !== 'string' || !/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
  }
  const isSol = mint === 'SOL' || mint === SOL_MINT;
  if (!isSol && !isAddress(mint)) return NextResponse.json({ error: 'Invalid token' }, { status: 400 });

  try {
    const payer = createNoopSigner(address(from));
    const ixs: Instruction[] = [...computeBudget()];

    if (isSol) {
      ixs.push(getTransferSolInstruction({ source: payer, destination: address(to), amount: BigInt(amount) }));
    } else {
      const info = await rpc<{ value: { owner: string; data: { parsed?: { info?: { decimals?: number } } } } | null }>(
        'getAccountInfo',
        [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }],
      );
      const prog = info.value?.owner;
      const decimals = info.value?.data?.parsed?.info?.decimals;
      if (!info.value || (prog !== TOKEN_PROGRAM && prog !== TOKEN_2022_PROGRAM) || typeof decimals !== 'number') {
        return NextResponse.json({ error: 'Unknown token' }, { status: 400 });
      }
      const tokenProgram = address(prog);
      const m = address(mint as string);
      const [source] = await findAssociatedTokenPda({ owner: address(from), mint: m, tokenProgram });
      const [destination] = await findAssociatedTokenPda({ owner: address(to), mint: m, tokenProgram });
      ixs.push(
        // Creates the recipient's token account if they don't have one (sender pays the small rent).
        getCreateAssociatedTokenIdempotentInstruction({ payer, ata: destination, owner: address(to), mint: m, tokenProgram }),
        getTransferCheckedInstruction(
          { source, mint: m, destination, authority: payer, amount: BigInt(amount), decimals },
          { programAddress: tokenProgram },
        ),
      );
    }

    const { value: bh } = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash', [
      { commitment: 'confirmed' },
    ]);
    const msg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(payer, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: bh.blockhash as Blockhash, lastValidBlockHeight: BigInt(bh.lastValidBlockHeight) },
          m,
        ),
      (m) => appendTransactionMessageInstructions(ixs, m),
    );
    const tx = compileTransaction(msg);
    return NextResponse.json({ transaction: getBase64EncodedWireTransaction(tx) }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('[wallet/transfer]', e);
    return NextResponse.json({ error: 'Could not build the withdrawal. Try again.' }, { status: 502 });
  }
}
