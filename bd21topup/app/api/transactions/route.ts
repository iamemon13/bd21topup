import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  try {
    // =====================================================
    // AUTH
    // =====================================================

    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          success: false,
          error: "Login required.",
        },
        { status: 401 },
      );
    }

    const accessToken = authHeader.replace("Bearer ", "").trim();

    if (!accessToken) {
      return NextResponse.json(
        {
          success: false,
          error: "Login required.",
        },
        { status: 401 },
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
          error: "Invalid or expired session.",
        },
        { status: 401 },
      );
    }

    // =====================================================
    // ORDER TRANSACTIONS
    // =====================================================

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
          transaction_id,
          status,
          created_at
        `,
      )
      .eq("user_id", user.id)
      .order("created_at", {
        ascending: false,
      });

    if (ordersError) {
      console.error("TRANSACTIONS ORDERS ERROR:", ordersError);

      return NextResponse.json(
        {
          success: false,
          error: "Order transactions load করা যায়নি।",
        },
        { status: 500 },
      );
    }

    // =====================================================
    // WALLET TRANSACTIONS
    // =====================================================

    const { data: walletRows, error: walletError } = await supabaseAdmin
      .from("wallet_transactions")
      .select(
        `
          id,
          type,
          direction,
          amount,
          balance_after,
          reference_id,
          description,
          created_at
        `,
      )
      .eq("user_id", user.id)
      .order("created_at", {
        ascending: false,
      });

    if (walletError) {
      console.error("WALLET TRANSACTIONS ERROR:", walletError);

      return NextResponse.json(
        {
          success: false,
          error: "Wallet transactions load করা যায়নি।",
        },
        { status: 500 },
      );
    }

    // =====================================================
    // FORMAT ORDER TRANSACTIONS
    // =====================================================

    const transactions = (orders ?? []).map((order) => ({
      id: order.id,
      type: "order_payment" as const,
      orderId: order.id,
      uid: order.uid,
      playerName: order.player_name,
      productName: order.product_name,
      packageName: order.package_name,
      amount: Number(order.amount || 0),
      paymentMethod: order.payment_method,
      transactionId: order.transaction_id,
      status: order.status,
      createdAt: order.created_at,
    }));

    // =====================================================
    // FORMAT WALLET TRANSACTIONS
    // =====================================================

    const walletTransactions = (walletRows ?? []).map((transaction) => ({
      id: transaction.id,

      type: "wallet_transaction" as const,

      transactionType: transaction.type || "wallet_transaction",

      direction: transaction.direction || "debit",

      amount: Number(transaction.amount || 0),

      balanceAfter: Number(transaction.balance_after || 0),

      referenceId: transaction.reference_id || null,

      description: transaction.description || null,

      createdAt: transaction.created_at,
    }));

    // =====================================================
    // SUMMARY
    // =====================================================

    const completedSpend = transactions
      .filter((item) => item.status === "completed")
      .reduce((sum, item) => sum + item.amount, 0);

    const openClaims = transactions
      .filter((item) =>
        ["pending", "approved", "processing"].includes(item.status),
      )
      .reduce((sum, item) => sum + item.amount, 0);

    // =====================================================
    // RESPONSE
    // =====================================================

    return NextResponse.json({
      success: true,

      summary: {
        totalTransactions: transactions.length,

        completedSpend,

        openClaims,

        walletTransactions: walletTransactions.length,
      },

      transactions,

      walletTransactions,
    });
  } catch (error) {
    console.error("TRANSACTIONS API ERROR:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Server error.",
      },
      { status: 500 },
    );
  }
}
