import { NextResponse } from "next/server";
import { supabaseAdmin, logAdminAction } from "@/lib/supabase-admin";
import { checkUserRole } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_BULK_ORDERS = 100;

type BulkAction = "completed" | "cancelled";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBulkAction(value: string): value is BulkAction {
  return value === "completed" || value === "cancelled";
}

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: Request) {
  try {
    /* =====================================================
       1. AUTH + PERMISSION
    ===================================================== */

    const authCheck = await checkUserRole(
      request,
      ["super_admin", "admin", "editor"],
      "manage_orders",
    );

    if ("error" in authCheck) {
      return NextResponse.json(
        {
          success: false,
          error: authCheck.error,
        },
        {
          status: authCheck.status,
        },
      );
    }

    const adminId = authCheck.user.id;
    const ipAddress = getClientIp(request);

    /* =====================================================
       2. SAFE JSON PARSING
    ===================================================== */

    let rawBody: unknown;

    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid JSON body.",
        },
        {
          status: 400,
        },
      );
    }

    if (!isRecord(rawBody)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       3. VALIDATE ORDER IDS
    ===================================================== */

    if (!Array.isArray(rawBody.orderIds)) {
      return NextResponse.json(
        {
          success: false,
          error: "কমপক্ষে একটি অর্ডার সিলেক্ট করুন।",
        },
        {
          status: 400,
        },
      );
    }

    if (rawBody.orderIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "কমপক্ষে একটি অর্ডার সিলেক্ট করুন।",
        },
        {
          status: 400,
        },
      );
    }

    if (rawBody.orderIds.length > MAX_BULK_ORDERS) {
      return NextResponse.json(
        {
          success: false,
          error: `একবারে সর্বোচ্চ ${MAX_BULK_ORDERS} টি অর্ডার প্রসেস করা যাবে।`,
        },
        {
          status: 400,
        },
      );
    }

    if (!rawBody.orderIds.every((id) => typeof id === "string")) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid Order ID list.",
        },
        {
          status: 400,
        },
      );
    }

    const orderIds = [
      ...new Set(rawBody.orderIds.map((id) => String(id).trim().toLowerCase())),
    ];

    if (orderIds.some((id) => !UUID_REGEX.test(id))) {
      return NextResponse.json(
        {
          success: false,
          error: "এক বা একাধিক Order ID invalid.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       4. VALIDATE ACTION
    ===================================================== */

    if (typeof rawBody.action !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "Action missing.",
        },
        {
          status: 400,
        },
      );
    }

    const action = rawBody.action.trim().toLowerCase();

    if (!isBulkAction(action)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid action.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       5. BULK COMPLETE
    ===================================================== */

    if (action === "completed") {
      /*
       * Single-order state machine অনুযায়ী:
       * pending   -> completed
       * approved  -> completed
       * processing -> completed
       *
       * completed/rejected/cancelled rows untouched থাকবে।
       */

      const { data: updatedOrders, error: updateError } = await supabaseAdmin
        .from("orders")
        .update({
          status: "completed",
          updated_at: new Date().toISOString(),
        })
        .in("id", orderIds)
        .in("status", ["pending", "approved", "processing"])
        .select("id");

      if (updateError) {
        console.error("BULK COMPLETE ERROR:", updateError);

        return NextResponse.json(
          {
            success: false,
            error: "অর্ডারগুলো complete করা যায়নি।",
          },
          {
            status: 500,
          },
        );
      }

      const completedIds = (updatedOrders || []).map((order) => order.id);

      /*
       * Financial mutation এখানে নেই।
       * Audit logging best-effort; mutation already committed হতে পারে।
       */
      for (const orderId of completedIds) {
        await logAdminAction({
          adminId,
          actionType: "BULK_COMPLETE_ORDER",
          targetId: orderId,
          details: JSON.stringify({
            new_status: "completed",
            bulk_operation: true,
          }),
          ipAddress,
        });
      }

      return NextResponse.json({
        success: true,
        requestedCount: orderIds.length,
        completedCount: completedIds.length,
        skippedCount: orderIds.length - completedIds.length,
        completedOrderIds: completedIds,
        message: `${completedIds.length} টি অর্ডার completed হয়েছে।`,
      });
    }

    /* =====================================================
       6. VALIDATE CANCELLATION REASON
    ===================================================== */

    if (
      rawBody.cancelReason !== undefined &&
      rawBody.cancelReason !== null &&
      typeof rawBody.cancelReason !== "string"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Cancel reason must be text.",
        },
        {
          status: 400,
        },
      );
    }

    const cancelReason =
      typeof rawBody.cancelReason === "string"
        ? rawBody.cancelReason.trim()
        : "";

    if (!cancelReason) {
      return NextResponse.json(
        {
          success: false,
          error: "অর্ডার বাতিল করার কারণ উল্লেখ করা বাধ্যতামূলক।",
        },
        {
          status: 400,
        },
      );
    }

    if (cancelReason.length > 500) {
      return NextResponse.json(
        {
          success: false,
          error: "Cancel reason 500 characters-এর বেশি হতে পারবে না।",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       7. BULK CANCEL

       Each RPC call is individually atomic.
       Hardened wrapper ultimately calls admin_cancel_order().
    ===================================================== */

    const cancelledOrderIds: string[] = [];

    const failedOrders: Array<{
      orderId: string;
      reason: string;
    }> = [];

    for (const orderId of orderIds) {
      const { data, error } = await supabaseAdmin.rpc(
        "admin_cancel_order_with_refund",
        {
          p_order_id: orderId,
          p_admin_note: cancelReason,
        },
      );

      if (error) {
        console.error(`BULK CANCEL RPC ERROR for order ${orderId}:`, error);

        failedOrders.push({
          orderId,
          reason: "Order cancel করা যায়নি।",
        });

        continue;
      }

      if (!data?.success) {
        failedOrders.push({
          orderId,
          reason:
            typeof data?.message === "string"
              ? data.message
              : "Order cancel করা যায়নি।",
        });

        continue;
      }

      cancelledOrderIds.push(orderId);

      await logAdminAction({
        adminId,
        actionType: "BULK_CANCEL_ORDER",
        targetId: orderId,
        details: JSON.stringify({
          new_status: "cancelled",
          refund_created: Boolean(data.refund_created),
          admin_note: cancelReason,
          bulk_operation: true,
        }),
        ipAddress,
      });
    }

    /* =====================================================
       8. RESPONSE

       Bulk cancellation is NOT one database transaction.
       Therefore partial success is reported honestly.
    ===================================================== */

    if (cancelledOrderIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          requestedCount: orderIds.length,
          cancelledCount: 0,
          failedCount: failedOrders.length,
          failedOrders,
          error: "কোনো অর্ডার cancel করা যায়নি।",
        },
        {
          status: 409,
        },
      );
    }

    if (failedOrders.length > 0) {
      return NextResponse.json(
        {
          success: true,
          partialSuccess: true,
          requestedCount: orderIds.length,
          cancelledCount: cancelledOrderIds.length,
          failedCount: failedOrders.length,
          cancelledOrderIds,
          failedOrders,
          message: `${cancelledOrderIds.length} টি অর্ডার cancel হয়েছে, ${failedOrders.length} টি করা যায়নি।`,
        },
        {
          status: 207,
        },
      );
    }

    return NextResponse.json({
      success: true,
      partialSuccess: false,
      requestedCount: orderIds.length,
      cancelledCount: cancelledOrderIds.length,
      failedCount: 0,
      cancelledOrderIds,
      message: `${cancelledOrderIds.length} টি অর্ডার সফলভাবে cancel হয়েছে। Wallet payment হলে verified refund দেওয়া হয়েছে।`,
    });
  } catch (error) {
    console.error("BULK ACTION SERVER ERROR:", error);

    return NextResponse.json(
      {
        success: false,
        error: "সার্ভারে সমস্যা হয়েছে। রিকোয়েস্ট প্রসেস করা যায়নি।",
      },
      {
        status: 500,
      },
    );
  }
}
