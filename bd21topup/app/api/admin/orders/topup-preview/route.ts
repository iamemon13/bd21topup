import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { checkUserRole } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  assertPreviewOrder,
  generateTopupPreview,
  PreviewError,
} from "@/lib/topup-preview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
function failure(code: string, error: string, status: number) {
  return NextResponse.json(
    { success: false, code, error },
    { status, headers },
  );
}

export async function POST(request: Request) {
  try {
    const auth = await checkUserRole(
      request,
      ["super_admin", "admin", "editor"],
      "manage_orders",
    );
    if ("error" in auth)
      return failure(
        "AUTHORIZATION_FAILED",
        auth.error || "Authorization failed.",
        auth.status || 403,
      );
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return failure("INVALID_INPUT", "Expected an orderId JSON object.", 400);
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !("orderId" in body) ||
      typeof body.orderId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/i.test(
        body.orderId,
      )
    ) {
      return failure("INVALID_INPUT", "Send only a valid orderId.", 400);
    }
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select(
        "id,user_id,uid,package_name,amount,payment_method,status,cancelled_at",
      )
      .eq("id", body.orderId)
      .maybeSingle();
    if (orderError)
      return failure(
        "READ_FAILED",
        "Order eligibility could not be checked.",
        503,
      );
    assertPreviewOrder(order);
    const [catalog, ledger] = await Promise.all([
      supabaseAdmin
        .from("packages")
        .select("id,name,category")
        .eq("name", order.package_name)
        .limit(2),
      supabaseAdmin
        .from("wallet_transactions")
        .select("id,reference_id,user_id,amount,type,direction")
        .eq("reference_id", order.id)
        .limit(2),
    ]);
    if (catalog.error || ledger.error || !catalog.data || !ledger.data)
      return failure(
        "READ_FAILED",
        "Package or payment evidence could not be checked.",
        503,
      );
    const preview = generateTopupPreview(order, catalog.data, ledger.data);
    // Commands stay server-side until this transaction revalidates the snapshot
    // and commits its audit row. No best-effort logging or financial RPC calls.
    const { data: generatedAt, error: auditError } = await supabaseAdmin.rpc(
      "admin_audit_topup_preview",
      {
        p_admin_id: auth.user.id,
        p_order_id: order.id,
        p_package_id: preview.packageId,
        p_expected_uid: order.uid,
        p_expected_user_id: order.user_id,
        p_expected_amount: order.amount,
        p_expected_package_name: preview.packageName,
        p_expected_category: preview.category,
        p_debit_id: ledger.data[0].id,
        p_mapping_version: preview.mappingVersion,
        p_command_hashes: preview.operations.map(({ command }) =>
          createHash("sha256").update(command).digest("hex"),
        ),
        p_ip: (
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          request.headers.get("x-real-ip") ||
          "unknown"
        ).slice(0, 100),
      },
    );
    if (auditError) {
      if (auditError.code === "42501")
        return failure(
          "PERMISSION_CHANGED",
          "Administrator permission changed. Refresh and try again.",
          403,
        );
      if (["55000", "P0002"].includes(auditError.code))
        return failure(
          "ELIGIBILITY_CHANGED",
          "Order, package or payment evidence changed. Refresh and try again.",
          409,
        );
      return failure(
        "AUDIT_UNAVAILABLE",
        "Preview audit is unavailable. No preview was released.",
        503,
      );
    }
    if (
      typeof generatedAt !== "string" ||
      !Number.isFinite(Date.parse(generatedAt))
    )
      return failure(
        "AUDIT_UNAVAILABLE",
        "Preview audit could not be confirmed.",
        503,
      );
    return NextResponse.json(
      { success: true, ...preview, generatedAt },
      { headers },
    );
  } catch (error) {
    if (error instanceof PreviewError)
      return failure(error.code, error.message, error.status);
    return failure(
      "PREVIEW_UNAVAILABLE",
      "Preview is temporarily unavailable.",
      503,
    );
  }
}
