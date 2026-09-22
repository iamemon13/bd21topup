"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import SupportCaseActions from "@/components/SupportCaseActions";
import type { SupportCase } from "@/lib/support";

type OrderStatus = "pending" | "completed" | "cancelled" | "rejected";

type Order = {
  support?: SupportCase | null;
  id: string;
  uid: string;
  player_name: string;
  product_name: string;
  package_name: string;
  amount: number | string;
  payment_method: string;
  receiver_number: string;
  transaction_id: string;
  status: OrderStatus;
  created_at: string;
  admin_note?: string | null;
  cancelled_at?: string | null;
};

// অপ্রয়োজনীয় ফিল্টারগুলো বাদ দেওয়া হয়েছে
const filters = [
  { id: "all", label: "সব" },
  { id: "pending", label: "Pending" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "rejected", label: "Rejected" },
] as const;

function statusStyle(status: string) {
  if (status === "completed" || status === "approved" || status === "success") {
    return "border-green-400/40 bg-green-400/10 text-green-300";
  }
  if (status === "processing") {
    return "border-cyan-400/40 bg-cyan-400/10 text-cyan-300";
  }
  if (status === "cancelled" || status === "rejected") {
    return "border-red-500/50 bg-red-500/10 text-red-400";
  }
  return "border-yellow-400/40 bg-yellow-400/10 text-yellow-300";
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-BD", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dhaka",
  }).format(new Date(date));
}

export default function MyOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [activeFilter, setActiveFilter] =
    useState<(typeof filters)[number]["id"]>("all");
  const [copied, setCopied] = useState("");
  const [search, setSearch] = useState("");

  async function copyText(value: string, id: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(id);
      setTimeout(() => {
        setCopied("");
      }, 1200);
    } catch (error) {
      console.error("COPY ERROR:", error);
      alert("Copy করা যায়নি।");
    }
  }

  useEffect(() => {
    async function loadOrders() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          router.replace("/login?next=%2Forders");
          return;
        }

        const response = await fetch("/api/orders/my", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          cache: "no-store",
        });

        const data = await response.json();

        if (!response.ok) {
          setMessage(data.error || "Order পাওয়া যায়নি");
          return;
        }

        setOrders(data.orders || []);
      } catch (error) {
        console.error(error);
        setMessage("Server error");
      } finally {
        setLoading(false);
      }
    }

    loadOrders();
  }, [router]);

  const filteredOrders = useMemo(() => {
    const searchText = search.trim().toLowerCase();

    return orders.filter((order) => {
      const matchesStatus =
        activeFilter === "all" || order.status === activeFilter;

      if (!matchesStatus) {
        return false;
      }

      if (!searchText) {
        return true;
      }

      const searchableText = [
        order.id,
        order.uid,
        order.player_name,
        order.product_name,
        order.package_name,
        order.payment_method,
        order.receiver_number || "",
        order.transaction_id,
        order.status,
        order.admin_note || "",
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(searchText);
    });
  }, [orders, activeFilter, search]);

  const counts = useMemo(() => {
    return orders.reduce(
      (acc, order) => {
        acc[order.status] = (acc[order.status] || 0) + 1;
        return acc;
      },
      {
        all: orders.length,
      } as Record<string, number>,
    );
  }, [orders]);

  return (
    <main className="min-h-screen w-full min-w-0 overflow-x-hidden bg-[#07182f] text-white">
      <header className="border-b border-cyan-400/20 bg-[#081c36]">
        <div className="flex w-full min-w-0 items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/logo/bd21-logo.png"
              alt="BD21"
              width={42}
              height={42}
              className="rounded-xl"
            />
            <div>
              <h2 className="text-xl font-black">
                BD<span className="text-cyan-400">21</span>
              </h2>
              <p className="text-[8px] tracking-[3px] text-slate-400">TOP UP</p>
            </div>
          </Link>

          <Link
            href="/account"
            className="rounded-xl border border-cyan-400/40 px-3 py-2 text-xs font-bold"
          >
            ← Account
          </Link>
        </div>
      </header>

      <section className="w-full min-w-0 px-4 py-5">
        <h1 className="text-3xl font-black">My Orders</h1>
        <p className="mt-1 text-sm text-slate-400">
          আপনার Top Up order এর অবস্থা এখানে দেখুন।
        </p>

        <div className="relative mt-5">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
            🔍
          </span>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search UID, Player Name, Package, Transaction ID..."
            className="h-11 w-full rounded-xl border border-cyan-400/20 bg-[#0b2545] pl-10 pr-10 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-400/50"
          />

          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>

        {!loading && (
          <p className="mt-2 text-[10px] text-slate-500">
            Showing {filteredOrders.length} of {orders.length} orders
          </p>
        )}

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {filters.map((filter) => {
            const active = activeFilter === filter.id;
            const count =
              filter.id === "all" ? orders.length : counts[filter.id] || 0;

            return (
              <button
                key={filter.id}
                type="button"
                onClick={() => setActiveFilter(filter.id)}
                className={`
                  shrink-0 rounded-xl border px-3 py-2 text-xs font-bold transition
                  ${
                    active
                      ? "border-cyan-400 bg-cyan-400 text-black"
                      : "border-white/10 bg-[#0b2545] text-white hover:border-cyan-400/30"
                  }
                `}
              >
                {filter.label} ({count})
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="mt-5 rounded-xl bg-[#0b2545] p-5 text-center">
            Loading...
          </div>
        ) : message ? (
          <div className="mt-5 rounded-xl bg-red-500/10 p-5 text-center text-red-300">
            {message}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="mt-5 rounded-xl border border-white/10 bg-[#0b2545] p-8 text-center">
            {search ? (
              <>
                <div className="text-3xl">🔍</div>
                <p className="mt-3 text-sm font-bold text-slate-300">
                  কোনো matching order পাওয়া যায়নি।
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  অন্য search term দিয়ে চেষ্টা করুন।
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setActiveFilter("all");
                  }}
                  className="mt-4 rounded-lg bg-cyan-400 px-4 py-2 text-xs font-black text-black"
                >
                  Clear Search
                </button>
              </>
            ) : (
              <p className="text-sm text-slate-400">
                এই filter-এর কোনো order নেই।
              </p>
            )}
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {filteredOrders.map((order) => (
              <div
                key={order.id}
                className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#0b2545]"
              >
                <div className="flex min-w-0 flex-col gap-3 border-b border-white/10 p-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-slate-500">
                      {formatDate(order.created_at)}
                    </p>
                    <div className="mt-1 flex min-w-0 items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-[10px] text-slate-500">
                        Order ID: {order.id}
                      </p>
                      <button
                        type="button"
                        onClick={() => copyText(order.id, `order-${order.id}`)}
                        className="shrink-0 rounded-md bg-cyan-400/20 px-2 py-1 text-[9px] font-bold text-cyan-300"
                      >
                        {copied === `order-${order.id}` ? "✓" : "Copy"}
                      </button>
                    </div>
                    <h2 className="mt-1 break-words text-lg font-black">
                      {order.package_name}
                    </h2>
                  </div>

                  <div className="flex w-full shrink-0 justify-start sm:w-auto sm:justify-end">
                    <span
                      className={`inline-flex max-w-full items-center justify-center rounded-full border px-3 py-1 text-[10px] font-black uppercase whitespace-nowrap ${statusStyle(
                        order.status,
                      )}`}
                    >
                      {order.status}
                    </span>
                  </div>
                </div>

                <div className="space-y-3 p-3">
                  <div className="rounded-xl bg-[#07182f] p-3">
                    <p className="text-[10px] font-bold text-slate-500">
                      PLAYER
                    </p>
                    <p className="mt-1 text-sm font-bold">
                      {order.player_name}
                    </p>
                    <div className="mt-3 flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-slate-500">UID</p>
                        <p className="text-xs">{order.uid}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyText(order.uid, `uid-${order.id}`)}
                        className="rounded-md bg-cyan-400/20 px-2 py-1 text-[10px] font-bold text-cyan-300"
                      >
                        {copied === `uid-${order.id}` ? "✓" : "Copy"}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl bg-[#07182f] p-3">
                    <p className="text-[10px] font-bold text-slate-500">
                      PAYMENT
                    </p>
                    <p className="mt-1 text-sm font-bold capitalize">
                      {order.payment_method}
                    </p>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <div className="overflow-hidden">
                        <p className="text-[10px] text-slate-500">
                          Transaction ID
                        </p>
                        <p className="max-w-[190px] truncate text-xs">
                          {order.transaction_id}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          copyText(order.transaction_id, `trx-${order.id}`)
                        }
                        className="rounded-md bg-cyan-400/20 px-2 py-1 text-[10px] font-bold text-cyan-300"
                      >
                        {copied === `trx-${order.id}` ? "✓" : "Copy"}
                      </button>
                    </div>
                  </div>

                  <SupportCaseActions support={order.support} />
                  {order.status === "cancelled" && order.admin_note && !order.support && (
                    <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base">❌</span>
                        <p className="text-[10px] font-black uppercase tracking-wide text-red-300">
                          Cancellation Reason
                        </p>
                      </div>
                      <p className="mt-2 text-sm font-bold leading-5 text-white">
                        {order.admin_note}
                      </p>
                      {order.cancelled_at && (
                        <p className="mt-2 text-[10px] text-red-300/70">
                          Cancelled: {formatDate(order.cancelled_at)}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-white/10 px-3 py-2">
                  <p className="text-xs font-bold text-slate-400">Amount</p>
                  <p className="text-xl font-black text-cyan-400">
                    ৳{Number(order.amount).toLocaleString("en-BD")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
