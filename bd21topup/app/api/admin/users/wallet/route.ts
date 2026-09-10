import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function getAuthenticatedAdmin(request: Request) {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return {
      user: null,
      error: "Unauthorized",
    };
  }

  const token = authHeader.replace("Bearer ", "").trim();

  if (!token) {
    return {
      user: null,
      error: "Unauthorized",
    };
  }

  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(token);

  if (authError || !user) {
    return {
      user: null,
      error: "Invalid or expired session.",
    };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return {
      user: null,
      error: "Admin profile not found.",
    };
  }

  if (profile.role !== "admin") {
    return {
      user: null,
      error: "Admin access required.",
    };
  }

  return {
    user,
    error: null,
  };
}

export async function POST(request: Request) {
  try {
    // =====================================================
    // 1. ADMIN AUTHENTICATION
    // =====================================================

    const auth = await getAuthenticatedAdmin(request);

    if (!auth.user) {
      return NextResponse.json(
        {
          error: auth.error || "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    // =====================================================
    // 2. READ REQUEST
    // =====================================================

    const body = await request.json();

    const userId = String(body.userId || "").trim();
    const action = String(body.action || "")
      .trim()
      .toLowerCase();
    const note = String(body.note || "").trim();

    const amount = Number(body.amount);

    // =====================================================
    // 3. VALIDATION
    // =====================================================

    if (!userId || !action) {
      return NextResponse.json(
        {
          error: "Missing required fields.",
        },
        {
          status: 400,
        },
      );
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        {
          error: "Amount must be greater than 0.",
        },
        {
          status: 400,
        },
      );
    }

    if (action !== "add" && action !== "remove") {
      return NextResponse.json(
        {
          error: "Invalid action.",
        },
        {
          status: 400,
        },
      );
    }

    // =====================================================
    // 4. FIND TARGET USER
    // =====================================================

    const { data: user, error: userError } = await supabaseAdmin
      .from("profiles")
      .select("id, wallet_balance, full_name")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        {
          error: "User not found.",
        },
        {
          status: 404,
        },
      );
    }

    const currentBalance = Number(user.wallet_balance || 0);

    // =====================================================
    // 5. CALCULATE NEW BALANCE
    // =====================================================

    let newBalance = currentBalance;
    let direction: "credit" | "debit";

    if (action === "add") {
      newBalance = currentBalance + amount;
      direction = "credit";
    } else {
      newBalance = currentBalance - amount;
      direction = "debit";
    }

    // =====================================================
    // 6. NEVER ALLOW NEGATIVE WALLET
    // =====================================================

    if (newBalance < 0) {
      return NextResponse.json(
        {
          error: "Insufficient wallet balance.",
        },
        {
          status: 400,
        },
      );
    }

    // =====================================================
    // 7. UPDATE WALLET
    // =====================================================

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({
        wallet_balance: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (updateError) {
      console.error("WALLET UPDATE ERROR:", updateError);

      return NextResponse.json(
        {
          error: "Wallet update failed.",
        },
        {
          status: 500,
        },
      );
    }

    // =====================================================
    // 8. SAVE WALLET TRANSACTION
    // =====================================================

    const { error: transactionError } = await supabaseAdmin
      .from("wallet_transactions")
      .insert({
        user_id: userId,
        type: "adjustment",
        direction,
        amount,
        balance_after: newBalance,
        description:
          note ||
          (action === "add"
            ? "Wallet balance added by admin"
            : "Wallet balance removed by admin"),
      });

    if (transactionError) {
      console.error("WALLET TRANSACTION ERROR:", transactionError);

      // Roll back the wallet update if transaction logging fails.
      await supabaseAdmin
        .from("profiles")
        .update({
          wallet_balance: currentBalance,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      return NextResponse.json(
        {
          error: "Wallet transaction could not be recorded.",
        },
        {
          status: 500,
        },
      );
    }

    // =====================================================
    // 9. NOTIFICATION
    // =====================================================

    const { error: notificationError } = await supabaseAdmin
      .from("notifications")
      .insert({
        user_id: userId,
        title: "Wallet Updated",
        message:
          action === "add"
            ? `৳${amount} added to your wallet`
            : `৳${amount} removed from your wallet`,
        type: "wallet",
        is_read: false,
      });

    if (notificationError) {
      console.error("WALLET NOTIFICATION ERROR:", notificationError);

      // Wallet update and transaction are already successful.
      // Notification failure should not undo the financial transaction.
    }

    // =====================================================
    // 10. SUCCESS
    // =====================================================

    return NextResponse.json({
      success: true,
      newBalance,
    });
  } catch (error) {
    console.error("WALLET UPDATE SERVER ERROR:", error);

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
