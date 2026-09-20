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
        { error: authCheck.error },
        { status: authCheck.status },
      );
    }

    // =====================================================
    // 3. Total Orders
    // =====================================================

    const { count: totalOrders } = await supabaseAdmin
      .from("orders")
      .select("*", { count: "exact", head: true });

    // =====================================================
    // 4. Total Users
    // =====================================================

    const { count: totalUsers } = await supabaseAdmin
      .from("profiles")
      .select("*", { count: "exact", head: true });

    // =====================================================
    // 5. Pending Orders
    // =====================================================

    const { count: pendingOrders } = await supabaseAdmin
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");

    // =====================================================
    // 6. Processing Orders
    // =====================================================

    const { count: processingOrders } = await supabaseAdmin
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "processing");

    // =====================================================
    // 7. Completed Orders
    // =====================================================

    const { count: completedOrders } = await supabaseAdmin
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "completed");

    // =====================================================
    // 8. Cancelled Orders
    // =====================================================

    const { count: cancelledOrders } = await supabaseAdmin
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "cancelled");

    // =====================================================
    // 9. Add Money Requests
    // =====================================================

    const { count: addMoneyRequests } = await supabaseAdmin
      .from("add_money_requests")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");

    // =====================================================
    // 10. Withdrawal Requests (Pending)
    // =====================================================

    const { count: withdrawalRequests } = await supabaseAdmin
      .from("withdrawals")
      .select("*", { count: "exact", head: true })
      .ilike("status", "pending");

    // =====================================================
    // 11. Return Dashboard Stats
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
        withdrawalRequests: withdrawalRequests || 0,
      },
    });
  } catch (error) {
    console.error("ADMIN DASHBOARD ERROR:", error);

    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
