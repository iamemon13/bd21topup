"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Order = {
  id: string;
  account_name?: string;
  player_name?: string;
  package_name?: string;
  amount: number;
  status: string;
  created_at: string;
  profiles?: {
    avatar_url?: string;
  };
};

function timeAgo(dateString: string) {
  const now = new Date();
  const past = new Date(dateString);
  const diffInMinutes = Math.floor((now.getTime() - past.getTime()) / 60000);

  if (diffInMinutes < 1) return "Just now";
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  return `${Math.floor(diffInHours / 24)}d ago`;
}

export default function RecentOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // API থেকে লেটেস্ট অর্ডার ফেচ করার ফাংশন
  const fetchOrders = async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/recent-orders", { cache: "no-store" });
      const result = await response.json();

      if (result.success && result.orders) {
        setOrders(result.orders);
      }
    } catch (error) {
      console.error("Fetch error:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOrders();

    // রিয়েল-টাইম আপডেটের জন্য Supabase চ্যানেল
    const channel = supabase
      .channel("public:orders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => {
          fetchOrders();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const getStatusUI = (rawStatus: string) => {
    const s = rawStatus?.toLowerCase() || "";

    if (s === "approved" || s === "completed" || s === "success") {
      return (
        <span className="inline-flex items-center rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-bold text-emerald-400 border border-emerald-500/20 whitespace-nowrap">
          ✓ Done
        </span>
      );
    }
    if (s === "pending") {
      return (
        <span className="inline-flex items-center rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] font-bold text-amber-400 border border-amber-500/20 whitespace-nowrap">
          ⏳ Pending
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full bg-rose-400/10 px-2.5 py-1 text-[11px] font-bold text-rose-400 border border-rose-500/20 whitespace-nowrap">
        ✕ Cancelled
      </span>
    );
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#0b2545] shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-400/10 text-lg text-cyan-400">
            🛍️
          </div>
          <div>
            <h2 className="text-base sm:text-xl font-black">Recent Orders</h2>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400"></span>
              <span>Live</span>
              <span>〰〰</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={fetchOrders}
          className={`flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:border-cyan-400 hover:text-cyan-400 ${
            refreshing ? "animate-spin text-cyan-400 border-cyan-400" : ""
          }`}
          title="Refresh"
        >
          ↻
        </button>
      </div>

      {/* Orders List */}
      <div className="flex flex-col divide-y divide-white/5">
        {loading ? (
          <div className="animate-pulse p-8 text-center text-sm font-semibold text-slate-400">
            Loading live orders...
          </div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-sm font-semibold text-slate-400">
            কোনো অর্ডার পাওয়া যায়নি
          </div>
        ) : (
          orders.map((order, index) => {
            const name = order.account_name || order.player_name || "Unknown";
            const pkg = order.package_name || "Diamond";
            const price = order.amount || 0;

            // যদি ডেটাবেজে রিয়েল avatar_url না থাকে, তবে ইউজারের নামের ওপর ভিত্তি করে ডায়নামিক আইকন জেনারেট হবে
            const avatarUrl =
              order.profiles?.avatar_url ||
              `https://ui-avatars.com/api/?name=${encodeURIComponent(
                name,
              )}&background=07182f&color=00ffff&bold=true`;

            return (
              <div
                key={`${order.id}-${index}`}
                className="flex items-center justify-between gap-2 px-3.5 py-3 sm:px-5 sm:py-3.5 hover:bg-white/[0.02] transition"
              >
                {/* Left Side: Avatar & Info */}
                <div className="flex min-w-0 items-center gap-3 flex-1">
                  <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-cyan-400 bg-cyan-400/10 text-sm font-black text-cyan-400 shadow-sm">
                    <img
                      src={avatarUrl}
                      alt={name}
                      className="h-full w-full object-cover"
                    />
                  </div>

                  <div className="flex flex-col min-w-0">
                    <div className="truncate text-xs sm:text-sm font-bold text-white">
                      {name}
                    </div>
                    <div className="truncate text-[11px] sm:text-xs text-slate-400 mt-0.5">
                      {pkg}
                    </div>
                    <div className="text-[10px] sm:text-xs text-cyan-300 font-bold mt-0.5">
                      ৳{price}
                    </div>
                  </div>
                </div>

                {/* Right Side: Time & Status */}
                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                  <span className="inline-flex items-center gap-1 rounded-md bg-white/5 border border-white/10 px-2 py-0.5 text-[10px] sm:text-xs text-slate-300 whitespace-nowrap">
                    🕒 {timeAgo(order.created_at)}
                  </span>
                  <div>{getStatusUI(order.status)}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
