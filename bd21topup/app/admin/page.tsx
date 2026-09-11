"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type DashboardStats = {
  totalOrders: number;
  totalUsers: number;
  pendingOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  addMoneyRequests: number;
};

export default function AdminDashboard() {
  const router = useRouter();

  const [stats, setStats] = useState<DashboardStats>({
    totalOrders: 0,
    totalUsers: 0,
    pendingOrders: 0,
    completedOrders: 0,
    cancelledOrders: 0,
    addMoneyRequests: 0,
  });

  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showNotif, setShowNotif] = useState(false); // নোটিফিকেশন ড্রপডাউন স্টেট

  async function loadStats() {
    try {
      setLoading(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/admin/login");
        return;
      }

      const res = await fetch("/api/admin/dashboard", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        cache: "no-store",
      });

      if (res.status === 401 || res.status === 403) {
        await supabase.auth.signOut();
        router.replace("/admin/login");
        return;
      }

      const data = await res.json();

      if (data.success) {
        setStats({
          totalOrders: data.stats.totalOrders || 0,
          totalUsers: data.stats.totalUsers || 0,
          pendingOrders: data.stats.pendingOrders || 0,
          completedOrders: data.stats.completedOrders || 0,
          cancelledOrders: data.stats.cancelledOrders || 0,
          addMoneyRequests: data.stats.addMoneyRequests || 0,
        });
      }
    } catch (error) {
      console.error("Dashboard load error:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStats();
  }, []);

  async function handleLogout() {
    try {
      setLoggingOut(true);
      await supabase.auth.signOut();
      router.replace("/admin/login");
      router.refresh();
    } catch (error) {
      console.error("Admin logout error:", error);
      router.replace("/admin/login");
    } finally {
      setLoggingOut(false);
    }
  }

  const totalNotifications = stats.pendingOrders + stats.addMoneyRequests;

  return (
    <main className="min-h-screen bg-[#061b35] p-4 text-white">
      <div className="mx-auto w-full max-w-6xl">
        {/* =====================================================
            HEADER
        ===================================================== */}
        <div className="rounded-2xl border border-cyan-500/30 bg-[#0b294d] p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold text-cyan-400">BD21 ADMIN</h1>
              <p className="mt-2 text-sm text-gray-300">
                Customer, Order & Wallet Management
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* Notification Bell */}
              <div className="relative">
                <button
                  onClick={() => setShowNotif(!showNotif)}
                  className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400/10 text-xl text-cyan-400 transition hover:bg-cyan-400/20"
                >
                  🔔
                  {!loading && totalNotifications > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white shadow-md">
                      {totalNotifications}
                    </span>
                  )}
                </button>

                {/* Dropdown Overlay (বাইরে ক্লিক করলে বন্ধ হবে) */}
                {showNotif && (
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowNotif(false)}
                  ></div>
                )}

                {/* Notification Dropdown Box */}
                {showNotif && (
                  <div className="absolute right-0 top-12 z-50 w-64 rounded-2xl border border-cyan-400/30 bg-[#0b294d] p-3 shadow-2xl">
                    <h3 className="mb-2 px-2 text-[10px] font-black uppercase tracking-wider text-cyan-300">
                      Notifications
                    </h3>

                    <div className="flex flex-col gap-2">
                      {loading ? (
                        <div className="px-2 py-3 text-center text-xs text-slate-400">
                          Loading...
                        </div>
                      ) : totalNotifications === 0 ? (
                        <div className="px-2 py-3 text-center text-xs text-slate-400">
                          সব ক্লিয়ার! কোনো পেন্ডিং রিকোয়েস্ট নেই। 🎉
                        </div>
                      ) : (
                        <>
                          {stats.pendingOrders > 0 && (
                            <Link
                              href="/admin/orders"
                              className="flex items-center justify-between rounded-xl bg-[#07182f] p-3 transition hover:bg-[#102a49]"
                            >
                              <span className="text-xs font-bold text-white">
                                Pending Orders
                              </span>
                              <span className="rounded-full bg-yellow-400 px-2 py-0.5 text-[10px] font-black text-black">
                                {stats.pendingOrders}
                              </span>
                            </Link>
                          )}

                          {stats.addMoneyRequests > 0 && (
                            <Link
                              href="/admin/add-money"
                              className="flex items-center justify-between rounded-xl bg-[#07182f] p-3 transition hover:bg-[#102a49]"
                            >
                              <span className="text-xs font-bold text-white">
                                Add Money Req
                              </span>
                              <span className="rounded-full bg-yellow-400 px-2 py-0.5 text-[10px] font-black text-black">
                                {stats.addMoneyRequests}
                              </span>
                            </Link>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                className="rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-bold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loggingOut ? "Logging out..." : "Logout"}
              </button>
            </div>
          </div>

          {/* =================================================
              NAVIGATION
          ================================================= */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Link
              href="/admin"
              className="rounded-xl bg-cyan-400 px-4 py-2 text-center font-bold text-black transition hover:opacity-90"
            >
              Dashboard
            </Link>
            <Link
              href="/admin/orders"
              className="rounded-xl border border-cyan-500/40 px-4 py-2 text-center transition hover:bg-cyan-500/10"
            >
              Orders
            </Link>
            <Link
              href="/admin/add-money"
              className="rounded-xl border border-cyan-500/40 px-4 py-2 text-center transition hover:bg-cyan-500/10"
            >
              Add Money
            </Link>
            <Link
              href="/admin/users"
              className="rounded-xl border border-cyan-500/40 px-4 py-2 text-center transition hover:bg-cyan-500/10"
            >
              Users
            </Link>
            <Link
              href="/admin/packages"
              className="rounded-xl border border-cyan-500/40 px-4 py-2 text-center transition hover:bg-cyan-500/10"
            >
              Packages
            </Link>
          </div>
        </div>

        {/* =====================================================
            ORDER / USER STATS
        ===================================================== */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            title="TOTAL ORDERS"
            value={loading ? "..." : stats.totalOrders}
            color="cyan"
          />
          <StatCard
            title="PENDING ORDERS"
            value={loading ? "..." : stats.pendingOrders}
            color="yellow"
          />
          <StatCard
            title="COMPLETED"
            value={loading ? "..." : stats.completedOrders}
            color="green"
          />
          <StatCard
            title="CANCELLED"
            value={loading ? "..." : stats.cancelledOrders}
            color="red"
          />
          <StatCard
            title="TOTAL USERS"
            value={loading ? "..." : stats.totalUsers}
            color="cyan"
          />
          <StatCard
            title="ADD MONEY REQ"
            value={loading ? "..." : stats.addMoneyRequests}
            color="yellow"
          />
        </div>

        {/* =====================================================
            QUICK ACTIONS
        ===================================================== */}
        <div className="mt-5 rounded-2xl border border-cyan-500/20 bg-[#0b294d] p-5">
          <h2 className="text-xl font-bold">Quick Actions</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ActionLink href="/admin/orders" text="Manage Orders" />
            <ActionLink href="/admin/add-money" text="Review Wallet" />
            <ActionLink href="/admin/users" text="View Users" />
            <ActionLink href="/admin/packages" text="Update Prices" />
          </div>
        </div>

        {/* =====================================================
            IMPORTANT ACTIONS (ATTENTION REQUIRED)
        ===================================================== */}
        {!loading &&
          (stats.pendingOrders > 0 || stats.addMoneyRequests > 0) && (
            <div className="mt-5 rounded-2xl border border-yellow-400/20 bg-yellow-400/5 p-5">
              <h2 className="text-lg font-black text-yellow-300">
                Attention Required
              </h2>
              <div className="mt-3 space-y-2">
                {stats.pendingOrders > 0 && (
                  <Link
                    href="/admin/orders"
                    className="flex items-center justify-between rounded-xl bg-[#07182f] p-3 transition hover:bg-[#102a49]"
                  >
                    <span className="text-sm font-bold">Pending Orders</span>
                    <span className="rounded-full bg-yellow-400 px-3 py-1 text-xs font-black text-black">
                      {stats.pendingOrders}
                    </span>
                  </Link>
                )}

                {stats.addMoneyRequests > 0 && (
                  <Link
                    href="/admin/add-money"
                    className="flex items-center justify-between rounded-xl bg-[#07182f] p-3 transition hover:bg-[#102a49]"
                  >
                    <span className="text-sm font-bold">
                      Pending Add Money Requests
                    </span>
                    <span className="rounded-full bg-yellow-400 px-3 py-1 text-xs font-black text-black">
                      {stats.addMoneyRequests}
                    </span>
                  </Link>
                )}
              </div>
            </div>
          )}
      </div>
    </main>
  );
}

/* =========================================================
   STAT CARD
========================================================= */
function StatCard({
  title,
  value,
  color = "cyan",
}: {
  title: string;
  value: string | number;
  color?: "cyan" | "yellow" | "blue" | "green" | "red";
}) {
  const colorClass = {
    cyan: "text-cyan-400",
    yellow: "text-yellow-300",
    blue: "text-blue-300",
    green: "text-green-300",
    red: "text-red-300",
  }[color];

  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-[#0b294d] p-4">
      <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">
        {title}
      </p>
      <h2 className={`mt-2 text-3xl font-black ${colorClass}`}>{value}</h2>
    </div>
  );
}

/* =========================================================
   QUICK ACTION LINK
========================================================= */
function ActionLink({ href, text }: { href: string; text: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl bg-cyan-400 py-3 text-center font-bold text-black transition hover:opacity-90"
    >
      {text}
    </Link>
  );
}
