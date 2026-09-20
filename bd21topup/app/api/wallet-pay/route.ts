import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import crypto from "crypto";

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, message: "অর্ডার করতে আগে Login করুন।" },
        { status: 401 },
      );
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json(
        {
          success: false,
          message: "Login session শেষ হয়েছে। আবার Login করুন।",
        },
        { status: 401 },
      );
    }

    const body = await request.json();
    const { uid, playerName, packageName } = body; 
    // ⚠️ amount ক্লায়েন্ট থেকে আর নেওয়া হচ্ছে না

    const cleanUid = String(uid || "").trim();
    const cleanPlayerName = String(playerName || "").trim();
    const cleanPackageName = String(packageName || "").trim();

    if (!cleanUid || !cleanPackageName) {
      return NextResponse.json(
        { success: false, message: "UID এবং Package Name সঠিকভাবে প্রদান করুন।" },
        { status: 400 },
      );
    }

    const txId = `WALLET-${crypto.randomUUID()}`;
    const accountName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email?.split("@")[0] ||
      "User";

    // ==========================================
    // 🔒 SECURITY FIX: ATOMIC RPC CALL
    // ==========================================
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      "process_wallet_payment",
      {
        p_user_id: user.id,
        p_uid: cleanUid,
        p_player_name: cleanPlayerName,
        p_package_name: cleanPackageName,
        p_account_name: accountName,
        p_tx_id: txId,
      }
    );

    if (rpcError) {
      console.error("WALLET RPC ERROR:", rpcError);
      
      let errorMessage = "Transaction failed.";
      if (rpcError.message.includes("Invalid package")) {
        errorMessage = "Invalid package. সঠিক প্যাকেজ নির্বাচন করুন।";
      } else if (rpcError.message.includes("Insufficient balance")) {
        errorMessage = "পর্যাপ্ত ওয়ালেট ব্যালেন্স নেই।";
      } else if (rpcError.message.includes("Profile not found")) {
        errorMessage = "User profile পাওয়া যায়নি।";
      }

      return NextResponse.json(
        { success: false, message: errorMessage },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Order placed successfully! Pending admin confirmation.",
      order_id: rpcData.order_id,
      balance_after: rpcData.balance_after,
      amount_deducted: rpcData.amount_deducted,
    });
  } catch (error) {
    console.error("WALLET PAY ROUTE ERROR:", error);
    return NextResponse.json(
      { success: false, message: "Server error occurred." },
      { status: 500 },
    );
  }
}
