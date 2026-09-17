import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    // =====================================================
    // 1. Check admin authentication
    // =====================================================

    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const accessToken = authHeader.replace("Bearer ", "").trim();

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(accessToken);

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // =====================================================
    // 2. Role-Based Access Check (Profiles Table)
    // =====================================================

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    const userRole = profile?.role || "user";

    // সাধারণ ইউজার (user) হলে ড্যাশবোর্ডে ঢোকার অনুমতি দেওয়া যাবে না
    if (profileError || userRole === "user") {
      return NextResponse.json(
        { error: "Forbidden: Access Denied" },
        { status: 403 }
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
      { error: "Server error" },
      { status: 500 }
    );
  }
}
