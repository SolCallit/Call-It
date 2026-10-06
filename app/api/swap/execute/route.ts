// app/api/swap/execute/route.ts
// POST /api/swap/execute  body: { signedTransaction: string (base64), requestId: string }
import { NextRequest, NextResponse } from "next/server";
import { verifyPrivyToken } from "@/lib/auth/privy-server";
import { executeOrder } from "@/lib/jupiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // execute waits for landing; give it room on Vercel

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Turns Jupiter / on-chain errors into something a trader can act on. Nothing was spent when a swap fails. */
function friendly(raw: string, code?: number): string {
  const m = raw.toLowerCase();
  if (/insufficient (funds|lamports)|0x1\b|custom program error: 1\b|rent/.test(m))
    return "Not enough SOL to cover the buy plus network fees (~0.004 SOL). Nothing was spent.";
  if (/slippage|0x1771|0x1772|0x1773|\b600[123]\b|toomuchsolrequired|toolittlesolreceived|exceeds desired slippage/.test(m))
    return "Price moved too fast for your slippage. Nothing was spent. Try again or raise slippage in swap settings.";
  if (/blockhash|expired|block height/.test(m)) return "The transaction expired before it landed. Nothing was spent. Try again.";
  if (/bonding curve.*complete|0x1775|\b6005\b/.test(m)) return "This token just migrated off pump.fun. Try again in a moment.";
  if (/custom program error/.test(m)) return `The swap was rejected on-chain${code != null ? ` (code ${code})` : ""}. Nothing was spent. Usually slippage or low SOL; try again.`;
  return raw || "Swap failed. Nothing was spent.";
}

export async function POST(req: NextRequest) {
  if (!(await verifyPrivyToken(req))) return NextResponse.json({ error: "Sign in to trade" }, { status: 401 });

  let body: { signedTransaction?: unknown; requestId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { signedTransaction, requestId } = body;

  if (typeof signedTransaction !== "string" || !BASE64.test(signedTransaction) || signedTransaction.length > 10_000) {
    return NextResponse.json({ error: "Invalid signedTransaction" }, { status: 400 });
  }
  if (typeof requestId !== "string" || requestId.length === 0 || requestId.length > 200) {
    return NextResponse.json({ error: "Invalid requestId" }, { status: 400 });
  }

  try {
    const result = await executeOrder(signedTransaction, requestId);

    // "Failed" comes back as a normal response — always check status.
    // TODO (Phase 4): log { requestId, signature, status, wallet, mints, amounts } to Supabase here.

    if (result.status !== "Success") console.warn("[swap/execute] failed", result.code, result.error);
    return NextResponse.json({
      status: result.status,
      signature: result.signature ?? null,
      error: result.status === "Success" ? null : friendly(String(result.error ?? ""), result.code),
      code: result.code,
    });
  } catch (e) {
    console.error("[swap/execute]", e);
    return NextResponse.json({ error: "Failed to execute swap" }, { status: 502 });
  }
}
