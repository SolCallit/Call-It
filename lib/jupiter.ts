// lib/jupiter.ts
// Server-only Jupiter Swap V2 client (Meta-Aggregator: /order + /execute).
// Never import this from a "use client" file — it reads the secret API key.
import "server-only";
import { errText } from "@/lib/errors";

const JUP_BASE = "https://api.jup.ag/swap/v2";

// Key is optional: without it Jupiter serves keyless traffic at a lower rate limit.
function authHeaders(): Record<string, string> {
  const key = process.env.JUPITER_API_KEY;
  return key ? { "x-api-key": key } : {};
}

export type OrderParams = {
  inputMint: string;
  outputMint: string;
  amount: string; // smallest units of the input token
  taker: string; // user's wallet pubkey (required to get a transaction back)
  slippageBps?: number; // omit to let Jupiter pick
  priorityFeeLamports?: number; // speed setting (treated as a max cap)
  jitoTipLamports?: number; // front-running protection
};

export type JupiterOrder = {
  requestId: string;
  transaction: string | null; // base64 unsigned tx; "" if it couldn't be built
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  inUsdValue?: number;
  outUsdValue?: number;
  priceImpact?: number; // percentage points, e.g. -0.1 = -0.1%
  slippageBps: number;
  feeBps?: number;
  router?: "metis" | "jupiterz" | "dflow" | "okx";
  gasless?: boolean;
  errorCode?: number;
  errorMessage?: string;
  error?: string;
};

export type JupiterExecuteResult = {
  status: "Success" | "Failed";
  signature?: string;
  error?: string;
  code?: number;
  [k: string]: unknown;
};

export async function getOrder(p: OrderParams): Promise<JupiterOrder> {
  const qs = new URLSearchParams({
    inputMint: p.inputMint,
    outputMint: p.outputMint,
    amount: p.amount,
    taker: p.taker,
  });

  if (p.slippageBps !== undefined) qs.set("slippageBps", String(p.slippageBps));
  if (p.priorityFeeLamports) qs.set("priorityFeeLamports", String(p.priorityFeeLamports));
  if (p.jitoTipLamports) qs.set("jitoTipLamports", String(p.jitoTipLamports));
  if (p.priorityFeeLamports || p.jitoTipLamports) qs.set("broadcastFeeType", "maxCap");

  // Referral fees: only attached when BOTH are configured (Jupiter requires the pair).
  const referralAccount = (process.env.JUPITER_REFERRAL_ACCOUNT || '').trim();
  const referralFee = (process.env.JUPITER_REFERRAL_FEE_BPS || '').trim();
  const withFee = !!referralAccount && /^\d+$/.test(referralFee);

  const call = async (fee: boolean) => {
    const q = new URLSearchParams(qs);
    if (fee) { q.set('referralAccount', referralAccount); q.set('referralFee', referralFee); }
    const res = await fetch(`${JUP_BASE}/order?${q}`, { headers: authHeaders(), cache: 'no-store' });
    const data = (await res.json().catch(() => ({}))) as JupiterOrder & { error?: string };
    return { ok: res.ok, status: res.status, data };
  };

  let r = await call(withFee);
  // A misconfigured referral (account not initialised, no fee token account for this mint, bad bps)
  // must never block trading: retry once without the fee and log why.
  if (withFee && (!r.ok || !r.data.transaction)) {
    console.warn('[jupiter] order with referral failed, retrying without fee:', r.status, r.data?.error || r.data?.errorMessage);
    const plain = await call(false);
    if (plain.ok && plain.data.transaction) r = plain;
  }
  if (!r.ok) throw new Error(errText(r.data?.error ?? r.data) || `Jupiter /order failed (${r.status})`);
  return r.data as JupiterOrder;
}

export async function executeOrder(
  signedTransaction: string,
  requestId: string
): Promise<JupiterExecuteResult> {
  const res = await fetch(`${JUP_BASE}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ signedTransaction, requestId }),
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(errText(data?.error ?? data) || `Jupiter /execute failed (${res.status})`);
  }
  return data as JupiterExecuteResult;
}
