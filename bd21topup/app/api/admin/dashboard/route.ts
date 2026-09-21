import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkUserRole } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authCheck = await checkUserRole(request, [
      "super_admin",
      "admin",
      "editor",
    ]);

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

    const isSuperAdmin = authCheck.role === "super_admin";

    const permissions = new Set(
      Array.isArray(authCheck.permissions) ? authCheck.permissions : [],
    );

    const canManageOrders = isSuperAdmin || permissions.has("manage_orders");

    const canManageUsers = isSuperAdmin || permissions.has("manage_users");

    const canManageAddMoney =
      isSuperAdmin || permissions.has("manage_add_money");

    const canManageWithdrawals =
      isSuperAdmin || permissions.has("manage_withdrawals");

    /* =====================================================
       Query only data this admin is allowed to access
    ===================================================== */

    const [
      totalOrdersResult,
      totalUsersResult,
      pendingOrdersResult,
      processingOrdersResult,
      completedOrdersResult,
      cancelledOrdersResult,
      addMoneyRequestsResult,
      withdrawalRequestsResult,
    ] = await Promise.all([
      canManageOrders
        ? supabaseAdmin
            .from("orders")
            .select("*", { count: "exact", head: true })
        : Promise.resolve({ count: 0, error: null }),

      canManageUsers
        ? supabaseAdmin
            .from("profiles")
            .select("*", { count: "exact", head: true })
        : Promise.resolve({ count: 0, error: null }),

      canManageOrders
        ? supabaseAdmin
            .from("orders")
            .select("*", { count: "exact", head: true })
            .eq("status", "pending")
        : Promise.resolve({ count: 0, error: null }),

      canManageOrders
        ? supabaseAdmin
            .from("orders")
            .select("*", { count: "exact", head: true })
            .eq("status", "processing")
        : Promise.resolve({ count: 0, error: null }),

      canManageOrders
        ? supabaseAdmin
            .from("orders")
            .select("*", { count: "exact", head: true })
            .eq("status", "completed")
        : Promise.resolve({ count: 0, error: null }),

      canManageOrders
        ? supabaseAdmin
            .from("orders")
            .select("*", { count: "exact", head: true })
            .eq("status", "cancelled")
        : Promise.resolve({ count: 0, error: null }),

      canManageAddMoney
        ? supabaseAdmin
            .from("add_money_requests")
            .select("*", { count: "exact", head: true })
            .eq("status", "pending")
        : Promise.resolve({ count: 0, error: null }),

      canManageWithdrawals
        ? supabaseAdmin
            .from("withdrawals")
            .select("*", { count: "exact", head: true })
            .eq("status", "pending")
        : Promise.resolve({ count: 0, error: null }),
    ]);

    /* =====================================================
       Detect database failures
    ===================================================== */

    const queryErrors = [
      totalOrdersResult.error,
      totalUsersResult.error,
      pendingOrdersResult.error,
      processingOrdersResult.error,
      completedOrdersResult.error,
      cancelledOrdersResult.error,
      addMoneyRequestsResult.error,
      withdrawalRequestsResult.error,
    ].filter(Boolean);

    if (queryErrors.length > 0) {
      console.error("ADMIN DASHBOARD QUERY ERROR:", queryErrors);

      return NextResponse.json(
        {
          success: false,
          error: "Dashboard statistics load করা যায়নি।",
        },
        {
          status: 500,
        },
      );
    }

    /* =====================================================
       Response
    ===================================================== */

    return NextResponse.json({
      success: true,

      access: {
        manageUsers: canManageUsers,
        manageOrders: canManageOrders,
        manageAddMoney: canManageAddMoney,
        manageWithdrawals: canManageWithdrawals,
      },

      stats: {
        totalOrders: totalOrdersResult.count ?? 0,
        totalUsers: totalUsersResult.count ?? 0,

        pendingOrders: pendingOrdersResult.count ?? 0,
        processingOrders: processingOrdersResult.count ?? 0,
        completedOrders: completedOrdersResult.count ?? 0,
        cancelledOrders: cancelledOrdersResult.count ?? 0,

        addMoneyRequests: addMoneyRequestsResult.count ?? 0,
        withdrawalRequests: withdrawalRequestsResult.count ?? 0,
      },
    });
  } catch (error) {
    console.error("ADMIN DASHBOARD ERROR:", error);

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
