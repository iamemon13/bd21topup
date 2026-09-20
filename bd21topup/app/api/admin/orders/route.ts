import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkUserRole } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/* =========================================================
   GET - Load all orders
========================================================= */

export async function GET(request: Request) {
  try {
    // Super Admin অথবা manage_orders পারমিশন আছে এমন Admin/Editor অর্ডার দেখতে পারবে
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
       1. Check admin/editor role & manage_orders permission
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

    /* -----------------------------------------------------
       2. Read request body
    ----------------------------------------------------- */

    const body = await request.json();

    const orderId = String(body.orderId || "").trim();
    const nextStatus = String(body.status || "").trim();
    const adminNote = String(body.note || "").trim();

    if (!orderId) {
      return NextResponse.json(
        {
          error: orderId ? "" : "Order ID missing.",
        },
        {
          status: 400,
        },
      );
    }

    if (!nextStatus) {
      return NextResponse.json(
        {
          error: "Status missing.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       3. CANCEL ORDER
       
       Wallet orders are refunded by the database function.
    ==================================================== */

    if (nextStatus === "cancelled") {
      const { data, error } = await supabaseAdmin.rpc("admin_cancel_order", {
        p_order_id: orderId,
        p_admin_note: adminNote || null,
      });

      if (error) {
        console.error("ADMIN CANCEL ORDER ERROR:", error);

        return NextResponse.json(
          {
            success: false,
            error: error.message,
          },
          {
            status: 409,
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

      console.log(
        `ORDER CANCELLED: ${orderId}`,
        `refund=${data.refund_created}`,
      );

      /* ---------------------------------------------------
         Customer notification
      --------------------------------------------------- */

      const { data: cancelledOrder, error: orderReadError } =
        await supabaseAdmin
          .from("orders")
          .select(
            `
      id,
      user_id,
      package_name,
      amount
    `,
          )
          .eq("id", orderId)
          .maybeSingle();

      if (orderReadError) {
        console.error("CANCELLED ORDER READ ERROR:", orderReadError);
      }

      if (cancelledOrder?.user_id) {
        const refundText = data.refund_created
          ? ` ৳${Number(cancelledOrder.amount || 0).toFixed(2)} has been refunded to your wallet.`
          : "";

        const { error: notificationError } = await supabaseAdmin
          .from("notifications")
          .insert({
            user_id: cancelledOrder.user_id,
            title: "Order Cancelled ❌",
            message: `Your ${cancelledOrder.package_name} order has been cancelled. Reason: ${
              adminNote || "No reason provided"
            }.${refundText}`,
            type: "order",
            is_read: false,
          });

        if (notificationError) {
          console.error("CANCEL NOTIFICATION ERROR:", notificationError);
        } else {
          console.log(
            `CANCEL NOTIFICATION CREATED FOR USER: ${cancelledOrder.user_id}`,
          );
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
      });
    }

    /* -----------------------------------------------------
       4. Get current order
    ----------------------------------------------------- */

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
          error: "Order পাওয়া যায়নি।",
        },
        {
          status: 404,
        },
      );
    }

    /* -----------------------------------------------------
       5. Check user ID
    ----------------------------------------------------- */

    if (!currentOrder.user_id) {
      return NextResponse.json(
        {
          error: "এই order-এর সাথে কোনো user account যুক্ত নেই।",
        },
        {
          status: 409,
        },
      );
    }

    /* -----------------------------------------------------
       6. Allowed status transitions
    ----------------------------------------------------- */

    const allowedTransitions: Record<string, string[]> = {
      pending: ["processing", "completed", "rejected"],
      approved: ["processing", "completed"],
      processing: ["completed"],
      completed: [],
      rejected: [],
      cancelled: [],
    };

    const allowedNextStatuses = allowedTransitions[currentOrder.status] || [];

    if (!allowedNextStatuses.includes(nextStatus)) {
      return NextResponse.json(
        {
          error: `${currentOrder.status} থেকে ${nextStatus} করা যাবে না।`,
        },
        {
          status: 409,
        },
      );
    }

    /* -----------------------------------------------------
       7. Update order status
    ----------------------------------------------------- */

    const { data: updatedOrder, error: updateError } = await supabaseAdmin
      .from("orders")
      .update({
        status: nextStatus,
        admin_note: null,
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
          error:
            "Order status ইতোমধ্যে পরিবর্তন হয়েছে। Refresh করে আবার চেষ্টা করুন।",
        },
        {
          status: 409,
        },
      );
    }

    console.log(
      `ORDER STATUS UPDATED: ${updatedOrder.id} -> ${updatedOrder.status}`,
    );

    /* =====================================================
       8. Customer notification
    ===================================================== */

    let notificationTitle = "Order Update";
    let notificationMessage = "Your order status has been updated.";

    if (nextStatus === "rejected") {
      notificationTitle = "Order Rejected ❌";
      notificationMessage = `Your ${currentOrder.package_name} order has been rejected. Please contact support if you need help.`;
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
    } else {
      console.log(`NOTIFICATION CREATED FOR USER: ${currentOrder.user_id}`);
    }

    /* -----------------------------------------------------
       9. Return response
    ----------------------------------------------------- */

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
        error: "Server error.",
      },
      {
        status: 500,
      },
    );
  }
}
