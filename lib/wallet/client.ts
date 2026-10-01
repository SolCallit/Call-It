'use client';

import qrcode from 'qrcode-generator';

/**
 * Browser-side wallet helpers used by the UI engine: real balances, Jupiter swaps
 * and withdrawals. Every transaction is signed in the user's own wallet through
 * window.CallitWallet (set by AuthBridge); nothing here ever touches a key.
 */

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

async function authed(path: string, init: RequestInit = {}) {
  const w = window.CallitWallet;
  const token = w ? await w.token() : null;
  if (!token) throw new Error('Sign in again to continue.');
  const r = await fetch(path, {
    ...init,
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Request failed (${r.status})`);
  return j;
}

export type WalletBalances = { sol: number; lamports: string; tokens: { mint: string; amount: string; decimals: number; ui: number }[] };

export const walletBalances = (owner: string) => authed(`/api/wallet/balances?owner=${owner}`) as Promise<WalletBalances>;

/** Number or numeric string -> integer base units, rounding down so we never ask for more than the user has. */
export function toBaseUnits(v: number | string, decimals: number): string {
  let s = typeof v === 'number' ? v.toFixed(Math.min(decimals, 20)) : v.trim();
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') throw new Error('Invalid amount');
  const [w = '0', f = ''] = s.split('.');
  s = (w || '0') + f.slice(0, decimals).padEnd(decimals, '0');
  const out = BigInt(s);
  if (out <= 0n) throw new Error('Amount is too small');
  return out.toString();
}

const sign = async (b64: string, owner: string) => {
  const w = window.CallitWallet;
  if (!w) throw new Error('Wallet not ready. Refresh and try again.');
  return w.signTx(b64, owner);
};

export type SwapResult = { signature: string; inAmount?: string; outAmount?: string };

/** Jupiter Meta-Aggregator: quote + assembled tx, user signs, Jupiter lands it. */
export async function swap(
  p: { inputMint: string; outputMint: string; amount: string; taker: string; slippageBps?: number },
  step: (msg: string) => void,
): Promise<SwapResult> {
  step('Getting the best price…');
  const qs = new URLSearchParams({ inputMint: p.inputMint, outputMint: p.outputMint, amount: p.amount, taker: p.taker });
  if (p.slippageBps != null) qs.set('slippageBps', String(p.slippageBps));
  const q = (await authed(`/api/swap/order?${qs}`)) as { requestId: string; transaction: string; inAmount: string; outAmount: string };
  step('Approve in your wallet…');
  const signed = await sign(q.transaction, p.taker);
  step('Sending to Solana…');
  const r = (await authed('/api/swap/execute', {
    method: 'POST',
    body: JSON.stringify({ signedTransaction: signed, requestId: q.requestId }),
  })) as { status: string; signature: string | null; error?: string | null };
  if (r.status !== 'Success' || !r.signature) throw new Error(r.error || 'Swap failed. Nothing was spent.');
  return { signature: r.signature, inAmount: q.inAmount, outAmount: q.outAmount };
}

/** Withdraw SOL or any SPL token to an outside address. */
export async function withdraw(
  p: { from: string; to: string; mint: string; amount: string },
  step: (msg: string) => void,
): Promise<{ signature: string; pending: boolean }> {
  step('Preparing…');
  const { transaction } = (await authed('/api/wallet/transfer', { method: 'POST', body: JSON.stringify(p) })) as { transaction: string };
  step('Approve in your wallet…');
  const signed = await sign(transaction, p.from);
  step('Sending to Solana…');
  const r = (await authed('/api/wallet/send', { method: 'POST', body: JSON.stringify({ signedTransaction: signed }) })) as {
    signature: string;
    status: string;
  };
  return { signature: r.signature, pending: r.status !== 'confirmed' };
}

/** Real, scannable QR code (SVG) for a deposit address. */
export function qrSvg(text: string, px = 200): string {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
  return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" width="${px}" height="${px}" role="img" aria-label="QR code of your wallet address" shape-rendering="crispEdges" style="background:#fff;border-radius:14px"><path d="${d}" fill="#0B1B27"/></svg>`;
}
