"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import AdminPageHeader from "@/components/AdminPageHeader";
import AdminSearchInput from "@/components/AdminSearchInput";

type Order = {
  id: string;
  user_id?: string | null;
  uid: string;
  player_name: string;
  product_name: string;
  package_name: string;
  amount: number | string;
  payment_method: string;
  receiver_number: string | null;
  transaction_id: string;
  status: string;
  created_at: string;
  admin_note?: string | null;
  cancelled_at?: string | null;
};

function statusClasses(status: string) {
  switch (status) {
    case "pending":
      return "border-orange-400/40 bg-orange-400/10 text-orange-300";
    case "completed":
      return "border-cyan-400/40 bg-cyan-400/10 text-cyan-300";
    case "approved":
      return "border-emerald-400/40 bg-emerald-400/10 text-emerald-300";
    case "rejected":
      return "border-red-400/40 bg-red-400/10 text-red-300";
    case "cancelled":
      return "border-red-500/40 bg-red-500/10 text-red-400";
    default:
      return "border-slate-400/40 bg-slate-400/10 text-slate-300";
  }
}

function formatBangladeshTime(value: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Dhaka",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default function AdminOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [message, setMessage] = useState("Loading orders...");
  const [isLoading, setIsLoading] = useState(true);
  const [actionOrderId, setActionOrderId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [cancelNote, setCancelNote] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBulkCancelOpen, setIsBulkCancelOpen] = useState(false);
  const [bulkCancelReason, setBulkCancelReason] = useState("");
  const [isBulkLoading, setIsBulkLoading] = useState(false);

  const loadOrders = useCallback(async () => {
    setIsLoading(true);
    setActionMessage("");
    setSelectedIds([]);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }

      const response = await fetch("/api/admin/orders", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });

      if (response.status === 401 || response.status === 403) {
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }

      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error || "Orders load failed");
        return;
      }

      setOrders(result.orders || []);
      setMessage("");
    } catch (error) {
      console.error("ORDER LOAD ERROR", error);
      setMessage("Server connection error");
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOrders();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadOrders]);

  const stats = useMemo(() => {
    return {
      total: orders.length,
      pending: orders.filter((order) => order.status === "pending").length,
      completed: orders.filter((order) => order.status === "completed").length,
      cancelled: orders.filter((order) => order.status === "cancelled").length,
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const searchText = search.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesStatus =
        statusFilter === "all" || order.status === statusFilter;
      if (!matchesStatus) return false;
      if (!searchText) return true;

      const searchableText = [
        order.id,
        order.uid,
        order.player_name,
        order.transaction_id,
        order.receiver_number || "",
        order.package_name,
        order.product_name,
        order.payment_method,
        order.user_id || "",
        order.admin_note || "",
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(searchText);
    });
  }, [orders, search, statusFilter]);

  const visiblePendingIds = useMemo(() => {
    return filteredOrders
      .filter((o) => o.status === "pending")
      .map((o) => o.id);
  }, [filteredOrders]);

  const isAllPendingSelected =
    visiblePendingIds.length > 0 &&
    visiblePendingIds.every((id) => selectedIds.includes(id));

  function toggleSelectAllPending() {
    if (isAllPendingSelected) {
      setSelectedIds((prev) =>
        prev.filter((id) => !visiblePendingIds.includes(id)),
      );
    } else {
      setSelectedIds((prev) =>
        Array.from(new Set([...prev, ...visiblePendingIds])),
      );
    }
  }

  function toggleSelectOrder(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  // EDITED: API কল করা হয়েছে ক্লায়েন্ট সাইড কুয়েরির বদলে
  async function updateOrderStatus(orderId: string, status: "completed") {
    setActionOrderId(orderId);
    setActionMessage("");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }

      const response = await fetch("/api/admin/orders", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ orderId, status }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Update failed");
      }

      setOrders((current) =>
        current.map((order) =>
          order.id === orderId ? { ...order, status } : order,
        ),
      );
      setActionMessage("Order completed successfully ✅");
    } catch (error: unknown) {
      console.error("ORDER STATUS ERROR", error);
      setActionMessage(
        "Update failed: " +
          (error instanceof Error ? error.message : "Server error"),
      );
    } finally {
      setActionOrderId(null);
    }
  }

  // EDITED: API কল করা হয়েছে ক্লায়েন্ট সাইড কুয়েরির বদলে
  async function cancelOrder() {
    if (!cancelOrderId) return;
    if (!cancelNote.trim()) {
      setActionMessage("Please write cancellation reason");
      return;
    }
    setActionOrderId(cancelOrderId);
    setActionMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }

      const response = await fetch("/api/admin/orders", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          orderId: cancelOrderId,
          status: "cancelled",
          note: cancelNote.trim(),
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Cancel failed");
      }

      setOrders((current) =>
        current.map((order) =>
          order.id === cancelOrderId
            ? {
                ...order,
                status: "cancelled",
                admin_note: cancelNote.trim(),
                cancelled_at: new Date().toISOString(),
              }
            : order,
        ),
      );
      setCancelOrderId(null);
      setCancelNote("");
      setActionMessage("Order cancelled successfully ❌");
    } catch (error: unknown) {
      console.error("CANCEL ERROR", error);
      setActionMessage(
        "Cancel failed: " +
          (error instanceof Error ? error.message : "Server error"),
      );
    } finally {
      setActionOrderId(null);
    }
  }

  // বাল্ক অ্যাকশন হ্যান্ডলার (আপনার করা এপিআই রাউটের মাধ্যমেই কাজ করবে)
  async function handleBulkAction(action: "completed" | "cancelled") {
    if (selectedIds.length === 0) return;

    if (action === "cancelled" && !bulkCancelReason.trim()) {
      setActionMessage("অর্ডার বাতিল করার কারণ লিখতে হবে!");
      return;
    }

    setIsBulkLoading(true);
    setActionMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }

      for (const orderId of selectedIds) {
        const response = await fetch("/api/admin/orders", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            orderId,
            status: action,
            note: action === "cancelled" ? bulkCancelReason.trim() : undefined,
          }),
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Update failed");
        }
      }

      setActionMessage(
        `সফলভাবে ${selectedIds.length}টি অর্ডার ${action} করা হয়েছে ✅`,
      );
      setSelectedIds([]);
      setIsBulkCancelOpen(false);
      setBulkCancelReason("");
      await loadOrders();
    } catch (error: unknown) {
      console.error("BULK ACTION ERROR", error);
      setActionMessage(
        "Bulk action failed: " +
          (error instanceof Error ? error.message : "সার্ভারে সমস্যা হয়েছে।"),
      );
    } finally {
      setIsBulkLoading(false);
    }
  }

  return (
    <>
      <main className="min-h-screen bg-[#07182f] px-3 py-4 pb-24 text-white sm:px-5">
        <div className="mx-auto w-full max-w-6xl">
          <AdminPageHeader
            title="Orders Dashboard"
            subtitle="Manage customer orders and payment status"
            onRefresh={loadOrders}
            refreshDisabled={isLoading}
            onLogout={async () => {
              await supabase.auth.signOut();
              router.replace("/login");
            }}
          />

          <section className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard label="TOTAL" value={stats.total} />
            <StatCard label="PENDING" value={stats.pending} />
            <StatCard label="COMPLETED" value={stats.completed} />
            <StatCard label="CANCELLED" value={stats.cancelled} />
          </section>

          <section className="mt-3 rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-black">All Orders</h2>
                <p className="text-[10px] text-slate-500">
                  {filteredOrders.length} order
                  {filteredOrders.length !== 1 ? "s" : ""} found
                </p>
              </div>
            </div>

            <AdminSearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search Order ID, UID, Player, Transaction ID..."
              clearable
              ariaLabel="Search orders"
            />

            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {[
                { id: "all", label: "All", count: stats.total },
                { id: "pending", label: "Pending", count: stats.pending },
                { id: "completed", label: "Completed", count: stats.completed },
                { id: "cancelled", label: "Cancelled", count: stats.cancelled },
              ].map((filter) => {
                const active = statusFilter === filter.id;
                return (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => setStatusFilter(filter.id)}
                    className={`shrink-0 rounded-lg border px-3 py-2 text-[10px] font-black transition ${active ? "border-cyan-400 bg-cyan-400 text-black" : "border-white/10 bg-[#07182f] text-slate-400 hover:border-cyan-400/40"}`}
                  >
                    {filter.label} ({filter.count})
                  </button>
                );
              })}
            </div>

            {visiblePendingIds.length > 0 && (
              <div className="mt-3 flex items-center justify-between rounded-xl border border-cyan-400/15 bg-[#07182f] px-3 py-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-300">
                  <input
                    type="checkbox"
                    checked={isAllPendingSelected}
                    onChange={toggleSelectAllPending}
                    className="h-4 w-4 cursor-pointer rounded accent-cyan-400"
                  />
                  Select All Pending ({visiblePendingIds.length})
                </label>
                {selectedIds.length > 0 && (
                  <span className="text-[11px] font-black text-cyan-300">
                    {selectedIds.length} Selected
                  </span>
                )}
              </div>
            )}

            {actionMessage && (
              <div className="mt-3 rounded-lg bg-cyan-400/10 p-2 text-center text-xs text-cyan-300">
                {actionMessage}
              </div>
            )}
            {message && (
              <div className="mt-3 rounded-xl bg-[#07182f] p-5 text-center text-sm text-slate-400">
                {message}
              </div>
            )}

            <div className="mt-3 space-y-3">
              {filteredOrders.map((order) => {
                const canComplete =
                  order.status === "pending" || order.status === "approved";
                const isActioning = actionOrderId === order.id;
                const isPending = order.status === "pending";

                return (
                  <article
                    key={order.id}
                    className={`rounded-xl border p-3 transition ${selectedIds.includes(order.id) ? "border-cyan-400/60 bg-[#0a2342]" : "border-cyan-400/15 bg-[#07182f]"}`}
                  >
                    <div className="flex justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {isPending && (
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(order.id)}
                              onChange={() => toggleSelectOrder(order.id)}
                              className="h-4 w-4 cursor-pointer rounded accent-cyan-400"
                            />
                          )}
                          <h3 className="max-w-[170px] truncate text-sm font-black">
                            {order.player_name}
                          </h3>
                          <span
                            className={`rounded-full border px-2 py-[2px] text-[8px] font-black uppercase ${statusClasses(order.status)}`}
                          >
                            {order.status}
                          </span>
                        </div>
                        <p className="mt-1 text-[10px] text-slate-500">
                          {formatBangladeshTime(order.created_at)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[10px] text-slate-500">Amount</p>
                        <p className="text-base font-black text-cyan-300">
                          ৳{Number(order.amount)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Info label="UID" value={order.uid} copyable />
                      <Info label="Package" value={order.package_name} />
                      <Info
                        label="Payment"
                        value={order.payment_method.toUpperCase()}
                      />
                      <Info
                        label="Receiver"
                        value={order.receiver_number || "Wallet Payment"}
                      />
                    </div>
                    <Info label="Transaction ID" value={order.transaction_id} />
                    <Info label="Order ID" value={order.id} />

                    {order.status === "cancelled" && order.admin_note && (
                      <div className="mt-2 rounded-lg border border-red-400/20 bg-red-500/10 p-3">
                        <p className="text-[10px] font-bold uppercase text-red-300">
                          Cancellation Reason
                        </p>
                        <p className="mt-1 break-all text-sm font-bold text-white">
                          {order.admin_note}
                        </p>
                      </div>
                    )}

                    {canComplete && (
                      <button
                        type="button"
                        disabled={isActioning}
                        onClick={() => updateOrderStatus(order.id, "completed")}
                        className="mt-2 h-9 w-full rounded-lg bg-cyan-400 text-[11px] font-black text-[#06172e] disabled:opacity-60"
                      >
                        {isActioning ? "Updating..." : "Mark Completed"}
                      </button>
                    )}

                    {order.status !== "completed" &&
                      order.status !== "cancelled" && (
                        <button
                          type="button"
                          disabled={isActioning}
                          onClick={() => {
                            setCancelOrderId(order.id);
                            setCancelNote("");
                            setActionMessage("");
                          }}
                          className="mt-2 h-9 w-full rounded-lg bg-red-500 text-[11px] font-black text-white disabled:opacity-60"
                        >
                          Cancel Order
                        </button>
                      )}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </main>

      {/* Floating Bar with high z-index */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-16 left-1/2 z-[99999] flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-cyan-400/40 bg-[#07182f]/95 px-4 py-3 shadow-2xl backdrop-blur-md">
          <span className="whitespace-nowrap text-xs font-black text-cyan-300">
            {selectedIds.length} Selected
          </span>
          <button
            type="button"
            disabled={isBulkLoading}
            onClick={() => handleBulkAction("completed")}
            className="whitespace-nowrap rounded-xl bg-cyan-400 px-3 py-1.5 text-xs font-black text-[#06172e] transition hover:bg-cyan-300 disabled:opacity-50"
          >
            {isBulkLoading ? "Processing..." : "Mark Completed"}
          </button>
          <button
            type="button"
            disabled={isBulkLoading}
            onClick={() => {
              setBulkCancelReason("");
              setIsBulkCancelOpen(true);
            }}
            className="whitespace-nowrap rounded-xl bg-red-500 px-3 py-1.5 text-xs font-black text-white transition hover:bg-red-600 disabled:opacity-50"
          >
            Cancel Order
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds([])}
            className="rounded-xl bg-slate-700 px-2.5 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-600"
          >
            ✕
          </button>
        </div>
      )}

      {isBulkCancelOpen && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 p-5">
          <div className="w-full max-w-md rounded-2xl border border-red-400/30 bg-[#0b2545] p-5 shadow-2xl">
            <h2 className="text-xl font-black text-red-400">
              Cancel {selectedIds.length} Selected Orders
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              বাতিল করার কারণ লিখুন (বাধ্যতামূলক):
            </p>
            <textarea
              autoFocus
              value={bulkCancelReason}
              onChange={(e) => setBulkCancelReason(e.target.value)}
              placeholder="উদাহরণ: ভুল UID / পেমেন্ট ভেরিফাই হয়নি"
              className="mt-3 h-28 w-full resize-none rounded-xl border border-white/10 bg-[#07182f] p-3 text-sm text-white outline-none focus:border-red-400/50"
            />
            <button
              type="button"
              onClick={() => handleBulkAction("cancelled")}
              disabled={isBulkLoading || !bulkCancelReason.trim()}
              className="mt-3 w-full rounded-xl bg-red-500 py-3 font-black text-white disabled:opacity-60"
            >
              {isBulkLoading ? "Cancelling..." : "Confirm Cancel"}
            </button>
            <button
              type="button"
              disabled={isBulkLoading}
              onClick={() => {
                setIsBulkCancelOpen(false);
                setBulkCancelReason("");
              }}
              className="mt-2 w-full rounded-xl bg-slate-700 py-2 font-bold text-white"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {cancelOrderId && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 p-5">
          <div className="w-full max-w-md rounded-2xl border border-red-400/30 bg-[#0b2545] p-5 shadow-2xl">
            <h2 className="text-xl font-black text-red-400">Cancel Order</h2>
            <p className="mt-2 text-sm text-slate-400">
              Write cancellation reason
            </p>
            <textarea
              autoFocus
              value={cancelNote}
              onChange={(e) => setCancelNote(e.target.value)}
              placeholder="Example: Payment verification failed"
              className="mt-3 h-28 w-full resize-none rounded-xl border border-white/10 bg-[#07182f] p-3 text-sm text-white outline-none focus:border-red-400/50"
            />
            {actionMessage && (
              <p className="mt-2 text-center text-xs font-bold text-red-300">
                {actionMessage}
              </p>
            )}
            <button
              type="button"
              onClick={cancelOrder}
              disabled={actionOrderId === cancelOrderId}
              className="mt-3 w-full rounded-xl bg-red-500 py-3 font-black text-white disabled:opacity-60"
            >
              {actionOrderId === cancelOrderId
                ? "Cancelling..."
                : "Confirm Cancel"}
            </button>
            <button
              type="button"
              disabled={actionOrderId === cancelOrderId}
              onClick={() => {
                setCancelOrderId(null);
                setCancelNote("");
                setActionMessage("");
              }}
              className="mt-2 w-full rounded-xl bg-slate-700 py-2 font-bold text-white"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-cyan-400/20 bg-[#0b2545] p-3 text-center">
      <p className="text-[9px] font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-black text-cyan-300">{value}</p>
    </div>
  );
}

function Info({
  label,
  value,
  copyable,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed", err);
    }
  };
  return (
    <div className="mt-2 flex items-center justify-between rounded-lg border border-cyan-400/10 bg-[#0b2545] px-3 py-2">
      <div className="min-w-0">
        <p className="text-[9px] font-bold uppercase text-slate-500">{label}</p>
        <p className="mt-1 break-all text-[11px] font-bold text-slate-200">
          {value}
        </p>
      </div>
      {copyable && (
        <button
          type="button"
          onClick={handleCopy}
          className={`ml-2 shrink-0 rounded-md px-2 py-1 text-[10px] font-black transition ${copied ? "bg-green-400/20 text-green-300" : "bg-cyan-400/20 text-cyan-300 hover:bg-cyan-400 hover:text-[#06172e]"}`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}
