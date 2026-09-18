import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // ১. প্রথমে লেটেস্ট অর্ডারগুলো নিয়ে আসা যাক
    const { data: orders, error: ordersError } = await supabaseAdmin
      .from("orders")
      .select("id, user_id, account_name, player_name, package_name, amount, status, created_at")
      .order("created_at", { ascending: false })
      .limit(10);

    if (ordersError) {
      console.error("RECENT ORDERS ERROR:", ordersError);
      return NextResponse.json({ error: "ডাটা লোড করা যায়নি" }, { status: 500 });
    }

    if (!orders || orders.length === 0) {
      return NextResponse.json({ success: true, orders: [] });
    }

    // ২. অর্ডারগুলোর ইউজার আইডি সংগ্রহ করা
    const userIds = Array.from(new Set(orders.map((o) => o.user_id).filter(Boolean)));

    // ৩. ঐ ইউজারদের প্রোফাইল পিকচার বা avatar_url আলাদাভাবে ফেচ করা
    let profileMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, avatar_url")
        .in("id", userIds);

      if (profiles) {
        profiles.forEach((p) => {
          if (p.id && p.avatar_url) {
            profileMap[p.id] = p.avatar_url;
          }
        });
      }
    }

    // ৪. অর্ডারের সাথে প্রোফাইল পিকচার যুক্ত করা
    const formattedOrders = orders.map((order) => ({
      ...order,
      profiles: {
        avatar_url: order.user_id ? profileMap[order.user_id] || null : null,
      },
    }));

    return NextResponse.json({ success: true, orders: formattedOrders });
  } catch (error) {
    console.error("API ERROR:", error);
    return NextResponse.json({ error: "সার্ভার এরর" }, { status: 500 });
  }
}
