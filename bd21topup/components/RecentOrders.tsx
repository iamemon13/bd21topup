"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Order = {
  id: string;
  player_name?: string;
  playerName?: string;
  package_name?: string;
  packageName?: string;
  amount: number;
  status: string;
  created_at: string;
};

// সময় বের করার ফাংশন (যেমন: 2 minutes ago)
function timeAgo(dateString: string) {
  const now = new Date();
  const past = new Date(dateString);
  const diffInMinutes = Math.floor((now.getTime() - past.getTime()) / 60000);

  if (diffInMinutes < 1) return "Just now";
  if (diffInMinutes < 60) return `${diffInMinutes} mins ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours} hrs ago`;
  return `${Math.floor(diffInHours / 24)} days ago`;
}

export default function RecentOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ডেটাবেস ফাঁকা থাকলে আপনার আগের ডামি ডেটাগুলো দেখাবে
  const dummyOrders: Order[] = [
    { id: "1", playerName: "Rahim", packageName: "25 Diamond", amount: 22, status: "completed", created_at: new Date(Date.now() - 60000).toISOString() },
    { id: "2", playerName: "Karim", packageName: "115 Diamond", amount: 79, status: "completed", created_at: new Date(Date.now() - 120000).toISOString() },
    { id: "3", playerName: "Saddam", packageName: "1x Weekly", amount: 158, status: "completed", created_at: new Date(Date.now() - 240000).toISOString() },
    { id: "4", playerName: "Jabir", packageName: "240 Diamond", amount: 158, status: "completed", created_at: new Date(Date.now() - 300000).toISOString() },
    { id: "5", playerName: "Ariful", packageName: "Level Up Pass", amount: 75, status: "completed", created_at: new Date(Date.now() - 420000).toISOString() },
  ];

  const fetchOrders = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("id, player_name, playerName, package_name, packageName, amount, status, created_at")
        .order("created_at", { ascending: false })
        .limit(8);

      if (data && data.length > 0) {
        setOrders(data);
      } else {
        setOrders(dummyOrders);
      }
    } catch (error) {
      console.error("Fetch orders error:", error);
      setOrders(dummyOrders);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOrders();

    // Supabase রিয়েল-টাইম সাবস্ক্রিপশন
    const channel = supabase
      .channel("public:orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        fetchOrders();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const getStatusUI = (status: string) => {
    if (status === "approved" || status === "completed" || status === "success") {
      return (
        <span className="inline-flex rounded-full bg-green-400/10 px-3 py-1 text-xs font-bold text-green-400">
          ✓ Done
        </span>
      );
    }
    if (status === "pending") {
      return (
        <span className="inline-flex rounded-full bg-amber-400/10 px-3 py-1 text-xs font-bold text-amber-400">
          ⏳ Pending
        </span>
      );
    }
    return (
      <span className="inline-flex rounded-full bg-red-400/10 px-3 py-1 text-xs font-bold text-red-400">
        ✕ Cancelled
      </span>
    );
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#0b2545] shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-400/10 text-xl text-cyan-400">
            🛍️
          </div>
          <div>
            <h2 className="text-xl font-black">Recent Orders</h2>
            <div className="mt-1 flex items-center gap-2 text-xs text-green-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-green-400"></span>
              <span>Live</span>
              <span>〰〰</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-slate-400 sm:block">
            {refreshing ? "Updating..." : "Real-time"}
          </span>
          <button
            type="button"
            onClick={fetchOrders}
            className={`flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-lg text-slate-300 transition hover:border-cyan-400 hover:text-cyan-400 ${
              refreshing ? "animate-spin text-cyan-400 border-cyan-400" : ""
            }`}
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Order List */}
      <div className="flex flex-col">
        {loading ? (
          <div className="animate-pulse p-8 text-center text-sm font-semibold text-slate-400">
            Loading live orders...
          </div>
        ) : (
          orders.map((order, index) => {
            const name = order.player_name || order.playerName || "Unknown";
            const pkg = order.package_name || order.packageName || "Package";
            const initial = name.charAt(0).toUpperCase();

            return (
              <div
                key={`${order.id}-${index}`}
                className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-white/5 px-5 py-3 last:border-0 sm:grid-cols-[1fr_170px_90px]"
              >
                {/* Customer */}
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-400 font-bold text-[#06172e]">
                    {initial}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">{name}</div>
                    <div className="truncate text-xs text-slate-400">
                      {pkg} - ৳{order.amount}
                    </div>
                  </div>
                </div>
                {/* Time */}
                <div className="hidden sm:block">
                  <span className="inline-flex rounded-full border border-cyan-400/20 px-3 py-1 text-xs text-slate-300">
                    ◷ {timeAgo(order.created_at)}
                  </span>
                </div>
                {/* Status */}
                <div className="text-right">
                  {getStatusUI(order.status)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
