import { NextResponse } from 'next/server';
import { verifyPrivyToken } from '@/lib/auth/privy-server';
import { rpc, RpcError } from '@/lib/solana/rpc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Turns raw RPC simulation errors into something a user can act on. */
function friendly(msg: string): string {
  if (/insufficient (funds|lamports)|custom program error: 0x1\b/i.test(msg)) return 'Not enough balance to cover this and the network fee.';
  if (/blockhash not found|block height exceeded/i.test(msg)) return 'The transaction expired before it was sent. Try again.';
  return 'The network rejected this transaction. Nothing was sent.';
}

/**
 * POST /api/wallet/send { signedTransaction } — broadcasts a transaction the user already
 * signed, then waits up to ~30s for confirmation.
 */
export async function POST(req: Request) {
  if (!(await verifyPrivyToken(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { signedTransaction?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const tx = body.signedTransaction;
  if (typeof tx !== 'string' || tx.length > 3000 || !B64.test(tx)) {
    return NextResponse.json({ error: 'Invalid transaction' }, { status: 400 });
  }

  let signature: string;
  try {
    signature = await rpc<string>('sendTransaction', [tx, { encoding: 'base64', maxRetries: 5, preflightCommitment: 'confirmed' }]);
  } catch (e) {
    const msg = e instanceof RpcError ? e.message : String(e);
    console.error('[wallet/send]', msg);
    return NextResponse.json({ error: friendly(msg) }, { status: 422 });
  }

  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    try {
      const st = await rpc<{ value: ({ confirmationStatus?: string; err: unknown } | null)[] }>('getSignatureStatuses', [[signature]]);
      const s = st.value?.[0];
      if (s?.err) return NextResponse.json({ signature, status: 'failed', error: 'The transaction failed on-chain.' }, { status: 422 });
      if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) {
        return NextResponse.json({ signature, status: 'confirmed' });
      }
    } catch {
      /* keep polling */
    }
  }
  // Sent but not confirmed in time: it may still land.
  return NextResponse.json({ signature, status: 'pending' });
}
