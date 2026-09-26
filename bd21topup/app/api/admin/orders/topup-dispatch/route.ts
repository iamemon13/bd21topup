import { NextResponse } from "next/server";
import { checkUserRole } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildDryRunDispatch } from "@/lib/topup-dispatch";
import { assertPreviewOrder, PreviewError } from "@/lib/topup-preview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const responseHeaders = { "Cache-Control": "private, no-store", Vary: "Authorization" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/i;

function failure(code: string, error: string, status: number) {
  return NextResponse.json({ success: false, code, error }, { status, headers: responseHeaders });
}

async function loadDispatch(dispatchId: string, created: boolean) {
  const [dispatchResult, operationsResult, auditResult] = await Promise.all([
    supabaseAdmin.from("topup_dispatches").select("id,order_id,status,dry_run,mapping_version,uid_snapshot,package_name_snapshot,amount_snapshot,manual_review_reason").eq("id", dispatchId).single(),
    supabaseAdmin.from("topup_dispatch_operations").select("id,sequence_no,product_code,quantity,command_hash,status,failure_reason,send_intent_id").eq("dispatch_id", dispatchId).order("sequence_no", { ascending: true }),
    supabaseAdmin.from("admin_audit_logs").select("action_type,created_at").eq("target_id", dispatchId).order("created_at", { ascending: true }),
  ]);
  if (dispatchResult.error || operationsResult.error || auditResult.error || !dispatchResult.data || !operationsResult.data || !auditResult.data)
    return null;
  const dispatch = dispatchResult.data;
  return {
    id: dispatch.id, orderId: dispatch.order_id, status: dispatch.status, dryRun: true as const,
    mappingVersion: dispatch.mapping_version, uid: dispatch.uid_snapshot,
    packageName: dispatch.package_name_snapshot, amount: dispatch.amount_snapshot,
    manualReviewReason: dispatch.manual_review_reason,
    failureReason: operationsResult.data.find((operation) => operation.status === "failed" || operation.status === "manual_review")?.failure_reason ?? null,
    auditTrail: auditResult.data.map((entry) => ({ actionType: entry.action_type, createdAt: entry.created_at })),
    created, operations: operationsResult.data.map((operation) => ({
      id: operation.id, sequence: operation.sequence_no, productCode: operation.product_code,
      quantity: operation.quantity, commandHash: operation.command_hash, status: operation.status,
      failureReason: operation.failure_reason, hasPreviousSendIntent: Boolean(operation.send_intent_id),
    })),
  };
}

export async function GET(request: Request) {
  try {
    const auth = await checkUserRole(request, ["super_admin", "admin", "editor"], "manage_orders");
    if ("error" in auth) return failure("AUTHORIZATION_FAILED", auth.error || "Authorization failed.", auth.status || 403);
    const params = new URL(request.url).searchParams;
    const dispatchIds = params.getAll("dispatchId");
    const orderIds = params.getAll("orderId");
    const validKeys = [...params.keys()].every((key) => key === "dispatchId" || key === "orderId");
    if (!validKeys || dispatchIds.length + orderIds.length !== 1) {
      return failure("INVALID_INPUT", "Send exactly one dispatchId or orderId.", 400);
    }
    const dispatchId = dispatchIds[0];
    const orderId = orderIds[0];
    const identifier = dispatchId ?? orderId;
    if (!identifier || !UUID.test(identifier)) return failure("INVALID_INPUT", "Send a valid dispatchId or orderId.", 400);

    let lookup = supabaseAdmin.from("topup_dispatches").select("id");
    lookup = dispatchId ? lookup.eq("id", dispatchId) : lookup.eq("order_id", orderId!);
    const lookupResult = dispatchId
      ? await lookup.maybeSingle()
      : await lookup.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (lookupResult.error) return failure("READ_FAILED", "Dispatch status could not be loaded.", 503);
    if (!lookupResult.data) return failure("NOT_FOUND", "Dispatch was not found.", 404);
    const dispatch = await loadDispatch(lookupResult.data.id, false);
    if (!dispatch) return failure("READ_FAILED", "Dispatch status could not be loaded.", 503);
    return NextResponse.json({ success: true, dispatch }, { headers: responseHeaders });
  } catch {
    return failure("READ_FAILED", "Dispatch status is temporarily unavailable.", 503);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await checkUserRole(request, ["super_admin", "admin", "editor"], "manage_orders");
    if ("error" in auth) return failure("AUTHORIZATION_FAILED", auth.error || "Authorization failed.", auth.status || 403);
    let body: unknown;
    try { body = await request.json(); } catch { return failure("INVALID_INPUT", "Expected retry confirmation JSON.", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).sort().join(",") !== "confirmedFailureReason,dispatchId,retryReason,supplierFailureConfirmed"
      || !("dispatchId" in body) || typeof body.dispatchId !== "string" || !UUID.test(body.dispatchId)
      || !("retryReason" in body) || typeof body.retryReason !== "string" || body.retryReason.trim().length < 10 || body.retryReason.trim().length > 500
      || !("confirmedFailureReason" in body) || typeof body.confirmedFailureReason !== "string" || body.confirmedFailureReason.trim().length < 3 || body.confirmedFailureReason.trim().length > 500
      || !("supplierFailureConfirmed" in body) || body.supplierFailureConfirmed !== true) {
      return failure("INVALID_INPUT", "Explicit retry reason and confirmed supplier failure are required.", 400);
    }
    const { data, error } = await supabaseAdmin.rpc("admin_prepare_topup_dispatch_retry", {
      p_admin_id: auth.user.id,
      p_dispatch_id: body.dispatchId,
      p_retry_reason: body.retryReason.trim(),
      p_confirmed_failure_reason: body.confirmedFailureReason.trim(),
      p_supplier_failure_confirmed: true,
      p_ip: (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown").slice(0, 100),
    });
    if (error) {
      if (error.code === "42501") return failure("PERMISSION_CHANGED", "Administrator permission changed.", 403);
      if (error.code === "22023") return failure("INVALID_INPUT", "Explicit retry reason and confirmed supplier failure are required.", 400);
      if (["55000", "P0002", "23505"].includes(error.code)) return failure("RETRY_NOT_ELIGIBLE", "Dispatch is no longer eligible for retry.", 409);
      return failure("RETRY_UNAVAILABLE", "Dispatch retry could not be prepared.", 503);
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.operation_id) return failure("RETRY_UNAVAILABLE", "Dispatch retry was not confirmed.", 503);
    const dispatch = await loadDispatch(body.dispatchId, false);
    if (!dispatch) return failure("RETRY_UNAVAILABLE", "Retry was prepared but dispatch status could not be loaded.", 503);
    return NextResponse.json({ success: true, dispatch }, { headers: responseHeaders });
  } catch {
    return failure("RETRY_UNAVAILABLE", "Dispatch retry is temporarily unavailable.", 503);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await checkUserRole(request, ["super_admin", "admin", "editor"], "manage_orders");
    if ("error" in auth) return failure("AUTHORIZATION_FAILED", auth.error || "Authorization failed.", auth.status || 403);
    let body: unknown;
    try { body = await request.json(); } catch { return failure("INVALID_INPUT", "Expected an orderId JSON object.", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 ||
      !("orderId" in body) || typeof body.orderId !== "string" || !UUID.test(body.orderId)) {
      return failure("INVALID_INPUT", "Send only a valid orderId.", 400);
    }
    const { data: order, error: orderError } = await supabaseAdmin.from("orders")
      .select("id,user_id,uid,package_name,amount,payment_method,status,cancelled_at")
      .eq("id", body.orderId).maybeSingle();
    if (orderError) return failure("READ_FAILED", "Order eligibility could not be checked.", 503);
    assertPreviewOrder(order);
    const [catalog, ledger] = await Promise.all([
      supabaseAdmin.from("packages").select("id,name,category").eq("name", order.package_name).limit(2),
      supabaseAdmin.from("wallet_transactions").select("id,reference_id,user_id,amount,type,direction").eq("reference_id", order.id).limit(2),
    ]);
    if (catalog.error || ledger.error || !catalog.data || !ledger.data)
      return failure("READ_FAILED", "Package or payment evidence could not be checked.", 503);
    const candidate = buildDryRunDispatch(order, catalog.data, ledger.data);
    const { data: result, error: createError } = await supabaseAdmin.rpc("admin_create_topup_dispatch_dry_run", {
      p_admin_id: auth.user.id,
      p_order_id: order.id,
      p_package_id: candidate.preview.packageId,
      p_mapping_version: candidate.preview.mappingVersion,
      p_operations: candidate.operations,
      p_ip: (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown").slice(0, 100),
    });
    if (createError) {
      if (createError.code === "42501") return failure("PERMISSION_CHANGED", "Administrator permission changed.", 403);
      if (["55000", "P0002"].includes(createError.code)) return failure("ELIGIBILITY_CHANGED", "Order, package, or wallet evidence is no longer eligible.", 409);
      return failure("DISPATCH_UNAVAILABLE", "Dry-run dispatch could not be created.", 503);
    }
    const row = Array.isArray(result) ? result[0] : result;
    if (!row?.dispatch_id) return failure("DISPATCH_UNAVAILABLE", "Dry-run dispatch was not confirmed.", 503);
    const dispatch = await loadDispatch(row.dispatch_id, Boolean(row.created));
    if (!dispatch)
      return failure("DISPATCH_UNAVAILABLE", "Dry-run dispatch was created but could not be loaded.", 503);
    return NextResponse.json({ success: true, dispatch }, { headers: responseHeaders });
  } catch (error) {
    if (error instanceof PreviewError) return failure(error.code, error.message, error.status);
    return failure("DISPATCH_UNAVAILABLE", "Dry-run dispatch is temporarily unavailable.", 503);
  }
}
