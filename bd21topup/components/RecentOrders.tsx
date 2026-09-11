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
};

// সময় বের করার ফাংশন
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

  // ডামি ডেটা
  const dummyOrders: Order[] = [
    { id: "1", user_name: "Rahim", packageName: "25 Diamond", amount: 22, status: "completed", created_at: new Date(Date.now() - 60000).toISOString() },
    { id: "2", user_name: "Karim", packageName: "115 Diamond", amount: 79, status: "pending", created_at: new Date(Date.now() - 120000).toISOString() },
    { id: "3", user_name: "Saddam", packageName: "1x Weekly", amount: 158, status: "completed", created_at: new Date(Date.now() - 240000).toISOString() },
  ];

  const fetchOrders = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(8);

      if (error) {
        console.error("Supabase Error:", error.message);
        setOrders(dummyOrders);
        return;
      }

      if (data && data.length > 0) {
        setOrders(data);
      } else {
        setOrders(dummyOrders);
      }
    } catch (error) {
      console.error("Fetch error:", error);
      setOrders(dummyOrders);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOrders();

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

  const getStatusUI = (rawStatus: string) => {
    const s = rawStatus?.toLowerCase() || "";
    
    // কমপ্লিট হলে ডাইরেক্ট '✓ Done' দেখাবে
    if (s === "approved" || s === "completed" || s === "success") {
      return (
        <span className="inline-flex rounded-full bg-green-400/10 px-3 py-1 text-xs font-bold text-green-400">
          ✓ Done
        </span>
      );
    }
    // পেন্ডিং থাকলে '⏳ Pending' দেখাবে
    if (s === "pending") {
      return (
        <span className="inline-flex rounded-full bg-amber-400/10 px-3 py-1 text-xs font-bold text-amber-400">
          ⏳ Pending
        </span>
      );
    }
    // ক্যান্সেল বা অন্য কিছুর জন্য
    return (
      <span className="inline-flex rounded-full bg-red-400/10 px-3 py-1 text-xs font-bold text-red-400">
        ✕ Cancelled
      </span>
    );
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#0b2545] shadow-xl">
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

      <div className="flex flex-col">
        {loading ? (
          <div className="animate-pulse p-8 text-center text-sm font-semibold text-slate-400">
            Loading live orders...
          </div>
        ) : (
          orders.map((order, index) => {
            const name = order.user_name || order.account_name || order.user_email || order.player_name || order.playerName || order.player || "User";
            const pkg = order.package_name || order.packageName || order.package || "Package";
            const price = order.amount || order.price || 0;
            const initial = name.charAt(0).toUpperCase();

            return (
              <div
                key={`${order.id}-${index}`}
                className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-white/5 px-5 py-3 last:border-0 sm:grid-cols-[1fr_170px_90px]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-400 font-bold text-[#06172e]">
                    {initial}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">{name}</div>
                    <div className="truncate text-xs text-slate-400">
                      {pkg} - ৳{price}
                    </div>
                  </div>
                </div>
                <div className="hidden sm:block">
                  <span className="inline-flex rounded-full border border-cyan-400/20 px-3 py-1 text-xs text-slate-300">
                    ◷ {timeAgo(order.created_at)}
                  </span>
                </div>
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
