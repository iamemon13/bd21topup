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

    // RPC কল করে Wallet থেকে পেমেন্ট কাটা এবং অর্ডার তৈরি
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

    // RPC যদি সফলভাবে নতুন অর্ডারের ID বা অবজেক্ট রিটার্ন করে থাকে, তবে শুধু সেই নির্দিষ্ট অর্ডারের account_name আপডেট হবে
    const createdOrderId = data?.order_id || data?.id;

    if (createdOrderId) {
      const { data: profileData } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();

      const accountName =
        profileData?.full_name ||
        user.user_metadata?.full_name ||
        user.email?.split("@")[0] ||
        "User";

      await supabaseAdmin
        .from("orders")
        .update({
          account_name: accountName,
        })
        .eq("id", createdOrderId);
    }

    return NextResponse.json(
      data ?? {
        success: true,
        message: "Order placed successfully",
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
