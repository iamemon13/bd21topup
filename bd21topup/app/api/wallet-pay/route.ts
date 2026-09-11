import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { uid, playerName, packageName, amount } = body;

    const cleanUid = String(uid || "").trim();
    const cleanPlayerName = String(playerName || "").trim();
    const cleanPackageName = String(packageName || "").trim();
    const numericAmount = Number(amount);

    if (
      !cleanUid ||
      !cleanPlayerName ||
      !cleanPackageName ||
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0
    ) {
      return NextResponse.json(
        { success: false, message: "Missing or invalid payment data" },
        { status: 400 },
      );
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired session" },
        { status: 401 },
      );
    }

    // RPC কল করে Wallet থেকে পেমেন্ট কাটা
    const { data, error } = await supabaseAdmin.rpc("pay_with_wallet", {
      p_user_id: user.id,
      p_uid: cleanUid,
      p_player_name: cleanPlayerName,
      p_package_name: cleanPackageName,
      p_amount: numericAmount,
    });

    if (error) {
      return NextResponse.json(
        { success: false, message: error.message || "Wallet payment failed" },
        { status: 400 },
      );
    }

    // ওয়েবসাইটের নাম বের করা
    const accountName =
      user.user_metadata?.full_name || user.email?.split("@")[0] || "User";

    // ⚠️ আপডেট: এখানে account_name এর পাশাপাশি status: "pending" করে দেওয়া হলো
    await supabaseAdmin
      .from("orders")
      .update({
        account_name: accountName,
        status: "pending",
      })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1);

    return NextResponse.json(
      data ?? {
        success: false,
        message: "Wallet payment response পাওয়া যায়নি",
      },
    );
  } catch (error) {
    console.error("WALLET PAY SERVER ERROR:", error);
    return NextResponse.json(
      { success: false, message: "Server error" },
      { status: 500 },
    );
  }
}
