import { NextResponse } from "next/server";
import { supabaseAdmin, logAdminAction } from "@/lib/supabase-admin";
import { checkUserRole } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_STATUSES = new Set([
  "processing",
  "completed",
  "rejected",
  "cancelled",
]);

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending: ["processing", "completed", "rejected"],
  approved: ["processing", "completed"],
  processing: ["completed"],
  completed: [],
  rejected: [],
  cancelled: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidUuid(value: string) {
  return UUID_REGEX.test(value);
}

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/* =========================================================
   GET - Load all orders
========================================================= */

export async function GET(request: Request) {
  try {
    const authCheck = await checkUserRole(
      request,
      ["super_admin", "admin", "editor"],
      "manage_orders",
    );

    if ("error" in authCheck) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("orders")
      .select(
        `
          id,
          user_id,
          uid,
          player_name,
          product_name,
          package_name,
          amount,
          payment_method,
          receiver_number,
          transaction_id,
          status,
          admin_note,
          cancelled_at,
          created_at
        `,
      )
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      console.error("ADMIN ORDERS ERROR:", error);

      return NextResponse.json(
        {
          error: "Orders load করা যায়নি।",
        },
        {
          status: 500,
        },
      );
    }

    return NextResponse.json({
      success: true,
      orders: data || [],
    });
  } catch (error) {
    console.error("ADMIN ORDERS API ERROR:", error);

    return NextResponse.json(
      {
        error: "Server error.",
      },
      {
        status: 500,
      },
    );
  }
}

/* =========================================================
   PATCH - Change order status
========================================================= */

export async function PATCH(request: Request) {
  try {
    /* -----------------------------------------------------
       1. Auth + permission
    ----------------------------------------------------- */

    const authCheck = await checkUserRole(
      request,
      ["super_admin", "admin", "editor"],
      "manage_orders",
    );

    if ("error" in authCheck) {
      return NextResponse.json(
        {
          error: authCheck.error,
        },
        {
          status: authCheck.status,
        },
      );
    }

    const adminId = authCheck.user.id;
    const ipAddress = getClientIp(request);

    /* -----------------------------------------------------
       2. Safe JSON parsing
    ----------------------------------------------------- */

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

    /* -----------------------------------------------------
       3. Validate Order ID
    ----------------------------------------------------- */

    if (typeof rawBody.orderId !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "Order ID missing.",
        },
        {
          status: 400,
        },
      );
    }

    const orderId = rawBody.orderId.trim();

    if (!orderId) {
      return NextResponse.json(
        {
          success: false,
          error: "Order ID missing.",
        },
        {
          status: 400,
        },
      );
    }

    if (!isValidUuid(orderId)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid Order ID.",
        },
        {
          status: 400,
        },
      );
    }

    /* -----------------------------------------------------
       4. Validate requested status
    ----------------------------------------------------- */

    if (typeof rawBody.status !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "Status missing.",
        },
        {
          status: 400,
        },
      );
    }

    const nextStatus = rawBody.status.trim().toLowerCase();

    if (!ALLOWED_STATUSES.has(nextStatus)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid order status.",
        },
        {
          status: 400,
        },
      );
    }

    /* -----------------------------------------------------
       5. Validate admin note
    ----------------------------------------------------- */

    if (
      rawBody.note !== undefined &&
      rawBody.note !== null &&
      typeof rawBody.note !== "string"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Admin note must be text.",
        },
        {
          status: 400,
        },
      );
    }

    const adminNote =
      typeof rawBody.note === "string" ? rawBody.note.trim() : "";

    if (adminNote.length > 500) {
      return NextResponse.json(
        {
          success: false,
          error: "Admin note cannot exceed 500 characters.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       6. CANCEL ORDER

       Refund logic lives inside hardened admin_cancel_order().
       Only real wallet-paid orders may receive wallet refund.
    ===================================================== */

    if (nextStatus === "cancelled") {
      const { data, error } = await supabaseAdmin.rpc("admin_cancel_order", {
        p_order_id: orderId,
        p_admin_note: adminNote || null,
      });

      if (error) {
        console.error("ADMIN CANCEL ORDER ERROR:", error);

        let status = 409;
        let message = "Order cancel করা যায়নি।";

        if (error.message.includes("Order not found")) {
          status = 404;
          message = "Order পাওয়া যায়নি।";
        } else if (
          error.message.includes("cannot be cancelled") ||
          error.message.includes("Refund already processed")
        ) {
          status = 409;
          message = "এই order বর্তমানে cancel করা যাবে না।";
        } else if (
          error.message.includes(
            "Original wallet payment transaction not found",
          )
        ) {
          status = 409;
          message =
            "Wallet payment record verify করা যায়নি। Order cancel করা হয়নি।";
        } else if (error.message.includes("User profile not found")) {
          status = 409;
          message = "Order-এর user profile পাওয়া যায়নি।";
        }

        return NextResponse.json(
          {
            success: false,
            error: message,
          },
          {
            status,
          },
        );
      }

      if (!data?.success) {
        return NextResponse.json(
          {
            success: false,
            error: "Order cancel করা যায়নি।",
          },
          {
            status: 409,
          },
        );
      }

      /* ---------------------------------------------------
         Audit log
      --------------------------------------------------- */

      await logAdminAction({
        adminId,
        actionType: "CANCEL_ORDER",
        targetId: orderId,
        details: JSON.stringify({
          status: "cancelled",
          refund_created: Boolean(data.refund_created),
          admin_note: adminNote || null,
        }),
        ipAddress,
      });

      /* ---------------------------------------------------
         Load order metadata for notification
      --------------------------------------------------- */

      const { data: cancelledOrder, error: orderReadError } =
        await supabaseAdmin
          .from("orders")
          .select(
            `
              id,
              user_id,
              package_name,
              amount,
              payment_method
            `,
          )
          .eq("id", orderId)
          .maybeSingle();

      if (orderReadError) {
        console.error("CANCELLED ORDER READ ERROR:", orderReadError);
      }

      let notificationCreated = false;

      if (cancelledOrder?.user_id) {
        const refundText = data.refund_created
          ? ` ৳${Number(cancelledOrder.amount || 0).toFixed(
              2,
            )} has been refunded to your wallet.`
          : "";

        const reasonText = adminNote ? ` Reason: ${adminNote}.` : "";

        const { error: notificationError } = await supabaseAdmin
          .from("notifications")
          .insert({
            user_id: cancelledOrder.user_id,
            title: "Order Cancelled ❌",
            message: `Your ${cancelledOrder.package_name} order has been cancelled.${reasonText}${refundText}`,
            type: "order",
            is_read: false,
          });

        if (notificationError) {
          console.error("CANCEL NOTIFICATION ERROR:", notificationError);
        } else {
          notificationCreated = true;
        }
      }

      return NextResponse.json({
        success: true,
        order: {
          id: orderId,
          status: "cancelled",
        },
        refundCreated: Boolean(data.refund_created),
        balanceAfter:
          data.balance_after !== null && data.balance_after !== undefined
            ? Number(data.balance_after)
            : null,
        notificationCreated,
      });
    }

    /* =====================================================
       7. Load current order
    ===================================================== */

    const { data: currentOrder, error: readError } = await supabaseAdmin
      .from("orders")
      .select(
        `
          id,
          user_id,
          uid,
          player_name,
          product_name,
          package_name,
          amount,
          status
        `,
      )
      .eq("id", orderId)
      .maybeSingle();

    if (readError) {
      console.error("ORDER READ ERROR:", readError);

      return NextResponse.json(
        {
          success: false,
          error: "Order load করা যায়নি।",
        },
        {
          status: 500,
        },
      );
    }

    if (!currentOrder) {
      return NextResponse.json(
        {
          success: false,
          error: "Order পাওয়া যায়নি।",
        },
        {
          status: 404,
        },
      );
    }

    if (!currentOrder.user_id) {
      return NextResponse.json(
        {
          success: false,
          error: "এই order-এর সাথে কোনো user account যুক্ত নেই।",
        },
        {
          status: 409,
        },
      );
    }

    /* =====================================================
       8. Validate status transition
    ===================================================== */

    const allowedNextStatuses = ALLOWED_TRANSITIONS[currentOrder.status] || [];

    if (!allowedNextStatuses.includes(nextStatus)) {
      return NextResponse.json(
        {
          success: false,
          error: `${currentOrder.status} থেকে ${nextStatus} করা যাবে না।`,
        },
        {
          status: 409,
        },
      );
    }

    /* =====================================================
       9. Optimistic-concurrency status update
    ===================================================== */

    const { data: updatedOrder, error: updateError } = await supabaseAdmin
      .from("orders")
      .update({
        status: nextStatus,
        admin_note: adminNote || null,
        cancelled_at: null,
      })
      .eq("id", orderId)
      .eq("status", currentOrder.status)
      .select(
        `
          id,
          user_id,
          uid,
          player_name,
          product_name,
          package_name,
          amount,
          status
        `,
      )
      .maybeSingle();

    if (updateError) {
      console.error("ORDER STATUS UPDATE ERROR:", updateError);

      return NextResponse.json(
        {
          success: false,
          error: "Order status update করা যায়নি।",
        },
        {
          status: 500,
        },
      );
    }

    if (!updatedOrder) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Order status ইতোমধ্যে পরিবর্তন হয়েছে। Refresh করে আবার চেষ্টা করুন।",
        },
        {
          status: 409,
        },
      );
    }

    /* =====================================================
       10. Audit log
    ===================================================== */

    let auditAction = "UPDATE_ORDER_STATUS";

    if (nextStatus === "rejected") {
      auditAction = "REJECT_ORDER";
    } else if (nextStatus === "processing") {
      auditAction = "PROCESS_ORDER";
    } else if (nextStatus === "completed") {
      auditAction = "COMPLETE_ORDER";
    }

    await logAdminAction({
      adminId,
      actionType: auditAction,
      targetId: orderId,
      details: JSON.stringify({
        previous_status: currentOrder.status,
        new_status: nextStatus,
        admin_note: adminNote || null,
      }),
      ipAddress,
    });

    /* =====================================================
       11. Customer notification
    ===================================================== */

    let notificationTitle = "Order Update";
    let notificationMessage = "Your order status has been updated.";

    if (nextStatus === "rejected") {
      notificationTitle = "Order Rejected ❌";

      notificationMessage = adminNote
        ? `Your ${currentOrder.package_name} order has been rejected. Reason: ${adminNote}.`
        : `Your ${currentOrder.package_name} order has been rejected. Please contact support if you need help.`;
    } else if (nextStatus === "processing") {
      notificationTitle = "Order Processing 🔄";
      notificationMessage = `Your ${currentOrder.package_name} order is now being processed.`;
    } else if (nextStatus === "completed") {
      notificationTitle = "Order Completed 🎉";
      notificationMessage = `Your ${currentOrder.package_name} order has been completed successfully.`;
    }

    const { error: notificationError } = await supabaseAdmin
      .from("notifications")
      .insert({
        user_id: currentOrder.user_id,
        title: notificationTitle,
        message: notificationMessage,
        type: "order",
        is_read: false,
      });

    if (notificationError) {
      console.error("NOTIFICATION INSERT ERROR:", notificationError);
    }

    /* =====================================================
       12. Response
    ===================================================== */

    return NextResponse.json({
      success: true,
      order: {
        id: updatedOrder.id,
        status: updatedOrder.status,
      },
      notificationCreated: !notificationError,
    });
  } catch (error) {
    console.error("ADMIN ORDER UPDATE API ERROR:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Server error.",
      },
      {
        status: 500,
      },
    );
  }
}
