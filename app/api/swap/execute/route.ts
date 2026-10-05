// app/api/swap/execute/route.ts
// POST /api/swap/execute  body: { signedTransaction: string (base64), requestId: string }
import { NextRequest, NextResponse } from "next/server";
import { verifyPrivyToken } from "@/lib/auth/privy-server";
import { executeOrder } from "@/lib/jupiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // execute waits for landing; give it room on Vercel

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

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

    return NextResponse.json({
      status: result.status,
      signature: result.signature ?? null,
      error: result.status === "Success" ? null : (typeof result.error === "string" ? result.error : result.error ? JSON.stringify(result.error) : "Swap failed. Nothing was spent."),
      code: result.code,
    });
  } catch (e) {
    console.error("[swap/execute]", e);
    return NextResponse.json({ error: "Jupiter couldn't send the swap. Try again.", detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
