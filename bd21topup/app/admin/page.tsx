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
  withdrawalRequests: number;
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
    withdrawalRequests: 0,
  });

  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showNotif, setShowNotif] = useState(false);

  const [userRole, setUserRole] = useState<string>("user");
  const [userPermissions, setUserPermissions] = useState<string[]>([]);

  async function loadStats() {
    try {
      setLoading(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login");
        return;
      }

      const roleRes = await fetch("/api/admin/role", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        cache: "no-store",
      });

      const roleData = await roleRes.json();

      if (roleData.role) {
        if (roleData.role === "user") {
          router.replace("/");
          return;
        }

        setUserRole(roleData.role);
        setUserPermissions(roleData.permissions || []);
      }

      const res = await fetch("/api/admin/dashboard", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        cache: "no-store",
      });

      if (res.status === 401 || res.status === 403) {
        await supabase.auth.signOut();
        router.replace("/login");
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
          withdrawalRequests: data.stats.withdrawalRequests || 0,
        });
      }
    } catch (error) {
      console.error("Dashboard load error:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStats();
    }, 0);

    return () => window.clearTimeout(timer);

    // Dashboard data should load once when the page mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    try {
      setLoggingOut(true);
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    } catch (error) {
      console.error("Admin logout error:", error);
      router.replace("/login");
    } finally {
      setLoggingOut(false);
    }
  }

  const hasPerm = (perm: string) =>
    userRole === "super_admin" || userPermissions.includes(perm);

  const canUseSupportCases =
    hasPerm("manage_orders") ||
    hasPerm("manage_add_money") ||
    hasPerm("manage_withdrawals");

  const totalNotifications =
    (hasPerm("manage_orders") ? stats.pendingOrders : 0) +
    (hasPerm("manage_add_money") ? stats.addMoneyRequests : 0) +
    (hasPerm("manage_withdrawals") ? stats.withdrawalRequests : 0);

  return (
    <main className="min-h-screen bg-[#061b35] p-4 text-white">
      <div className="mx-auto w-full max-w-6xl">
        {/* HEADER */}
        <div className="rounded-2xl border border-cyan-500/30 bg-[#0b294d] p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold text-cyan-400">BD21 ADMIN</h1>

              <p className="mt-2 text-sm text-gray-300">
                Customer, Order & Wallet Management (
                {userRole.toUpperCase().replace("_", " ")})
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <button
                  type="button"
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

                {showNotif && (
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowNotif(false)}
                  />
                )}

                {showNotif && (
                  <div className="fixed right-4 top-20 z-50 w-[min(16rem,calc(100vw-2rem))] rounded-2xl border border-cyan-400/30 bg-[#0b294d] p-3 shadow-2xl sm:absolute sm:right-0 sm:top-12 sm:w-64">
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
                          সব ক্লিয়ার! কোনো পেন্ডিং রিকোয়েস্ট নেই। 🎉
                        </div>
                      ) : (
                        <>
                          {hasPerm("manage_orders") &&
                            stats.pendingOrders > 0 && (
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

                          {hasPerm("manage_add_money") &&
                            stats.addMoneyRequests > 0 && (
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

                          {hasPerm("manage_withdrawals") &&
                            stats.withdrawalRequests > 0 && (
                              <Link
                                href="/admin/withdrawals"
                                className="flex items-center justify-between rounded-xl bg-[#07182f] p-3 transition hover:bg-[#102a49]"
                              >
                                <span className="text-xs font-bold text-white">
                                  Withdrawal Req
                                </span>

                                <span className="rounded-full bg-yellow-400 px-2 py-0.5 text-[10px] font-black text-black">
                                  {stats.withdrawalRequests}
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

          {/* ALL ADMIN ACTIONS / NAVIGATION */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Link
              href="/admin"
              className="rounded-xl bg-cyan-400 px-4 py-2.5 text-center font-bold text-black transition hover:opacity-90"
            >
              Dashboard
            </Link>

            {hasPerm("manage_orders") && (
              <AdminNavLink href="/admin/orders" text="Orders" />
            )}

            {hasPerm("manage_add_money") && (
              <AdminNavLink href="/admin/add-money" text="Add Money" />
            )}

            {hasPerm("manage_withdrawals") && (
              <AdminNavLink href="/admin/withdrawals" text="Withdrawals" />
            )}

            {hasPerm("manage_users") && (
              <AdminNavLink href="/admin/users" text="Users" />
            )}

            {hasPerm("manage_packages") && (
              <AdminNavLink href="/admin/packages" text="Packages" />
            )}

            {canUseSupportCases && (
              <AdminNavLink href="/admin/support-cases" text="Support Case" />
            )}

            {userRole === "super_admin" && (
              <AdminNavLink href="/admin/activity" text="Activity Log" />
            )}
          </div>
        </div>

        {/* STATS */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            title="TOTAL ORDERS"
            value={loading ? "..." : stats.totalOrders}
            color="cyan"
          />

          {hasPerm("manage_orders") && (
            <StatCard
              title="PENDING ORDERS"
              value={loading ? "..." : stats.pendingOrders}
              color="yellow"
            />
          )}

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

          {hasPerm("manage_users") && (
            <StatCard
              title="TOTAL USERS"
              value={loading ? "..." : stats.totalUsers}
              color="cyan"
            />
          )}

          {hasPerm("manage_add_money") && (
            <StatCard
              title="ADD MONEY REQ"
              value={loading ? "..." : stats.addMoneyRequests}
              color="yellow"
            />
          )}

          {hasPerm("manage_withdrawals") && (
            <StatCard
              title="WITHDRAWAL REQ"
              value={loading ? "..." : stats.withdrawalRequests}
              color="yellow"
            />
          )}
        </div>

        {/* ATTENTION REQUIRED */}
        {!loading &&
          ((hasPerm("manage_orders") && stats.pendingOrders > 0) ||
            (hasPerm("manage_add_money") && stats.addMoneyRequests > 0) ||
            (hasPerm("manage_withdrawals") &&
              stats.withdrawalRequests > 0)) && (
            <div className="mt-5 rounded-2xl border border-yellow-400/20 bg-yellow-400/5 p-5">
              <h2 className="text-lg font-black text-yellow-300">
                Attention Required
              </h2>

              <div className="mt-3 space-y-2">
                {hasPerm("manage_orders") && stats.pendingOrders > 0 && (
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

                {hasPerm("manage_add_money") && stats.addMoneyRequests > 0 && (
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

                {hasPerm("manage_withdrawals") &&
                  stats.withdrawalRequests > 0 && (
                    <Link
                      href="/admin/withdrawals"
                      className="flex items-center justify-between rounded-xl bg-[#07182f] p-3 transition hover:bg-[#102a49]"
                    >
                      <span className="text-sm font-bold">
                        Pending Withdrawal Requests
                      </span>

                      <span className="rounded-full bg-yellow-400 px-3 py-1 text-xs font-black text-black">
                        {stats.withdrawalRequests}
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

function AdminNavLink({ href, text }: { href: string; text: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-cyan-500/40 px-4 py-2.5 text-center font-medium transition hover:bg-cyan-500/10"
    >
      {text}
    </Link>
  );
}
