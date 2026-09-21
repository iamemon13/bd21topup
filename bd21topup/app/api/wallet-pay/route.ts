import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";

import { supabaseAdmin } from "@/lib/supabase-admin";

const walletOrderSchema = z.object({
  uid: z.coerce
    .string()
    .trim()
    .min(1, "UID required.")
    .max(100, "UID is too long."),

  playerName: z.coerce
    .string()
    .trim()
    .max(100, "Player name is too long.")
    .optional()
    .default(""),

  packageName: z.coerce
    .string()
    .trim()
    .min(1, "Package required.")
    .max(200, "Package name is too long."),
});

export async function POST(request: Request) {
  try {
    /* =====================================================
       1. AUTH
    ===================================================== */

    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          success: false,
          message: "অর্ডার করতে আগে Login করুন।",
        },
        {
          status: 401,
        },
      );
    }

    const accessToken = authHeader.slice(7).trim();

    if (!accessToken) {
      return NextResponse.json(
        {
          success: false,
          message: "অর্ডার করতে আগে Login করুন।",
        },
        {
          status: 401,
        },
      );
    }

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(accessToken);

    if (authError || !user) {
      return NextResponse.json(
        {
          success: false,
          message: "Login session শেষ হয়েছে। আবার Login করুন।",
        },
        {
          status: 401,
        },
      );
    }

    /* =====================================================
       2. SAFE JSON PARSING
    ===================================================== */

    let rawBody: unknown;

    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid JSON body.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       3. INPUT VALIDATION
    ===================================================== */

    const parsed = walletOrderSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: parsed.error.issues[0]?.message || "অর্ডারের তথ্য সঠিক নয়।",
        },
        {
          status: 400,
        },
      );
    }

    const { uid, playerName, packageName } = parsed.data;

    /*
     * Amount client থেকে নেওয়া হচ্ছে না।
     * process_wallet_payment RPC database-এর package price ব্যবহার করবে।
     */

    /* =====================================================
       4. SERVER GENERATED WALLET TRANSACTION ID
    ===================================================== */

    const txId = `WALLET-${crypto.randomUUID()}`;

    /* =====================================================
       5. ACCOUNT NAME
    ===================================================== */

    const accountName =
      typeof user.user_metadata?.full_name === "string" &&
      user.user_metadata.full_name.trim()
        ? user.user_metadata.full_name.trim().slice(0, 150)
        : typeof user.user_metadata?.name === "string" &&
            user.user_metadata.name.trim()
          ? user.user_metadata.name.trim().slice(0, 150)
          : user.email?.split("@")[0]?.slice(0, 150) || "User";

    /* =====================================================
       6. ATOMIC WALLET PAYMENT RPC
    ===================================================== */

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      "process_wallet_payment",
      {
        p_user_id: user.id,
        p_uid: uid,
        p_player_name: playerName,
        p_package_name: packageName,
        p_account_name: accountName,
        p_tx_id: txId,
      },
    );

    if (rpcError) {
      console.error("WALLET RPC ERROR:", rpcError);

      let status = 400;
      let message = "Transaction failed.";

      if (
        rpcError.message.includes("Invalid package") ||
        rpcError.message.includes("Invalid package price")
      ) {
        message = "Invalid package. সঠিক package নির্বাচন করুন।";
      } else if (rpcError.message.includes("Insufficient balance")) {
        message = "পর্যাপ্ত ওয়ালেট ব্যালেন্স নেই।";
      } else if (rpcError.message.includes("Profile not found")) {
        status = 404;
        message = "User profile পাওয়া যায়নি।";
      } else if (rpcError.message.includes("Invalid UID")) {
        message = "UID সঠিক নয়।";
      } else if (rpcError.message.includes("Invalid player name")) {
        message = "Player name সঠিক নয়।";
      } else if (rpcError.message.includes("Invalid account name")) {
        message = "Account information সঠিক নয়।";
      } else if (
        rpcError.message.includes("Invalid transaction ID") ||
        rpcError.message.includes("Invalid wallet transaction ID")
      ) {
        status = 500;
        message = "Wallet transaction তৈরি করা যায়নি।";
      } else if (rpcError.code === "23505") {
        status = 409;
        message = "Duplicate transaction detected. আবার চেষ্টা করুন।";
      } else if (rpcError.code === "23514") {
        message = "Transaction database validation pass করেনি।";
      } else if (rpcError.code === "23503") {
        status = 404;
        message = "Related account information পাওয়া যায়নি।";
      }

      return NextResponse.json(
        {
          success: false,
          message,
        },
        {
          status,
        },
      );
    }

    if (!rpcData?.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Transaction failed.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       7. RESPONSE
    ===================================================== */

    return NextResponse.json({
      success: true,
      message: "Order placed successfully! Pending admin confirmation.",
      order_id: rpcData.order_id,
      balance_after: Number(rpcData.balance_after),
      amount_deducted: Number(rpcData.amount_deducted),
    });
  } catch (error) {
    console.error("WALLET PAY ROUTE ERROR:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Server error occurred.",
      },
      {
        status: 500,
      },
    );
  }
}
