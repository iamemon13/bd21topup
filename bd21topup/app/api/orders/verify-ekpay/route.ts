import { NextResponse } from "next/server";
import { z } from "zod";
import { checkFinancialRateLimit } from "@/lib/financial-rate-limit";
import { EkPayError, ekPayClient } from "@/lib/ekpay";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
const inputSchema = z.object({
  orderId: z.string().uuid(),
  transactionId: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{3,79}$/),
}).strict();

type Attempt = {
  order_id: string;
  provider: "bkash" | "nagad";
  provider_transaction_id: string;
  amount_minor: number | string;
  status: "prepared" | "reserved" | "consumed";
  ekpay_verification_id: string | null;
  verify_idempotency_key: string;
  confirm_idempotency_key: string;
};

function failure(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status, headers });
}

function firstRow<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return failure("Login required.", 401);
    const token = authorization.slice(7).trim();
    if (!token) return failure("Login required.", 401);

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return failure("Invalid or expired session.", 401);

    const limited = await checkFinancialRateLimit(request, user.id, "orders");
    if (limited) return limited;

    let raw: unknown;
    try { raw = await request.json(); } catch { return failure("Invalid request.", 400); }
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) return failure("Invalid transaction.", 400);

    const prepared = await supabaseAdmin.rpc("prepare_ekpay_order_verification", {
      p_user_id: user.id,
      p_order_id: parsed.data.orderId,
      p_transaction_id: parsed.data.transactionId,
    });
    if (prepared.error) {
      if (prepared.error.code === "EKP04") return failure("Provider not supported.", 422);
      if (prepared.error.code === "EKP03") return failure("Payment already verified.", 409);
      if (["P0002", "55000"].includes(prepared.error.code)) return failure("Transaction could not be verified.", 422);
      return failure("Temporarily unavailable.", 503);
    }

    const attempt = firstRow(prepared.data) as Attempt | null;
    if (!attempt) return failure("Temporarily unavailable.", 503);
    if (attempt.status === "consumed") {
      return NextResponse.json({ success: true, verified: true, orderId: attempt.order_id }, { headers });
    }

    const amountMinor = typeof attempt.amount_minor === "string"
      ? Number(attempt.amount_minor)
      : attempt.amount_minor;
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      return failure("Temporarily unavailable.", 503);
    }

    let verificationId = attempt.ekpay_verification_id;
    if (attempt.status === "prepared") {
      const verification = await ekPayClient.verify({
        transactionId: attempt.provider_transaction_id,
        amountMinor,
        provider: attempt.provider,
        idempotencyKey: attempt.verify_idempotency_key,
      });
      if (verification.transaction_id.toLowerCase() !== attempt.provider_transaction_id.toLowerCase()
        || verification.provider !== attempt.provider || verification.amount !== amountMinor) {
        return failure("Transaction could not be verified.", 422);
      }
      verificationId = verification.verification_id;
      const recorded = await supabaseAdmin.rpc("record_ekpay_order_reservation", {
        p_user_id: user.id,
        p_order_id: attempt.order_id,
        p_verification_id: verification.verification_id,
        p_provider: verification.provider,
        p_transaction_id: verification.transaction_id,
        p_amount_minor: verification.amount,
        p_provider_timestamp: verification.provider_timestamp,
      });
      if (recorded.error) return failure("Temporarily unavailable.", 503);
    }

    if (!verificationId) return failure("Temporarily unavailable.", 503);
    const confirmation = await ekPayClient.confirm({
      verificationId,
      idempotencyKey: attempt.confirm_idempotency_key,
    });
    if (confirmation.verification_id !== verificationId
      || confirmation.transaction_id.toLowerCase() !== attempt.provider_transaction_id.toLowerCase()
      || confirmation.provider !== attempt.provider || confirmation.amount !== amountMinor) {
      return failure("Transaction could not be verified.", 422);
    }

    const finalized = await supabaseAdmin.rpc("finalize_ekpay_order_verification", {
      p_user_id: user.id,
      p_order_id: attempt.order_id,
      p_verification_id: confirmation.verification_id,
      p_provider: confirmation.provider,
      p_transaction_id: confirmation.transaction_id,
      p_amount_minor: confirmation.amount,
      p_consumed_at: confirmation.consumed_at,
    });
    if (finalized.error) return failure("Temporarily unavailable.", 503);

    return NextResponse.json({ success: true, verified: true, orderId: attempt.order_id }, { headers });
  } catch (error) {
    if (error instanceof EkPayError) {
      if (["not_verifiable", "conflict"].includes(error.code)) {
        return failure("Transaction could not be verified.", 422);
      }
      return failure("Temporarily unavailable.", 503);
    }
    return failure("Temporarily unavailable.", 503);
  }
}
