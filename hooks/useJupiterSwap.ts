// hooks/useJupiterSwap.ts
"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Wallet-agnostic signer: takes unsigned tx bytes, returns signed tx bytes.
 * Works with Privy, Phantom/Solflare adapters, or @solana/kit — see examples at the bottom.
 */
export type SignTx = (unsignedTx: Uint8Array) => Promise<Uint8Array>;

export type SwapQuote = {
  requestId: string;
  transaction: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  minOutAmount: string;
  inUsdValue?: number;
  outUsdValue?: number;
  priceImpact?: number;
  slippageBps: number;
  feeBps?: number;
  router?: string;
  gasless?: boolean;
};

export type QuoteInput = {
  inputMint: string;
  outputMint: string;
  amount: string; // base units — use toBaseUnits()
  taker: string;
  slippageBps?: number;
};

type Status = "idle" | "quoting" | "quoted" | "signing" | "executing" | "success" | "error";

const QUOTE_MAX_AGE_MS = 20_000; // re-quote if user sat on it too long

// ---------- helpers ----------
const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};

/** "1.5", 9 -> "1500000000". String math, no float errors. */
export function toBaseUnits(uiAmount: string, decimals: number): string {
  const clean = uiAmount.trim();
  if (!/^\d*\.?\d*$/.test(clean) || clean === "" || clean === ".") throw new Error("Invalid amount");
  const [whole = "0", frac = ""] = clean.split(".");
  if (frac.length > decimals) throw new Error(`Max ${decimals} decimals`);
  const units = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((frac.padEnd(decimals, "0")) || "0");
  return units.toString();
}

/** "1500000000", 9 -> "1.5" */
export function fromBaseUnits(base: string, decimals: number): string {
  const v = BigInt(base);
  const d = 10n ** BigInt(decimals);
  const whole = v / d;
  const frac = (v % d).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

// ---------- hook ----------
export function useJupiterSwap(signTx: SignTx) {
  const [status, setStatus] = useState<Status>("idle");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lastInput = useRef<QuoteInput | null>(null);
  const quotedAt = useRef(0);

  const fetchQuote = useCallback(async (input: QuoteInput): Promise<SwapQuote> => {
    const qs = new URLSearchParams({
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      amount: input.amount,
      taker: input.taker,
    });
    if (input.slippageBps !== undefined) qs.set("slippageBps", String(input.slippageBps));

    const res = await fetch(`/api/swap/order?${qs}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to get quote");
    return data as SwapQuote;
  }, []);

  const getQuote = useCallback(
    async (input: QuoteInput) => {
      setStatus("quoting");
      setError(null);
      setSignature(null);
      try {
        const q = await fetchQuote(input);
        lastInput.current = input;
        quotedAt.current = Date.now();
        setQuote(q);
        setStatus("quoted");
        return q;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to get quote");
        setStatus("error");
        return null;
      }
    },
    [fetchQuote]
  );

  const swap = useCallback(async () => {
    if (!quote || !lastInput.current) {
      setError("Get a quote first");
      setStatus("error");
      return null;
    }
    setError(null);

    try {
      // Stale quote? Grab a fresh one so the tx doesn't expire mid-sign.
      let q = quote;
      if (Date.now() - quotedAt.current > QUOTE_MAX_AGE_MS) {
        setStatus("quoting");
        q = await fetchQuote(lastInput.current);
        quotedAt.current = Date.now();
        setQuote(q);
      }

      setStatus("signing");
      const signedBytes = await signTx(b64ToBytes(q.transaction));

      setStatus("executing");
      const res = await fetch("/api/swap/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedTransaction: bytesToB64(signedBytes), requestId: q.requestId }),
      });
      const data = await res.json();

      if (!res.ok || data.status !== "Success") {
        throw new Error(data.error ?? "Swap failed");
      }

      setSignature(data.signature);
      setStatus("success");
      return data.signature as string;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Swap failed";
      // Wallet rejection = user cancelled, not a real error
      setError(/reject|denied|cancel/i.test(msg) ? "Transaction cancelled" : msg);
      setStatus("error");
      return null;
    }
  }, [quote, signTx, fetchQuote]);

  const reset = useCallback(() => {
    setStatus("idle");
    setQuote(null);
    setSignature(null);
    setError(null);
    lastInput.current = null;
  }, []);

  return { status, quote, signature, error, getQuote, swap, reset };
}

/* ---------------------------------------------------------------------------
 SIGNER EXAMPLES — pick the one matching your wallet setup.

 1) Privy (Solana) — check the exact hook name/signature for your installed Privy version:

   import { useWallets, useSignTransaction } from "@privy-io/react-auth/solana";
   const { wallets } = useWallets();
   const { signTransaction } = useSignTransaction();
   const signTx: SignTx = async (bytes) => {
     const { signedTransaction } = await signTransaction({ transaction: bytes, wallet: wallets[0] });
     return signedTransaction;
   };

 2) Phantom / Solflare via @solana/wallet-adapter-react:

   import { VersionedTransaction } from "@solana/web3.js";
   const { signTransaction } = useWallet();
   const signTx: SignTx = async (bytes) => {
     const tx = VersionedTransaction.deserialize(bytes);
     const signed = await signTransaction!(tx);
     return signed.serialize();
   };

 USAGE in a component:

   const { status, quote, signature, error, getQuote, swap } = useJupiterSwap(signTx);
   await getQuote({
     inputMint: "So11111111111111111111111111111111111111112", // SOL
     outputMint: tokenMint,
     amount: toBaseUnits("0.1", 9),
     taker: walletAddress,
   });
   // show fromBaseUnits(quote.outAmount, outDecimals), quote.priceImpact, etc.
   await swap();
--------------------------------------------------------------------------- */
