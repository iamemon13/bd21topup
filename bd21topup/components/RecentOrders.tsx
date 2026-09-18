"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Order = {
  id: string;
  player_name?: string;
  playerName?: string;
  player?: string;
  user_name?: string;
  account_name?: string;
  user_email?: string;
  package_name?: string;
  packageName?: string;
  package?: string;
  amount: number;
  price?: number;
  status: string;
  created_at: string;
  avatar_url?: string;
  avatarUrl?: string;
  user_avatar?: string;
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

  // API থেকে ডাটা ফেচ করার ফাংশন
  const fetchOrders = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/recent-orders");
      const json = await res.json();
      
      if (json.success && json.orders) {
        setOrders(json.orders);
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

    // রিয়েলটাইম আপডেটের জন্য Supabase সাবস্ক্রিপশন
    const channel = supabase
      .channel("public:orders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => {
          fetchOrders();
        }
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
        ) : (
          orders.map((order, index) => {
            // account_name কে সবচেয়ে বেশি প্রায়োরিটি দেওয়া হয়েছে
            const name =
              order.account_name ||
              order.user_name ||
              order.player_name ||
              order.playerName ||
              order.player ||
              "Unknown";

            const pkg =
              order.package_name ||
              order.packageName ||
              order.package ||
              "Diamond";

            const price = order.amount || order.price || 0;
            const avatar = order.avatar_url || order.avatarUrl || order.user_avatar;
            const initial = name.charAt(0).toUpperCase();

            return (
              <div
                key={`${order.id}-${index}`}
                className="flex items-center justify-between gap-2 px-3.5 py-3 sm:px-5 sm:py-3.5 hover:bg-white/[0.02] transition"
              >
                {/* Left Side: Real-time Account Profile Avatar & Info */}
                <div className="flex min-w-0 items-center gap-3 flex-1">
                  <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-cyan-400 bg-cyan-400/10 text-sm font-black text-cyan-400 shadow-sm">
                    {avatar ? (
                      <img
                        src={avatar}
                        alt={name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span>{initial}</span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="truncate text-xs sm:text-sm font-bold text-white">
                      {name}
                    </div>
                    <div className="truncate text-[11px] sm:text-xs text-slate-400">
                      {pkg} • <span className="text-cyan-300 font-semibold">৳{price}</span>
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
