"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type TransactionStatus =
  | "pending"
  | "approved"
  | "processing"
  | "completed"
  | "rejected"
  | "cancelled";

type OrderTransaction = {
  id: string;
  type: "order_payment";
  orderId: string;
  uid: string;
  playerName: string;
  productName: string;
  packageName: string;
  amount: number;
  paymentMethod: string;
  transactionId: string;
  status: TransactionStatus;
  createdAt: string;
};

type WalletTransaction = {
  id: string;
  type: "wallet_transaction";
  transactionType: string;
  direction: "credit" | "debit" | string;
  amount: number;
  balanceAfter: number;
  referenceId: string | null;
  description: string | null;
  createdAt: string;
};

type TransactionsResponse = {
  success: boolean;

  summary: {
    totalTransactions: number;
    completedSpend: number;
    openClaims: number;
    walletTransactions: number;
  };

  transactions: OrderTransaction[];

  walletTransactions: WalletTransaction[];
};

const orderFilters = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "processing", label: "Processing" },
  { id: "completed", label: "Completed" },
  { id: "rejected", label: "Rejected" },
  { id: "cancelled", label: "Cancelled" },
] as const;

type MainTab = "orders" | "wallet";

function statusStyle(status: TransactionStatus) {
  switch (status) {
    case "completed":
      return "border-green-400/25 bg-green-400/10 text-green-300";

    case "processing":
      return "border-blue-400/25 bg-blue-400/10 text-blue-300";

    case "approved":
      return "border-cyan-400/25 bg-cyan-400/10 text-cyan-300";

    case "rejected":
      return "border-red-400/25 bg-red-400/10 text-red-300";

    case "cancelled":
      return "border-red-500/30 bg-red-500/10 text-red-400";

    default:
      return "border-amber-400/25 bg-amber-400/10 text-amber-300";
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-BD", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dhaka",
  }).format(new Date(value));
}

function money(value: number) {
  return `৳${Number(value || 0).toLocaleString("en-BD")}`;
}

export default function TransactionsPage() {
  const router = useRouter();

  const [data, setData] = useState<TransactionsResponse | null>(null);

  const [activeTab, setActiveTab] = useState<MainTab>("orders");

  const [activeFilter, setActiveFilter] =
    useState<(typeof orderFilters)[number]["id"]>("all");

  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(true);

  const [message, setMessage] = useState("Loading transactions...");

  useEffect(() => {
    async function loadTransactions() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          const next = "/transactions";

          window.localStorage.setItem("bd21_auth_next", next);

          router.replace(`/login?next=${encodeURIComponent(next)}`);

          return;
        }

        const response = await fetch("/api/transactions", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },

          cache: "no-store",
        });

        const result = await response.json();

        if (response.status === 401) {
          await supabase.auth.signOut();

          router.replace("/login?next=%2Ftransactions");

          return;
        }

        if (!response.ok) {
          setMessage(result.error || "Transactions load করা যায়নি।");

          return;
        }

        setData(result);

        setMessage("");
      } catch (error) {
        console.error("TRANSACTIONS PAGE ERROR:", error);

        setMessage("Server-এর সাথে connection করা যায়নি।");
      } finally {
        setLoading(false);
      }
    }

    loadTransactions();
  }, [router]);

  const transactions = data?.transactions ?? [];

  const walletTransactions = data?.walletTransactions ?? [];

  // =====================================================
  // ORDER SEARCH + FILTER
  // =====================================================

  const filteredTransactions = useMemo(() => {
    const searchText = search.trim().toLowerCase();

    return transactions.filter((transaction) => {
      const matchesStatus =
        activeFilter === "all" || transaction.status === activeFilter;

      if (!matchesStatus) {
        return false;
      }

      if (!searchText) {
        return true;
      }

      const searchableText = [
        transaction.id,
        transaction.orderId,
        transaction.uid,
        transaction.playerName,
        transaction.productName,
        transaction.packageName,
        transaction.paymentMethod,
        transaction.transactionId,
        transaction.status,
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(searchText);
    });
  }, [transactions, activeFilter, search]);

  // =====================================================
  // WALLET SEARCH
  // =====================================================

  const filteredWalletTransactions = useMemo(() => {
    const searchText = search.trim().toLowerCase();

    if (!searchText) {
      return walletTransactions;
    }

    return walletTransactions.filter((transaction) => {
      const searchableText = [
        transaction.id,
        transaction.transactionType,
        transaction.direction,
        transaction.amount,
        transaction.balanceAfter,
        transaction.referenceId || "",
        transaction.description || "",
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(searchText);
    });
  }, [walletTransactions, search]);

  // =====================================================
  // STATUS COUNTS
  // =====================================================

  const statusCounts = useMemo(() => {
    return transactions.reduce<Record<string, number>>(
      (counts, transaction) => {
        counts[transaction.status] = (counts[transaction.status] || 0) + 1;

        return counts;
      },
      {},
    );
  }, [transactions]);

  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-[#07182f] text-white">
      {/* =====================================================
          HEADER
      ===================================================== */}

      <header className="border-b border-cyan-400/15 bg-[#081c36]">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-5">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <Image
              src="/logo/bd21-logo.png"
              alt="BD21 Top Up"
              width={52}
              height={52}
              className="h-11 w-11 shrink-0 rounded-xl object-cover"
            />

            <div className="min-w-0">
              <div className="text-lg font-black">
                BD
                <span className="text-cyan-400">21</span>
              </div>

              <div className="text-[8px] tracking-[3px] text-slate-400">
                TOP UP
              </div>
            </div>
          </Link>

          <Link
            href="/account"
            className="
              shrink-0
              rounded-xl
              border
              border-cyan-400/20
              px-3
              py-2
              text-xs
              font-bold
              text-slate-200
              transition
              hover:border-cyan-400
              sm:px-4
              sm:text-sm
            "
          >
            ← My Account
          </Link>
        </div>
      </header>

      {/* =====================================================
          MAIN
      ===================================================== */}

      <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-5">
        <div className="mb-6">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">
            Account
          </p>

          <h1 className="mt-1 text-3xl font-black">Transactions</h1>

          <p className="mt-2 text-sm leading-6 text-slate-400">
            আপনার order payment এবং wallet transaction history এখানে দেখুন।
          </p>
        </div>

        {/* =====================================================
            SUMMARY
        ===================================================== */}

        {!loading && data && (
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-cyan-400/15 bg-[#0b2545] p-4">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                Order Transactions
              </div>

              <div className="mt-2 text-2xl font-black text-cyan-400">
                {data.summary.totalTransactions}
              </div>
            </div>

            <div className="rounded-2xl border border-green-400/15 bg-[#0b2545] p-4">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                Completed Spend
              </div>

              <div className="mt-2 text-2xl font-black text-green-300">
                {money(data.summary.completedSpend)}
              </div>
            </div>

            <div className="rounded-2xl border border-amber-400/15 bg-[#0b2545] p-4">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                Wallet Transactions
              </div>

              <div className="mt-2 text-2xl font-black text-amber-300">
                {data.summary.walletTransactions}
              </div>
            </div>
          </div>
        )}

        {/* =====================================================
            MAIN TABS
        ===================================================== */}

        <div className="mb-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab("orders");
              setActiveFilter("all");
              setSearch("");
            }}
            className={`
              rounded-xl
              border
              px-4
              py-3
              text-sm
              font-black
              transition

              ${
                activeTab === "orders"
                  ? "border-cyan-400 bg-cyan-400 text-[#06172e]"
                  : "border-white/10 bg-[#0b2545] text-slate-300"
              }
            `}
          >
            Order Payments
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("wallet");
              setSearch("");
            }}
            className={`
              rounded-xl
              border
              px-4
              py-3
              text-sm
              font-black
              transition

              ${
                activeTab === "wallet"
                  ? "border-cyan-400 bg-cyan-400 text-[#06172e]"
                  : "border-white/10 bg-[#0b2545] text-slate-300"
              }
            `}
          >
            Wallet History
          </button>
        </div>

        {/* =====================================================
            SEARCH
        ===================================================== */}

        {!loading && !message && (
          <div className="relative mb-5">
            <span
              className="
                pointer-events-none
                absolute
                left-3
                top-1/2
                -translate-y-1/2
                text-sm
                text-slate-500
              "
            >
              🔍
            </span>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                activeTab === "orders"
                  ? "Search UID, player, package, transaction ID..."
                  : "Search description, type, reference ID..."
              }
              className="
                h-11
                w-full
                rounded-xl
                border
                border-cyan-400/20
                bg-[#0b2545]
                pl-10
                pr-10
                text-sm
                text-white
                outline-none
                placeholder:text-slate-600
                focus:border-cyan-400/50
              "
            />

            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="
                  absolute
                  right-3
                  top-1/2
                  -translate-y-1/2
                  text-sm
                  text-slate-400
                  hover:text-white
                "
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* =====================================================
            SEARCH RESULT COUNT
        ===================================================== */}

        {!loading && !message && (
          <p className="mb-4 text-[10px] text-slate-500">
            {activeTab === "orders"
              ? `Showing ${filteredTransactions.length} of ${transactions.length} order transactions`
              : `Showing ${filteredWalletTransactions.length} of ${walletTransactions.length} wallet transactions`}
          </p>
        )}

        {/* =====================================================
            LOADING / ERROR
        ===================================================== */}

        {loading ? (
          <div className="rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-6 text-sm text-slate-300">
            Loading transactions...
          </div>
        ) : message ? (
          <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-6 text-sm font-semibold text-red-300">
            {message}
          </div>
        ) : activeTab === "orders" ? (
          <>
            {/* =================================================
                ORDER FILTERS
            ================================================= */}

            <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {orderFilters.map((filter) => {
                const selected = activeFilter === filter.id;

                const count =
                  filter.id === "all"
                    ? transactions.length
                    : statusCounts[filter.id] || 0;

                return (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => setActiveFilter(filter.id)}
                    className={`
                        min-w-0
                        rounded-xl
                        border
                        px-3
                        py-2
                        text-xs
                        font-black
                        transition

                        ${
                          selected
                            ? "border-cyan-400 bg-cyan-400 text-[#06172e]"
                            : "border-white/10 bg-[#0b2545] text-slate-300 hover:border-cyan-400/50"
                        }
                      `}
                  >
                    {filter.label} ({count})
                  </button>
                );
              })}
            </div>

            {/* =================================================
                NO ORDER
            ================================================= */}

            {filteredTransactions.length === 0 ? (
              <div className="rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-8 text-center">
                <div className="text-4xl">🔍</div>

                <h2 className="mt-3 text-lg font-black">
                  No transactions found
                </h2>

                <p className="mt-2 text-sm text-slate-400">
                  Search বা filter পরিবর্তন করে আবার চেষ্টা করুন।
                </p>

                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setActiveFilter("all");
                  }}
                  className="
                    mt-4
                    rounded-lg
                    bg-cyan-400
                    px-4
                    py-2
                    text-xs
                    font-black
                    text-black
                  "
                >
                  Clear Search
                </button>
              </div>
            ) : (
              <div className="w-full min-w-0 space-y-4">
                {filteredTransactions.map((transaction) => (
                  <article
                    key={transaction.id}
                    className="
                        w-full
                        min-w-0
                        overflow-hidden
                        rounded-2xl
                        border
                        border-cyan-400/15
                        bg-[#0b2545]
                      "
                  >
                    {/* Order Header */}

                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
                      <div className="min-w-0">
                        <div className="text-[10px] font-black uppercase tracking-wider text-cyan-300">
                          Order Payment
                        </div>

                        <div className="mt-1 text-xs text-slate-500">
                          {formatDate(transaction.createdAt)}
                        </div>
                      </div>

                      <span
                        className={`
                            rounded-full
                            border
                            px-3
                            py-1
                            text-[10px]
                            font-black
                            uppercase
                            tracking-wider
                            ${statusStyle(transaction.status)}
                          `}
                      >
                        {transaction.status}
                      </span>
                    </div>

                    {/* Order Information */}

                    <div className="grid gap-3 p-5 sm:grid-cols-2">
                      <div className="min-w-0 rounded-xl bg-[#07182f] p-4">
                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                          Transaction ID
                        </div>

                        <div className="mt-1 break-all text-sm font-bold text-white">
                          {transaction.transactionId}
                        </div>

                        <div className="mt-2 text-xs capitalize text-slate-400">
                          {transaction.paymentMethod}
                        </div>
                      </div>

                      <div className="min-w-0 rounded-xl bg-[#07182f] p-4">
                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                          Package
                        </div>

                        <div className="mt-1 text-sm font-bold text-white">
                          {transaction.packageName}
                        </div>

                        <div className="mt-2 break-words text-xs text-slate-400">
                          {transaction.playerName}
                          {" · "}
                          {transaction.uid}
                        </div>
                      </div>
                    </div>

                    {/* Cancellation */}

                    {transaction.status === "cancelled" && (
                      <div className="mx-5 mb-4 rounded-xl border border-red-400/25 bg-red-500/10 p-4">
                        <div className="text-[10px] font-black uppercase tracking-wider text-red-300">
                          ❌ Cancellation Notice
                        </div>

                        <p className="mt-2 text-sm font-bold text-white">
                          Your order was cancelled by the admin.
                        </p>

                        <p className="mt-1 text-xs text-red-200/80">
                          Please check My Orders for the cancellation reason.
                        </p>
                      </div>
                    )}

                    {/* Bottom */}

                    <div className="flex items-end justify-between gap-4 border-t border-white/10 px-5 py-4">
                      <div className="min-w-0">
                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                          Order ID
                        </div>

                        <div className="mt-1 font-mono text-xs text-slate-400">
                          {transaction.orderId.slice(0, 8).toUpperCase()}
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                          Amount
                        </div>

                        <div className="mt-1 text-xl font-black text-cyan-400">
                          {money(transaction.amount)}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        ) : (
          /* ===================================================
             WALLET HISTORY
          =================================================== */

          <>
            {filteredWalletTransactions.length === 0 ? (
              <div className="rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-8 text-center">
                <div className="text-4xl">🔍</div>

                <h2 className="mt-3 text-lg font-black">
                  No wallet transactions found
                </h2>

                <p className="mt-2 text-sm text-slate-400">
                  Search পরিবর্তন করে আবার চেষ্টা করুন।
                </p>

                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="
                    mt-4
                    rounded-lg
                    bg-cyan-400
                    px-4
                    py-2
                    text-xs
                    font-black
                    text-black
                  "
                >
                  Clear Search
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredWalletTransactions.map((transaction) => {
                  const isCredit = transaction.direction === "credit";

                  return (
                    <article
                      key={transaction.id}
                      className="
                          overflow-hidden
                          rounded-2xl
                          border
                          border-cyan-400/15
                          bg-[#0b2545]
                        "
                    >
                      {/* Wallet Header */}

                      <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
                        <div className="min-w-0">
                          <div className="text-[10px] font-black uppercase tracking-wider text-cyan-300">
                            Wallet Transaction
                          </div>

                          <div className="mt-1 text-xs text-slate-500">
                            {formatDate(transaction.createdAt)}
                          </div>
                        </div>

                        <span
                          className={`
                              rounded-full
                              border
                              px-3
                              py-1
                              text-[10px]
                              font-black
                              uppercase
                              ${
                                isCredit
                                  ? "border-green-400/25 bg-green-400/10 text-green-300"
                                  : "border-red-400/25 bg-red-400/10 text-red-300"
                              }
                            `}
                        >
                          {transaction.direction}
                        </span>
                      </div>

                      <div className="space-y-3 p-5">
                        {/* Description */}

                        <div className="rounded-xl bg-[#07182f] p-4">
                          <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                            Description
                          </div>

                          <div className="mt-1 text-sm font-bold text-white">
                            {transaction.description || "Wallet transaction"}
                          </div>
                        </div>

                        {/* Type + Balance */}

                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-xl bg-[#07182f] p-4">
                            <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                              Type
                            </div>

                            <div className="mt-1 break-words text-sm font-bold capitalize text-white">
                              {transaction.transactionType.replace(/_/g, " ")}
                            </div>
                          </div>

                          <div className="rounded-xl bg-[#07182f] p-4">
                            <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                              Balance After
                            </div>

                            <div className="mt-1 text-sm font-black text-cyan-400">
                              {money(transaction.balanceAfter)}
                            </div>
                          </div>
                        </div>

                        {/* Reference */}

                        {transaction.referenceId && (
                          <div className="rounded-xl bg-[#07182f] p-4">
                            <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                              Reference ID
                            </div>

                            <div className="mt-1 break-all font-mono text-xs text-slate-300">
                              {transaction.referenceId}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Amount */}

                      <div className="flex items-center justify-between border-t border-white/10 px-5 py-4">
                        <div className="text-xs font-bold text-slate-400">
                          Transaction Amount
                        </div>

                        <div
                          className={`
                              text-xl
                              font-black
                              ${isCredit ? "text-green-300" : "text-red-300"}
                            `}
                        >
                          {isCredit ? "+" : "-"}
                          {money(transaction.amount)}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
