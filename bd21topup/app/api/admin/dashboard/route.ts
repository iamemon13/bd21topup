import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  try {
    // =====================================================
    // 1. Check admin authentication
    // =====================================================

    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          error: "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    const accessToken = authHeader.replace("Bearer ", "").trim();

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(accessToken);

    if (authError || !user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    // =====================================================
    // 2. Admin check
    // =====================================================

    if (user.id !== process.env.ADMIN_USER_ID) {
      return NextResponse.json(
        {
          error: "Forbidden",
        },
        {
          status: 403,
        },
      );
    }

    // =====================================================
    // 3. Total Orders
    // =====================================================

    const { count: totalOrders, error: totalOrdersError } = await supabaseAdmin
      .from("orders")
      .select("*", {
        count: "exact",
        head: true,
      });

    if (totalOrdersError) {
      console.error("TOTAL ORDERS ERROR:", totalOrdersError);
    }

    // =====================================================
    // 4. Total Users
    // =====================================================

    const { count: totalUsers, error: totalUsersError } = await supabaseAdmin
      .from("profiles")
      .select("*", {
        count: "exact",
        head: true,
      });

    if (totalUsersError) {
      console.error("TOTAL USERS ERROR:", totalUsersError);
    }

    // =====================================================
    // 5. Pending Orders
    // =====================================================

    const { count: pendingOrders, error: pendingOrdersError } =
      await supabaseAdmin
        .from("orders")
        .select("*", {
          count: "exact",
          head: true,
        })
        .eq("status", "pending");

    if (pendingOrdersError) {
      console.error("PENDING ORDERS ERROR:", pendingOrdersError);
    }

    // =====================================================
    // 6. Processing Orders
    // =====================================================

    const { count: processingOrders, error: processingOrdersError } =
      await supabaseAdmin
        .from("orders")
        .select("*", {
          count: "exact",
          head: true,
        })
        .eq("status", "processing");

    if (processingOrdersError) {
      console.error("PROCESSING ORDERS ERROR:", processingOrdersError);
    }

    // =====================================================
    // 7. Completed Orders
    // =====================================================

    const { count: completedOrders, error: completedOrdersError } =
      await supabaseAdmin
        .from("orders")
        .select("*", {
          count: "exact",
          head: true,
        })
        .eq("status", "completed");

    if (completedOrdersError) {
      console.error("COMPLETED ORDERS ERROR:", completedOrdersError);
    }

    // =====================================================
    // 8. Cancelled Orders
    // =====================================================

    const { count: cancelledOrders, error: cancelledOrdersError } =
      await supabaseAdmin
        .from("orders")
        .select("*", {
          count: "exact",
          head: true,
        })
        .eq("status", "cancelled");

    if (cancelledOrdersError) {
      console.error("CANCELLED ORDERS ERROR:", cancelledOrdersError);
    }

    // =====================================================
    // 9. Add Money Requests
    // =====================================================

    const { count: addMoneyRequests, error: addMoneyError } =
      await supabaseAdmin
        .from("add_money_requests")
        .select("*", {
          count: "exact",
          head: true,
        })
        .eq("status", "pending");

    if (addMoneyError) {
      console.error("ADD MONEY ERROR:", addMoneyError);
    }

    // =====================================================
    // 10. Return Dashboard Stats
    // =====================================================

    return NextResponse.json({
      success: true,

      stats: {
        totalOrders: totalOrders || 0,

        totalUsers: totalUsers || 0,

        pendingOrders: pendingOrders || 0,

        processingOrders: processingOrders || 0,

        completedOrders: completedOrders || 0,

        cancelledOrders: cancelledOrders || 0,

        addMoneyRequests: addMoneyRequests || 0,
      },
    });
  } catch (error) {
    console.error("ADMIN DASHBOARD ERROR:", error);

    return NextResponse.json(
      {
        error: "Server error",
      },
      {
        status: 500,
      },
    );
  }
}
