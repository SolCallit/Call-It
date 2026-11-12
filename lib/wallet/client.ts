'use client';

import qrcode from 'qrcode-generator';
import { errText, friendlyError, isUserCancel } from '@/lib/errors';

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
  if (!r.ok) throw new TxError(errText((j as { error?: unknown }).error) || `Request failed (${r.status})`, 'server', j);
  return j;
}

/** An error that remembers which step failed and the raw object, for logs. */
export class TxError extends Error {
  constructor(message: string, public stage: string, public raw?: unknown) { super(message); this.name = 'TxError'; }
}

/** Sends a failed attempt to the admin panel (never throws, never blocks the UI). */
export function reportTxError(action: string, e: unknown, wallet?: string) {
  if (isUserCancel(e)) return;
  const raw = e instanceof TxError ? e.raw : e;
  let safe: unknown = null;
  try { safe = JSON.parse(JSON.stringify(raw, raw && typeof raw === 'object' ? Object.getOwnPropertyNames(raw) : undefined)); } catch { /* unserialisable */ }
  authed('/api/wallet/errors', {
    method: 'POST',
    body: JSON.stringify({ action, wallet, stage: e instanceof TxError ? e.stage : 'unknown', message: errText(e), raw: safe }),
  }).catch(() => {});
}

/** Runs one step; any failure becomes a TxError with a readable message. */
async function stepRun<T>(stage: string, f: () => Promise<T>): Promise<T> {
  try { return await f(); } catch (e) {
    if (e instanceof TxError) { if (e.stage === 'server') e.stage = stage; throw e; }
    throw new TxError(friendlyError(e), stage, e);
  }
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
  if (!w) throw new TxError('Wallet not ready. Refresh and try again.', 'sign');
  return stepRun('sign', () => w.signTx(b64, owner));
};

export type SwapResult = { signature: string; inAmount?: string; outAmount?: string; feeProof?: string };

/** Jupiter Meta-Aggregator: quote + assembled tx, user signs, Jupiter lands it. */
export async function swap(
  p: { inputMint: string; outputMint: string; amount: string; taker: string; slippageBps?: number; priorityFeeLamports?: number; jitoTipLamports?: number },
  step: (msg: string) => void,
): Promise<SwapResult> {
  step('Getting the best price…');
  const qs = new URLSearchParams({ inputMint: p.inputMint, outputMint: p.outputMint, amount: p.amount, taker: p.taker });
  if (p.slippageBps != null) qs.set('slippageBps', String(p.slippageBps));
  if (p.priorityFeeLamports) qs.set('priorityFeeLamports', String(p.priorityFeeLamports));
  if (p.jitoTipLamports) qs.set('jitoTipLamports', String(p.jitoTipLamports));
  const q = (await stepRun('quote', () => authed(`/api/swap/order?${qs}`))) as { requestId: string; transaction: string; inAmount: string; outAmount: string; feeTag?: string };
  step('Approve in your wallet…');
  const signed = await sign(q.transaction, p.taker);
  step('Sending to Solana…');
  const r = (await stepRun('execute', () => authed('/api/swap/execute', {
    method: 'POST',
    body: JSON.stringify({ signedTransaction: signed, requestId: q.requestId, feeTag: q.feeTag }),
  }))) as { status: string; signature: string | null; error?: unknown; code?: number; feeProof?: string };
  if (r.status !== 'Success' || !r.signature) {
    throw new TxError(friendlyError(r.error ? { message: errText(r.error), code: r.code } : 'Swap failed. Nothing was spent.'), 'execute', r);
  }
  return { signature: r.signature, inAmount: q.inAmount, outAmount: q.outAmount, feeProof: r.feeProof };
}

/** Withdraw SOL or any SPL token to an outside address. */
export async function withdraw(
  p: { from: string; to: string; mint: string; amount: string },
  step: (msg: string) => void,
): Promise<{ signature: string; pending: boolean }> {
  step('Preparing…');
  const { transaction } = (await stepRun('prepare', () => authed('/api/wallet/transfer', { method: 'POST', body: JSON.stringify(p) }))) as { transaction: string };
  step('Approve in your wallet…');
  const signed = await sign(transaction, p.from);
  step('Sending to Solana…');
  const r = (await stepRun('send', () => authed('/api/wallet/send', { method: 'POST', body: JSON.stringify({ signedTransaction: signed }) }))) as {
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

/* ---------- Jupiter Trigger v2: limit buys, take-profit / stop-loss, trailing stops ----------
 * Orders run on Jupiter's keepers, so they fire even when Callit is closed. The user signs the
 * deposit into their own Jupiter vault and any withdrawal; Callit never holds the funds. */

const JWT_KEY = 'callit.jupjwt';
function jwtGet(owner: string): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(JWT_KEY) || '{}') as Record<string, { t: string; exp: number }>;
    const e = v[owner];
    return e && e.exp > Date.now() + 60_000 ? e.t : null;
  } catch { return null; }
}
function jwtSet(owner: string, t: string | null) {
  try {
    const v = JSON.parse(localStorage.getItem(JWT_KEY) || '{}') as Record<string, { t: string; exp: number }>;
    if (t) v[owner] = { t, exp: Date.now() + 23 * 3600_000 }; else delete v[owner];
    localStorage.setItem(JWT_KEY, JSON.stringify(v));
  } catch { /* private mode */ }
}

async function trig(path: string, owner: string, init: { method?: string; body?: unknown } = {}, jwt?: string | null) {
  const w = window.CallitWallet;
  const token = w ? await w.token() : null;
  if (!token) throw new Error('Sign in again to continue.');
  const r = await fetch(`/api/trigger/${path}`, {
    method: init.method || (init.body !== undefined ? 'POST' : 'GET'),
    headers: { authorization: `Bearer ${token}`, ...(jwt ? { 'x-jup-jwt': jwt } : {}), ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    if (r.status === 401 && jwt) jwtSet(owner, null);
    const msg = (j.error || j.message || j.detail) as string | undefined;
    const e = new Error(typeof msg === 'string' && msg ? msg : `Order request failed (${r.status})`) as Error & { status?: number };
    e.status = r.status;
    throw e;
  }
  return j;
}

/** Logs the wallet in to Jupiter orders (one wallet signature, good for ~24h) and makes sure its vault exists. */
async function trigLogin(owner: string, step?: (m: string) => void): Promise<string> {
  let jwt = jwtGet(owner);
  if (!jwt) {
    step?.('Approve the login message…');
    const c = await trig('auth/challenge', owner, { body: { walletPubkey: owner, type: 'message' } });
    const challenge = String(c.challenge || c.message || '');
    if (!challenge) throw new Error('Jupiter didn’t send a login message. Try again.');
    const w = window.CallitWallet;
    if (!w?.signMsg) throw new Error('Wallet not ready. Refresh and try again.');
    const signature = await w.signMsg(challenge, owner);
    const v = await trig('auth/verify', owner, { body: { type: 'message', walletPubkey: owner, signature } });
    jwt = String(v.token || v.accessToken || '');
    if (!jwt) throw new Error('Jupiter login failed. Try again.');
    jwtSet(owner, jwt);
  }
  try { await trig('vault', owner, {}, jwt); }
  catch (e) {
    const st = (e as { status?: number }).status;
    if (st === 401 || st === 404) {
      try { await trig('vault/register', owner, {}, jwt); }
      catch { await trig('vault/register', owner, { body: {} }, jwt); }
    } else throw e;
  }
  return jwt;
}

export type PriceOrder = {
  owner: string;
  inputMint: string; outputMint: string; inputAmount: string; triggerMint: string;
  kind: 'single' | 'oco';
  triggerCondition?: 'above' | 'below'; triggerPriceUsd?: number; trailingBps?: number;
  tpPriceUsd?: number; slPriceUsd?: number;
  slippageBps?: number; expiresAt: number;
};

/** Deposits into the user's Jupiter vault and places the order. */
export async function placeOrder(o: PriceOrder, step: (m: string) => void): Promise<{ id: string; signature: string }> {
  const jwt = await trigLogin(o.owner, step);
  step('Preparing your order…');
  const d = await trig('deposit/craft', o.owner, { body: {
    inputMint: o.inputMint, outputMint: o.outputMint, userAddress: o.owner, amount: o.inputAmount, orderType: 'price', orderSubType: o.kind,
  } }, jwt);
  step('Approve in your wallet…');
  const signed = await sign(String(d.transaction), o.owner);
  step('Placing the order…');
  const body: Record<string, unknown> = {
    orderType: o.kind, depositRequestId: d.requestId, depositSignedTx: signed, userPubkey: o.owner,
    inputMint: o.inputMint, outputMint: o.outputMint, inputAmount: o.inputAmount, triggerMint: o.triggerMint, expiresAt: o.expiresAt,
  };
  if (o.kind === 'single') {
    body.triggerCondition = o.triggerCondition;
    if (o.trailingBps) body.trailingBps = o.trailingBps; else body.triggerPriceUsd = o.triggerPriceUsd;
    if (o.slippageBps != null) body.slippageBps = o.slippageBps;
  } else {
    body.tpPriceUsd = o.tpPriceUsd; body.slPriceUsd = o.slPriceUsd;
    if (o.slippageBps != null) { body.tpSlippageBps = o.slippageBps; body.slSlippageBps = Math.max(o.slippageBps, 1000); }
  }
  const r = await trig('orders/price', o.owner, { body }, jwt);
  return { id: String(r.id || ''), signature: String(r.txSignature || '') };
}

export type OpenOrder = {
  id: string; orderType: string; orderState: string; inputMint: string; outputMint: string;
  initialInputAmount?: string; remainingInputAmount?: string; triggerMint?: string; triggerCondition?: string;
  triggerPriceUsd?: number; tpPriceUsd?: number; slPriceUsd?: number; trailingBps?: number; createdAt?: number; expiresAt?: number;
};

/** The wallet's orders. Returns [] if the wallet hasn't logged in to Jupiter orders yet (no signature prompt). */
export async function listOrders(owner: string, state: 'active' | 'past' = 'active'): Promise<OpenOrder[]> {
  const jwt = jwtGet(owner);
  if (!jwt) return [];
  const j = await trig(`orders/history?state=${state}&limit=50&sort=created_at&dir=desc`, owner, {}, jwt);
  const list = (j.orders || j.data || j.items || []) as OpenOrder[];
  return Array.isArray(list) ? list : [];
}

/** Cancels an order and returns the funds to the wallet (one signature). */
export async function cancelOrder(owner: string, id: string, step: (m: string) => void): Promise<string> {
  const jwt = await trigLogin(owner, step);
  step('Cancelling…');
  const c = await trig(`orders/price/cancel/${id}`, owner, { body: {} }, jwt);
  if (!c.transaction) return String(c.txSignature || '');
  step('Approve the refund in your wallet…');
  const signed = await sign(String(c.transaction), owner);
  const r = await trig(`orders/price/confirm-cancel/${id}`, owner, { body: { signedTransaction: signed, cancelRequestId: c.cancelRequestId || c.requestId } }, jwt);
  return String(r.txSignature || r.signature || '');
}
