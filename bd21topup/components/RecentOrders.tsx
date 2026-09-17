"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
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
  product_image?: string;
  image?: string;
};

// সময় বের করার ফাংশন
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

  const dummyOrders: Order[] = [
    {
      id: "1",
      user_name: "Emon0313",
      packageName: "25 Diamond",
      amount: 22,
      status: "completed",
      created_at: new Date(Date.now() - 120000).toISOString(),
    },
    {
      id: "2",
      user_name: "Rahim",
      packageName: "50 Diamond",
      amount: 36,
      status: "completed",
      created_at: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      id: "3",
      user_name: "Karim",
      packageName: "Weekly Pass",
      amount: 190,
      status: "cancelled",
      created_at: new Date(Date.now() - 86400000).toISOString(),
    },
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
        <span className="inline-flex items-center rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] sm:text-xs font-bold text-emerald-400 border border-emerald-500/20 whitespace-nowrap">
          ✓ Done
        </span>
      );
    }
    if (s === "pending") {
      return (
        <span className="inline-flex items-center rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] sm:text-xs font-bold text-amber-400 border border-amber-500/20 whitespace-nowrap">
          ⏳ Pending
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full bg-rose-400/10 px-2.5 py-1 text-[11px] sm:text-xs font-bold text-rose-400 border border-rose-500/20 whitespace-nowrap">
        ✕ Cancelled
      </span>
    );
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#0b2545] shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-xl bg-cyan-400/10 text-lg sm:text-xl text-cyan-400">
            🛍️
          </div>
          <div>
            <h2 className="text-base sm:text-xl font-black">Recent Orders</h2>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] sm:text-xs text-emerald-400 font-medium">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400"></span>
              <span>Live</span>
              <span>〰〰</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden text-xs text-slate-400 sm:block">
            {refreshing ? "Updating..." : "Real-time"}
          </span>
          <button
            type="button"
            onClick={fetchOrders}
            className={`flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-base text-slate-300 transition hover:border-cyan-400 hover:text-cyan-400 ${
              refreshing ? "animate-spin text-cyan-400 border-cyan-400" : ""
            }`}
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Orders List */}
      <div className="flex flex-col divide-y divide-white/5">
        {loading ? (
          <div className="animate-pulse p-8 text-center text-sm font-semibold text-slate-400">
            Loading live orders...
          </div>
        ) : (
          orders.map((order, index) => {
            const name =
              order.user_name ||
              order.account_name ||
              order.user_email ||
              order.player_name ||
              order.playerName ||
              order.player ||
              "User";
            const pkg =
              order.package_name ||
              order.packageName ||
              order.package ||
              "Diamond Package";
            const price = order.amount || order.price || 0;
            const itemImg = order.product_image || order.image;

            return (
              <div
                key={`${order.id}-${index}`}
                className="flex items-center justify-between gap-2 px-3.5 py-3 sm:px-5 sm:py-3.5 hover:bg-white/[0.02] transition"
              >
                {/* Left Side: Product/Diamond Icon & Info */}
                <div className="flex min-w-0 items-center gap-2.5 sm:gap-3 flex-1">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#081c36] border border-cyan-400/30 overflow-hidden shadow-inner p-1">
                    {itemImg ? (
                      <Image
                        src={itemImg}
                        alt="Product"
                        width={40}
                        height={40}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      /* FF Diamond Theme Icon */
                      <svg
                        className="h-6 w-6 text-cyan-400 drop-shadow-[0_0_6px_rgba(34,211,238,0.5)]"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M12 2L3 9l9 13 9-13-9-7zm0 3.2L17.5 9 12 18.2 6.5 9 12 5.2zM8.2 8.5h7.6L12 3.8 8.2 8.5z" />
                      </svg>
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

                {/* Right Side: Mobile + PC Time and Status */}
                <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                  {/* Time Badge (Mobile & PC Both) */}
                  <span className="inline-flex items-center gap-1 rounded-md bg-white/5 border border-white/10 px-2 py-0.5 text-[10px] sm:text-xs text-slate-300 whitespace-nowrap">
                    <span className="text-[9px] text-cyan-400">🕒</span>
                    {timeAgo(order.created_at)}
                  </span>

                  {/* Status */}
                  <div className="text-right">
                    {getStatusUI(order.status)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
