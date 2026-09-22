import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadUserSupportCases } from "@/lib/support-cases";

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Login required." }, { status: 401 });
    }

    const accessToken = authHeader.replace("Bearer ", "").trim();

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(accessToken);

    if (authError || !user) {
      return NextResponse.json(
        { error: "Invalid or expired session." },
        { status: 401 },
      );
    }

    const { data: orders, error: ordersError } = await supabaseAdmin
      .from("orders")
      .select(
        `
          id,
          uid,
          player_name,
          product_name,
          package_name,
          amount,
          payment_method,
          receiver_number,
          transaction_id,
          status,
          created_at,
          admin_note,
          cancelled_at
          `,
      )
      .eq("user_id", user.id)
      .order("created_at", {
        ascending: false,
      });

    if (ordersError) {
      console.error("MY ORDERS ERROR:", ordersError);

      return NextResponse.json(
        {
          error: "Orders load করা যায়নি।",
        },
        {
          status: 500,
        },
      );
    }

    const cases = await loadUserSupportCases(user.id);
    return NextResponse.json({
      supportCasesAvailable: cases.available,
      success: true,
      orders: (orders ?? []).map((order) => ({
        ...order,
        support: cases.byOperation.get(`ORD:${order.id}`) ?? null,
      })),
    }, { headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });
  } catch (error) {
    console.error("MY ORDERS API ERROR:", error);

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
