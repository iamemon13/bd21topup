import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET: ইউজারের নিজের অর্ডার হিস্ট্রি লোড করা
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
         cancelled_at,
         account_name
      `,
      )
      .eq("user_id", user.id)
      .order("created_at", {
        ascending: false,
      });

    if (ordersError) {
      console.error("MY ORDERS ERROR:", ordersError);
      return NextResponse.json(
        { error: "Orders load করা যায়নি।" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      orders: orders ?? [],
    });
  } catch (error) {
    console.error("MY ORDERS API ERROR:", error);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}

// POST: নতুন অর্ডার বা ইনস্ট্যান্ট পেমেন্ট সাবমিট করা
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const body = await request.json();
    const {
      uid,
      playerName,
      packageName,
      amount,
      receiverNumber,
      paymentMethod,
      transactionId,
    } = body;

    if (!uid || !packageName || !paymentMethod || !transactionId) {
      return NextResponse.json(
        { error: "Required fields are missing." },
        { status: 400 },
      );
    }

    // ইউজারের মেটাডাটা থেকে আসল নাম বের করা হচ্ছে, না পেলে ইমেইলের প্রথম অংশ ব্যবহার করবে
    const accName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email?.split("@")[0] ||
      "User";

    const { data, error } = await supabaseAdmin
      .from("orders")
      .insert({
        user_id: user.id,
        account_name: accName, // <-- এখানে account_name যোগ করা হয়েছে
        uid: uid,
        player_name: playerName || "",
        package_name: packageName,
        amount: amount || 0,
        receiver_number: receiverNumber || "",
        payment_method: paymentMethod,
        transaction_id: transactionId.trim(),
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "এই Transaction ID ইতিমধ্যে ব্যবহার করা হয়েছে।" },
          { status: 409 },
        );
      }
      console.error("ORDER INSERT ERROR:", error);
      return NextResponse.json(
        { error: "Order save করা যায়নি।" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, order: data });
  } catch (err) {
    console.error("ORDERS API SERVER ERROR:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
