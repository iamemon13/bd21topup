import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // ১. লেটেস্ট অর্ডারগুলো নিয়ে আসা
    const { data: orders, error: ordersError } = await supabaseAdmin
      .from("orders")
      .select(
        "id, user_id, account_name, player_name, package_name, amount, status, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(10);

    if (ordersError) {
      console.error("RECENT ORDERS ERROR:", ordersError);
      return NextResponse.json(
        { error: "ডাটা লোড করা যায়নি" },
        { status: 500 },
      );
    }

    if (!orders || orders.length === 0) {
      return NextResponse.json({ success: true, orders: [] });
    }

    // ২. অর্ডারগুলোর ইউজার আইডি সংগ্রহ করা
    const userIds = Array.from(
      new Set(orders.map((o) => o.user_id).filter(Boolean)),
    );

    // ৩. profiles টেবিল থেকে avatar_url বা ছবি নিয়ে আসা
    let avatarMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, avatar_url") // যদি কলামের নাম অন্য কিছু হয় যেমন image হয়, তবে এখানে চেঞ্জ করতে হবে
        .in("id", userIds);

      if (profiles) {
        profiles.forEach((p) => {
          if (p.id && p.avatar_url) {
            avatarMap[p.id] = p.avatar_url;
          }
        });
      }

      // ৪. profiles টেবিলে ছবি না থাকলে auth.users এর metadata থেকে ছবি খোঁজা
      for (const uid of userIds) {
        if (!avatarMap[uid]) {
          const { data: authUser } =
            await supabaseAdmin.auth.admin.getUserById(uid);
          if (authUser?.user) {
            const meta = authUser.user.user_metadata;
            const authAvatar =
              meta?.avatar_url || meta?.picture || meta?.avatar;
            if (authAvatar) {
              avatarMap[uid] = authAvatar;
            }
          }
        }
      }
    }

    // ৫. অর্ডারের সাথে সঠিক ছবি যুক্ত করা
    const formattedOrders = orders.map((order) => ({
      ...order,
      profiles: {
        avatar_url: order.user_id ? avatarMap[order.user_id] || null : null,
      },
    }));

    return NextResponse.json({ success: true, orders: formattedOrders });
  } catch (error) {
    console.error("API ERROR:", error);
    return NextResponse.json({ error: "সার্ভার এরর" }, { status: 500 });
  }
}
