// app/api/swap/order/route.ts
// GET /api/swap/order?inputMint=...&outputMint=...&amount=...&taker=...&slippageBps=...
import { NextRequest, NextResponse } from "next/server";
import { getOrder } from "@/lib/jupiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const UINT = /^\d+$/;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const inputMint = sp.get("inputMint") ?? "";
  const outputMint = sp.get("outputMint") ?? "";
  const amount = sp.get("amount") ?? "";
  const taker = sp.get("taker") ?? "";
  const slippageRaw = sp.get("slippageBps");

  if (!PUBKEY.test(inputMint) || !PUBKEY.test(outputMint)) {
    return NextResponse.json({ error: "Invalid mint address" }, { status: 400 });
  }
  if (inputMint === outputMint) {
    return NextResponse.json({ error: "Input and output tokens must differ" }, { status: 400 });
  }
  if (!PUBKEY.test(taker)) {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }
  if (!UINT.test(amount) || BigInt(amount) <= 0n) {
    return NextResponse.json({ error: "Amount must be a positive integer in base units" }, { status: 400 });
  }

  let slippageBps: number | undefined;
  if (slippageRaw !== null) {
    const n = Number(slippageRaw);
    if (!Number.isInteger(n) || n < 0 || n > 10_000) {
      return NextResponse.json({ error: "slippageBps must be 0–10000" }, { status: 400 });
    }
    slippageBps = n;
  }

  try {
    const order = await getOrder({ inputMint, outputMint, amount, taker, slippageBps });

    // Quote came back but Jupiter couldn't build a tx (insufficient funds/SOL, etc.)
    if (!order.transaction) {
      return NextResponse.json(
        {
          error: order.errorMessage ?? order.error ?? "Could not build swap transaction",
          errorCode: order.errorCode,
          router: order.router,
        },
        { status: 422 }
      );
    }

    // Only send the client what it needs.
    return NextResponse.json({
      requestId: order.requestId,
      transaction: order.transaction,
      inputMint: order.inputMint,
      outputMint: order.outputMint,
      inAmount: order.inAmount,
      outAmount: order.outAmount,
      minOutAmount: order.otherAmountThreshold,
      inUsdValue: order.inUsdValue,
      outUsdValue: order.outUsdValue,
      priceImpact: order.priceImpact,
      slippageBps: order.slippageBps,
      feeBps: order.feeBps,
      router: order.router,
      gasless: order.gasless,
    });
  } catch (e) {
    console.error("[swap/order]", e);
    return NextResponse.json({ error: "Failed to get quote" }, { status: 502 });
  }
}
