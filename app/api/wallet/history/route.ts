import { NextResponse } from 'next/server';
import { requireMe, json } from '@/lib/db/me';
import { heliusKey } from '@/lib/solana/rpc';
import { jupMany } from '@/lib/market/sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WSOL = 'So11111111111111111111111111111111111111112';
const KNOWN: Record<string, string> = {
  [WSOL]: 'SOL',
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
};

type TBC = { userAccount?: string; mint?: string; rawTokenAmount?: { tokenAmount: string; decimals: number } };
type HTx = {
  signature: string; timestamp?: number; type?: string; fee?: number; feePayer?: string; transactionError?: unknown;
  accountData?: { account: string; nativeBalanceChange?: number; tokenBalanceChanges?: TBC[] }[];
};

type ChainRow = { kind: 'deposit' | 'swap' | 'send'; signature: string; created_at: string; label: string; in_mint?: string; out_mint?: string };

const fmt = (n: number) => {
  const a = Math.abs(n);
  return a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? a.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a >= 1 ? +a.toFixed(4) + '' : +a.toPrecision(3) + '';
};

/**
 * Net movement per mint for one wallet in one transaction, from balance changes (not transfer
 * lists, which count wrapping SOL twice). SOL (native + wrapped) is one bucket; the network fee
 * is added back so it doesn't read as a send.
 */
function netFor(tx: HTx, w: string): Map<string, number> {
  const net = new Map<string, number>();
  const add = (m: string, v: number) => net.set(m, (net.get(m) || 0) + v);
  for (const a of tx.accountData || []) {
    if (a.account === w && a.nativeBalanceChange) add(WSOL, a.nativeBalanceChange / 1e9);
    for (const c of a.tokenBalanceChanges || []) {
      if (c.userAccount !== w || !c.mint || !c.rawTokenAmount) continue;
      const v = Number(c.rawTokenAmount.tokenAmount) / 10 ** (c.rawTokenAmount.decimals || 0);
      if (Number.isFinite(v)) add(c.mint, v);
    }
  }
  if (tx.feePayer === w && net.has(WSOL)) add(WSOL, (tx.fee || 0) / 1e9);
  // Dust from rent and fees isn't a movement worth showing.
  for (const [m, v] of net) if (Math.abs(v) < (m === WSOL ? 0.0025 : 1e-9)) net.delete(m);
  return net;
}

/** Turns Helius' parsed history into deposits, swaps and sends. Anything else is skipped. */
function classify(txs: HTx[], w: string, sym: (m: string) => string): ChainRow[] {
  const out: ChainRow[] = [];
  for (const tx of txs) {
    if (!tx?.signature || tx.transactionError) continue;
    const net = netFor(tx, w);
    const ins = [...net].filter(([, v]) => v > 0), outs = [...net].filter(([, v]) => v < 0);
    const at = new Date((tx.timestamp || 0) * 1000).toISOString();
    const big = (l: [string, number][]) => l.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
    if (ins.length && outs.length) {
      const [om, ov] = big(outs), [im, iv] = big(ins);
      out.push({ kind: 'swap', signature: tx.signature, created_at: at, label: `${fmt(ov)} ${sym(om)} → ${fmt(iv)} ${sym(im)}`, in_mint: om, out_mint: im });
    } else if (ins.length && tx.feePayer !== w) {
      const [im, iv] = big(ins);
      out.push({ kind: 'deposit', signature: tx.signature, created_at: at, label: `+${fmt(iv)} ${sym(im)}`, out_mint: im });
    } else if (outs.length && tx.feePayer === w) {
      const [om, ov] = big(outs);
      out.push({ kind: 'send', signature: tx.signature, created_at: at, label: `${fmt(ov)} ${sym(om)}`, in_mint: om });
    }
  }
  return out;
}

/**
 * GET /api/wallet/history — the wallet's recent on-chain activity (deposits, swaps, sends),
 * including anything done outside Callit. The client merges it with Callit's own ledger by signature.
 */
export async function GET(req: Request) {
  const ctx = await requireMe(req);
  if (ctx instanceof NextResponse) return ctx;
  const w = ctx.me.wallet_address, key = heliusKey();
  if (!w || !key) return json({ rows: [] });
  try {
    const r = await fetch(`https://api.helius.xyz/v0/addresses/${w}/transactions?api-key=${key}&limit=40`, { cache: 'no-store' });
    if (!r.ok) return json({ rows: [], error: `helius_${r.status}` });
    const txs = (await r.json()) as HTx[];
    if (!Array.isArray(txs)) return json({ rows: [] });
    const mints = new Set<string>();
    for (const tx of txs) for (const m of netFor(tx, w).keys()) if (!KNOWN[m]) mints.add(m);
    const names = new Map<string, string>();
    if (mints.size) (await jupMany([...mints]).catch(() => [])).forEach((t) => names.set(t.mint, t.sym));
    const sym = (m: string) => KNOWN[m] || names.get(m) || `${m.slice(0, 4)}…`;
    return json({ rows: classify(txs, w, sym) });
  } catch (e) {
    console.warn('[wallet/history]', (e as Error).message);
    return json({ rows: [] });
  }
}
