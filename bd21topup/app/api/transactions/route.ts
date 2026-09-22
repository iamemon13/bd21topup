import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadUserSupportCases } from "@/lib/support-cases";

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
          error: "Order transactions load করা যায়নি।",
        },
        { status: 500 },
      );
    }

    // =====================================================
    // WALLET TRANSACTIONS (Approved / Deductions)
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
          error: "Wallet transactions load করা যায়নি।",
        },
        { status: 500 },
      );
    }

    // =====================================================
    // ADD MONEY REQUESTS (Pending / Rejected)
    // =====================================================

    const { data: addMoneyRows, error: addMoneyError } = await supabaseAdmin
      .from("add_money_requests")
      .select(
        `
          id,
          amount,
          payment_method,
          transaction_id,
          status,
          created_at
        `,
      )
      .eq("user_id", user.id)
      .in("status", ["pending", "rejected"])
      .order("created_at", {
        ascending: false,
      });

    if (addMoneyError) {
      console.error("ADD MONEY REQUESTS ERROR:", addMoneyError);
      return NextResponse.json(
        {
          success: false,
          error: "Add money requests load করা যায়নি।",
        },
        { status: 500 },
      );
    }

    // =====================================================
    // WITHDRAWAL REQUESTS (All Statuses: Pending, Approved, etc.)
    // =====================================================

    const { data: withdrawalRows, error: withdrawalError } = await supabaseAdmin
      .from("withdrawals")
      .select(
        `
          id,
          amount,
          method,
          account_number,
          status,
          balance_after, 
          created_at
        `, // এখানে balance_after মিসিং ছিল, অ্যাড করা হয়েছে
      )
      .eq("user_id", user.id)
      .order("created_at", {
        ascending: false,
      });

    if (withdrawalError) {
      console.error("WITHDRAWALS ERROR:", withdrawalError);
      return NextResponse.json(
        {
          success: false,
          error: "Withdrawal requests load করা যায়নি।",
        },
        { status: 500 },
      );
    }

    // =====================================================
    // FORMAT ORDER TRANSACTIONS
    // =====================================================

    const cases = await loadUserSupportCases(user.id);
    const transactions = (orders ?? []).map((order) => ({
      support: cases.byOperation.get(`ORD:${order.id}`) ?? null,
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

    const formattedWalletTransactions = (walletRows ?? [])
      .filter((transaction) => transaction.type !== "Withdrawal") // ডাবল এন্ট্রি রিমুভ করার জন্য ফিল্টার করা হলো
      .map((transaction) => ({
        id: transaction.id,
        type: "wallet_transaction" as const,
        transactionType: transaction.type || "wallet_transaction",
        direction: transaction.direction || "debit",
        amount: Number(transaction.amount || 0),
        balanceAfter: Number(transaction.balance_after || 0),
        referenceId: transaction.reference_id || null,
        description: transaction.description || null,
        createdAt: transaction.created_at,
        status: "completed",
      }));

    // =====================================================
    // FORMAT PENDING/REJECTED ADD MONEY
    // =====================================================

    const formattedAddMoneyRequests = (addMoneyRows ?? []).map((req) => ({
      support: cases.byOperation.get(`ADD:${req.id}`) ?? null,
      id: req.id,
      type: "wallet_transaction" as const,
      transactionType: `add_money_${req.status}`,
      direction: "credit",
      amount: Number(req.amount || 0),
      balanceAfter: 0,
      referenceId: req.transaction_id || null,
      description: `Add money via ${req.payment_method}`,
      createdAt: req.created_at,
      status: req.status,
    }));

    // =====================================================
    // FORMAT WITHDRAWAL REQUESTS
    // =====================================================

    const formattedWithdrawals = (withdrawalRows ?? []).map((w) => ({
      support: cases.byOperation.get(`WDR:${w.id}`) ?? null,
      id: w.id,
      type: "wallet_transaction" as const,
      transactionType: "withdrawal",
      direction: "debit",
      amount: Number(w.amount || 0),
      balanceAfter: Number(w.balance_after || 0), // এখানে 0 হার্ডকোড করা ছিল, ডাটাবেজ থেকে ডাটা আনা হয়েছে
      referenceId: w.account_number || null,
      description: `Withdraw via ${w.method} (${w.account_number})`,
      createdAt: w.created_at,
      status: w.status.toLowerCase(),
    }));

    // সমস্ত ওয়ালেট ট্রানজেকশন একসাথে করে তারিখ অনুযায়ী সাজানো
    const walletTransactions = [
      ...formattedWalletTransactions,
      ...formattedAddMoneyRequests,
      ...formattedWithdrawals,
    ].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

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
      supportCasesAvailable: cases.available,
    }, { headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });
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
