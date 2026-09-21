import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/*
  Public recent-order feed.

  Important:
  - Never return user_id
  - Never return profile/auth avatar
  - Never expose full or partially identifying names
*/
function maskName(name: string | null | undefined) {
  const cleanName = String(name || "").trim();

  if (!cleanName) {
    return "U***";
  }

  const firstCharacter = cleanName.charAt(0).toUpperCase();

  return firstCharacter ? `${firstCharacter}***` : "U***";
}

export async function GET() {
  try {
    const { data: orders, error } = await supabaseAdmin
      .from("orders")
      .select(
        `
          account_name,
          package_name,
          amount,
          status,
          created_at
        `,
      )
      .order("created_at", {
        ascending: false,
      })
      .limit(10);

    if (error) {
      console.error("RECENT ORDERS ERROR:", error);

      return NextResponse.json(
        {
          success: false,
          error: "ডাটা লোড করা যায়নি।",
        },
        {
          status: 500,
        },
      );
    }

    const formattedOrders = (orders ?? []).map((order) => ({
      account_name: maskName(order.account_name),
      package_name: order.package_name,
      amount: Number(order.amount || 0),
      status: order.status,
      created_at: order.created_at,

      // Keep response shape compatible with existing frontend
      // without exposing user avatars.
      profiles: {
        avatar_url: null,
      },
    }));

    return NextResponse.json({
      success: true,
      orders: formattedOrders,
    });
  } catch (error) {
    console.error("RECENT ORDERS API ERROR:", error);

    return NextResponse.json(
      {
        success: false,
        error: "সার্ভার এরর।",
      },
      {
        status: 500,
      },
    );
  }
}
