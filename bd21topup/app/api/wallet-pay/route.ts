import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { uid, playerName, packageName, amount } = body;

    // =====================================================
    // VALIDATE INPUT
    // =====================================================

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
        {
          success: false,
          message: "Missing or invalid payment data",
        },
        { status: 400 },
      );
    }

    // =====================================================
    // GET ACCESS TOKEN
    // =====================================================

    const authHeader = request.headers.get("authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized",
        },
        { status: 401 },
      );
    }

    const token = authHeader.replace("Bearer ", "").trim();

    if (!token) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized",
        },
        { status: 401 },
      );
    }

    // =====================================================
    // VERIFY USER
    // =====================================================

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      console.error("WALLET PAY AUTH ERROR:", userError);

      return NextResponse.json(
        {
          success: false,
          message: "Invalid or expired session",
        },
        { status: 401 },
      );
    }

    // =====================================================
    // PAY WITH WALLET
    // =====================================================

    const { data, error } = await supabaseAdmin.rpc("pay_with_wallet", {
      p_user_id: user.id,
      p_uid: cleanUid,
      p_player_name: cleanPlayerName,
      p_package_name: cleanPackageName,
      p_amount: numericAmount,
    });

    if (error) {
      console.error("WALLET PAY RPC ERROR:", error);

      return NextResponse.json(
        {
          success: false,
          message: error.message || "Wallet payment failed",
        },
        { status: 400 },
      );
    }

    // =====================================================
    // RPC RESPONSE
    // =====================================================

    return NextResponse.json(
      data ?? {
        success: false,
        message: "Wallet payment response পাওয়া যায়নি",
      },
    );
  } catch (error) {
    console.error("WALLET PAY SERVER ERROR:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Server error",
      },
      { status: 500 },
    );
  }
}
