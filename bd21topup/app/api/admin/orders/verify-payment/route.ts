import { NextResponse } from "next/server";
import { checkUserRole } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  autoExternalTopupDispatchEnabled,
  createOrReuseTopupDispatchForExternalOrder,
  loadDispatch,
} from "@/lib/topup-dispatch";
import { resolveTopupMapping } from "@/lib/topup-mappings";
import {
  isExternalPaymentMethod,
} from "@/lib/topup-preview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const responseHeaders = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization",
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/i;

function failure(code: string, error: string, status: number) {
  return NextResponse.json(
    { success: false, code, error },
    { status, headers: responseHeaders },
  );
}

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const ip = forwarded.split(",")[0]?.trim();
    if (ip) return ip.slice(0, 100);
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim().slice(0, 100);
  return "unknown";
}

export async function POST(request: Request) {
  try {
    /* -----------------------------------------------------
       1. Auth + manage_orders permission
    ----------------------------------------------------- */
    const auth = await checkUserRole(
      request,
      ["super_admin", "admin", "editor"],
      "manage_orders",
    );
    if ("error" in auth) {
      return failure(
        "AUTHORIZATION_FAILED",
        auth.error || "Authorization failed.",
        auth.status || 403,
      );
    }

    const adminId = auth.user.id;
    const ip = getClientIp(request);

    /* -----------------------------------------------------
       2. Parse & validate request body
    ----------------------------------------------------- */
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
      typeof (body as Record<string, unknown>).orderId !== "string" ||
      !UUID.test((body as Record<string, string>).orderId)
    ) {
      return failure("INVALID_INPUT", "Send only a valid orderId.", 400);
    }

    const orderId = (body as { orderId: string }).orderId;

    /* -----------------------------------------------------
       3. Re-read order server-side
    ----------------------------------------------------- */
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select(
        "id,user_id,uid,package_name,amount,payment_method,transaction_id,status,cancelled_at,payment_verified_at,payment_verified_by,payment_verification_source",
      )
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) {
      return failure("READ_FAILED", "Order eligibility could not be checked.", 503);
    }
    if (!order) {
      return failure("ORDER_NOT_FOUND", "Order was not found.", 404);
    }

    /* -----------------------------------------------------
       4. Strict eligibility validations
    ----------------------------------------------------- */
    if (order.status !== "pending") {
      return failure(
        "ORDER_NOT_PENDING",
        "Only pending orders can be verified for payment.",
        409,
      );
    }
    if (!order.user_id) {
      return failure(
        "ORDER_OWNER_MISSING",
        "Order has no customer account.",
        409,
      );
    }
    if (order.cancelled_at !== null) {
      return failure("ORDER_CANCELLED", "Order has cancellation evidence.", 409);
    }
    if (!isExternalPaymentMethod(order.payment_method)) {
      return failure(
        "INVALID_PAYMENT_METHOD",
        "Only external payment methods (bkash, nagad, rocket, upay) are supported.",
        400,
      );
    }
    if (
      !order.transaction_id ||
      typeof order.transaction_id !== "string" ||
      order.transaction_id.trim().length < 4
    ) {
      return failure(
        "TRANSACTION_ID_MISSING",
        "A valid transaction ID is required for verification.",
        400,
      );
    }

    // Catalog check
    const { data: catalog, error: catalogError } = await supabaseAdmin
      .from("packages")
      .select("id,name,category")
      .eq("name", order.package_name)
      .limit(2);

    if (catalogError || !catalog) {
      return failure("READ_FAILED", "Package catalog could not be loaded.", 503);
    }
    if (catalog.length !== 1 || catalog[0].name !== order.package_name) {
      return failure(
        "PACKAGE_UNRESOLVED",
        "Current package could not be resolved uniquely.",
        409,
      );
    }

    const mapping = resolveTopupMapping(catalog[0]);
    if (!mapping) {
      return failure(
        "PACKAGE_UNMAPPED",
        "Package is not approved for automatic top-up.",
        409,
      );
    }

    /* -----------------------------------------------------
       5. Record authoritative payment verification evidence
    ----------------------------------------------------- */
    let verifiedAt = order.payment_verified_at;
    let verifiedBy = order.payment_verified_by;
    let verificationSource = order.payment_verification_source;

    if (!order.payment_verified_at) {
      verifiedAt = new Date().toISOString();
      verifiedBy = adminId;
      verificationSource = "admin";

      const { error: updateError } = await supabaseAdmin
        .from("orders")
        .update({
          payment_verified_at: verifiedAt,
          payment_verified_by: verifiedBy,
          payment_verification_source: verificationSource,
        })
        .eq("id", order.id);

      if (updateError) {
        return failure(
          "VERIFICATION_FAILED",
          "Payment verification evidence could not be recorded.",
          500,
        );
      }

      await supabaseAdmin.from("admin_audit_logs").insert({
        admin_id: adminId,
        action_type: "EXTERNAL_PAYMENT_VERIFIED",
        target_id: order.id,
        details: JSON.stringify({
          order_id: order.id,
          payment_method: order.payment_method,
          transaction_id: order.transaction_id,
          amount: order.amount,
          source: verificationSource,
        }),
        ip_address: ip,
      });
    }

    /* -----------------------------------------------------
       6. Dispatch creation or reuse (Failure-isolated)
    ----------------------------------------------------- */
    const isAutoDispatchEnabled = autoExternalTopupDispatchEnabled();
    let dispatch = null;
    let dispatchError: string | null = null;

    if (isAutoDispatchEnabled) {
      try {
        const dispatchResult = await createOrReuseTopupDispatchForExternalOrder(
          supabaseAdmin,
          order.id,
          {
            adminId,
            ip,
          },
        );

        if (dispatchResult.attempted && "dispatchId" in dispatchResult) {
          dispatch = await loadDispatch(
            supabaseAdmin,
            dispatchResult.dispatchId,
            Boolean(dispatchResult.created),
          );
        } else if (dispatchResult.attempted && "error" in dispatchResult) {
          dispatchError = dispatchResult.error;
        }
      } catch (err) {
        dispatchError = err instanceof Error ? err.message : "dispatch_create_failed";
      }
    }

    return NextResponse.json(
      {
        success: true,
        verified: true,
        order: {
          id: order.id,
          paymentVerifiedAt: verifiedAt,
          paymentVerifiedBy: verifiedBy,
          paymentVerificationSource: verificationSource,
        },
        dispatch,
        dispatchError,
      },
      { headers: responseHeaders },
    );
  } catch (error) {
    return failure(
      "SERVER_ERROR",
      error instanceof Error ? error.message : "Server error.",
      500,
    );
  }
}
