import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadUserSupportCases } from "@/lib/support-cases";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

type Cursor = { createdAt: string; id: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parsePagination(request: Request):
  | { pageSize: number; cursor: Cursor | null }
  | { error: string } {
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit");
  const pageSize = rawLimit === null ? DEFAULT_PAGE_SIZE : Number(rawLimit);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    return { error: `limit must be an integer between 1 and ${MAX_PAGE_SIZE}.` };
  }

  const rawCursor = params.get("cursor");
  if (!rawCursor) return { pageSize, cursor: null };

  try {
    const decoded = JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8"));
    if (
      typeof decoded?.createdAt !== "string" ||
      !Number.isFinite(new Date(decoded.createdAt).getTime()) ||
      typeof decoded?.id !== "string" ||
      !UUID.test(decoded.id)
    ) {
      return { error: "Invalid cursor." };
    }
    return { pageSize, cursor: { createdAt: decoded.createdAt, id: decoded.id } };
  } catch {
    return { error: "Invalid cursor." };
  }
}

function encodeCursor(row: { createdAt: string; id: string }) {
  return Buffer.from(JSON.stringify({ createdAt: row.createdAt, id: row.id })).toString("base64url");
}

function applyCursor<T extends { or: (filter: string) => T }>(query: T, cursor: Cursor | null) {
  return cursor
    ? query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
    : query;
}

export async function GET(request: Request) {
  try {
    const pagination = parsePagination(request);
    if ("error" in pagination) {
      return NextResponse.json({ success: false, error: pagination.error }, { status: 400 });
    }
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

    const { data: orders, error: ordersError } = await applyCursor(supabaseAdmin
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
      })
      .order("id", { ascending: false })
      .limit(pagination.pageSize + 1), pagination.cursor);

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

    const { data: walletRows, error: walletError } = await applyCursor(supabaseAdmin
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
      })
      .order("id", { ascending: false })
      .limit(pagination.pageSize + 1), pagination.cursor);

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

    const { data: addMoneyRows, error: addMoneyError } = await applyCursor(supabaseAdmin
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
      })
      .order("id", { ascending: false })
      .limit(pagination.pageSize + 1), pagination.cursor);

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

    const { data: withdrawalRows, error: withdrawalError } = await applyCursor(supabaseAdmin
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
      })
      .order("id", { ascending: false })
      .limit(pagination.pageSize + 1), pagination.cursor);

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
      .filter((transaction) => transaction.type?.toLowerCase() !== "withdrawal") // ডাবল এন্ট্রি রিমুভ করার জন্য ফিল্টার করা হলো
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

    const candidateRows = [...transactions, ...walletTransactions]
      .sort((a, b) => {
        const createdAt = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        return createdAt || b.id.localeCompare(a.id);
      });
    const pageRows = candidateRows.slice(0, pagination.pageSize);
    const pagedTransactions = pageRows.filter((row) => row.type === "order_payment");
    const pagedWalletTransactions = pageRows.filter((row) => row.type === "wallet_transaction");
    const nextCursor = candidateRows.length > pagination.pageSize
      ? encodeCursor(pageRows[pageRows.length - 1])
      : null;

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
      totalTransactions: pagedTransactions.length,
        completedSpend,
        openClaims,
      walletTransactions: pagedWalletTransactions.length,
      },
      transactions: pagedTransactions,
      walletTransactions: pagedWalletTransactions,
      page: { limit: pagination.pageSize, nextCursor, hasMore: nextCursor !== null },
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
