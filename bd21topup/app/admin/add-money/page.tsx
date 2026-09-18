"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type RequestStatus = "pending" | "approved" | "rejected";

type AddMoneyAdminRequest = {
  id: string;
  userId: string;
  amount: number;
  paymentMethod: string;
  receiverNumber: string;
  transactionId: string;
  status: RequestStatus;
  adminNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  customer: {
    fullName: string;
    email: string;
    phone: string;
    walletBalance: number;
  };
};

function statusClass(status: RequestStatus) {
  if (status === "approved")
    return "border-green-400/25 bg-green-400/10 text-green-300";
  if (status === "rejected")
    return "border-red-400/25 bg-red-400/10 text-red-300";
  return "border-amber-400/25 bg-amber-400/10 text-amber-300";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-BD", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dhaka",
  }).format(new Date(value));
}

export default function AdminAddMoneyPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<AddMoneyAdminRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [workingId, setWorkingId] = useState("");
  const [noteById, setNoteById] = useState<Record<string, string>>({});

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBulkRejectOpen, setIsBulkRejectOpen] = useState(false);
  const [bulkRejectNote, setBulkRejectNote] = useState("");
  const [isBulkLoading, setIsBulkLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | RequestStatus>(
    "all",
  );

  useEffect(() => {
    loadRequests();
  }, []);

  async function getAdminSession() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      router.replace("/login");
      return null;
    }
    return session;
  }

  async function loadRequests() {
    try {
      setLoading(true);
      setSelectedIds([]);
      const session = await getAdminSession();
      if (!session) return;

      const response = await fetch("/api/admin/add-money", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });

      const data = await response.json();
      if (response.status === 401 || response.status === 403) {
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }
      if (!response.ok) {
        setMessage(data.error || "Requests load করা যায়নি।");
        return;
      }

      setRequests(data.requests || []);
      setMessage("");
    } catch (error) {
      console.error("ADMIN ADD MONEY PAGE ERROR:", error);
      setMessage("Server-এর সাথে connection করা যায়নি।");
    } finally {
      setLoading(false);
    }
  }

  async function reviewRequest(
    requestId: string,
    action: "approved" | "rejected",
  ) {
    setWorkingId(requestId);
    setMessage("");
    try {
      const session = await getAdminSession();
      if (!session) return;

      const response = await fetch("/api/admin/add-money", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          requestId,
          action,
          adminNote: noteById[requestId] || "",
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error || "Request review করা যায়নি।");
        return;
      }

      setMessage(
        action === "approved"
          ? "Add Money approved ✅ Wallet balance credited."
          : "Add Money request rejected ❌",
      );
      await loadRequests();
    } catch (error) {
      console.error("ADMIN ADD MONEY REVIEW ERROR:", error);
      setMessage("Server-এর সাথে connection করা যায়নি।");
    } finally {
      setWorkingId("");
    }
  }

  async function undoRequest(requestId: string) {
    const confirmed = window.confirm(
      "এই Add Money action-টি Undo করতে চান?\n\nApproved হলে wallet balance reverse হবে এবং request আবার Pending হবে.",
    );
    if (!confirmed) return;
    setWorkingId(requestId);
    setMessage("");
    try {
      const session = await getAdminSession();
      if (!session) return;

      const response = await fetch("/api/admin/add-money", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          requestId,
          action: "undo",
          adminNote: noteById[requestId] || "",
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error || "Request Undo করা যায়নি।");
        return;
      }

      setMessage(
        data.previousStatus === "approved"
          ? "Approved request Undo হয়েছে 🔄 Wallet balance reverse করা হয়েছে।"
          : "Rejected request Undo হয়েছে 🔄",
      );
      await loadRequests();
    } catch (error) {
      console.error("ADMIN ADD MONEY UNDO ERROR:", error);
      setMessage("Server-এর সাথে connection করা যায়নি।");
    } finally {
      setWorkingId("");
    }
  }

  // একদম নিখুঁত Bulk Action (API Route-এর মাধ্যমে)
  async function handleBulkAction(action: "approved" | "rejected") {
    if (selectedIds.length === 0) return;
    if (action === "rejected" && !bulkRejectNote.trim()) {
      setMessage("বাতিল করার কারণ (Admin Note) উল্লেখ করা বাধ্যতামূলক!");
      return;
    }

    setIsBulkLoading(true);
    setMessage("");

    try {
      const session = await getAdminSession();
      if (!session) return;

      for (const reqId of selectedIds) {
        const reqItem = requests.find((r) => r.id === reqId);
        if (!reqItem || reqItem.status !== "pending") continue;

        const response = await fetch("/api/admin/add-money", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            requestId: reqId,
            action: action,
            adminNote:
              action === "rejected" ? bulkRejectNote.trim() : undefined,
          }),
        });

        if (!response.ok) {
          const resJson = await response.json();
          throw new Error(resJson.error || `Failed for ID: ${reqId}`);
        }
      }

      setMessage(
        `সফলভাবে ${selectedIds.length}টি রিকোয়েস্ট ${action} করা হয়েছে ✅`,
      );
      setSelectedIds([]);
      setIsBulkRejectOpen(false);
      setBulkRejectNote("");
      await loadRequests();
    } catch (error: any) {
      console.error("ADD MONEY BULK ACTION ERROR:", error);
      setMessage("সার্ভারে সমস্যা হয়েছে: " + (error.message || ""));
    } finally {
      setIsBulkLoading(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const counts = useMemo(() => {
    return requests.reduce(
      (result, item) => {
        result.total += 1;
        result[item.status] += 1;
        return result;
      },
      { total: 0, pending: 0, approved: 0, rejected: 0 },
    );
  }, [requests]);

  const filteredRequests = useMemo(() => {
    const searchText = search.trim().toLowerCase();
    return requests.filter((request) => {
      const matchesStatus =
        statusFilter === "all" || request.status === statusFilter;
      if (!matchesStatus) return false;
      if (!searchText) return true;

      const searchableText = [
        request.id,
        request.userId,
        request.transactionId,
        request.receiverNumber,
        request.paymentMethod,
        request.customer.fullName,
        request.customer.email,
        request.customer.phone,
        request.adminNote || "",
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(searchText);
    });
  }, [requests, search, statusFilter]);

  const visiblePendingIds = useMemo(() => {
    return filteredRequests
      .filter((r) => r.status === "pending")
      .map((r) => r.id);
  }, [filteredRequests]);

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

  function toggleSelectRequest(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  return (
    <>
      <main className="min-h-screen w-full overflow-x-hidden bg-[#07182f] pb-24 text-white">
        <section className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-5">
          {/* HEADER */}
          <div className="rounded-2xl border border-cyan-400/15 bg-[#0b2545] p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">
              BD21 Admin
            </p>
            <h1 className="mt-1 text-2xl font-black">Add Money Requests</h1>
            <p className="mt-2 text-sm text-slate-400">
              Customer wallet top-up claims review করুন।
            </p>
            <div className="mt-4 flex gap-2">
              <Link
                href="/admin"
                className="rounded-xl border border-cyan-400/20 px-3 py-2 text-xs font-bold text-cyan-300"
              >
                Home
              </Link>
              <button
                type="button"
                onClick={logout}
                className="rounded-xl bg-cyan-400 px-3 py-2 text-xs font-black text-[#06172e]"
              >
                Logout
              </button>
            </div>

            {/* SEARCH */}
            <div className="relative mt-5">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                🔍
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, phone, transaction ID, request ID..."
                className="h-11 w-full rounded-xl border border-cyan-400/20 bg-[#07182f] pl-10 pr-10 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-400/50"
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
                Showing {filteredRequests.length} of {requests.length} requests
              </p>
            )}
          </div>

          {/* STATS */}
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-2xl border border-cyan-400/15 bg-[#0b2545] p-4 text-center">
              <div className="text-xs font-black text-slate-500">TOTAL</div>
              <div className="mt-2 text-2xl font-black text-cyan-400">
                {counts.total}
              </div>
            </div>
            <div className="rounded-2xl border border-amber-400/15 bg-[#0b2545] p-4 text-center">
              <div className="text-xs font-black text-slate-500">PENDING</div>
              <div className="mt-2 text-2xl font-black text-amber-300">
                {counts.pending}
              </div>
            </div>
            <div className="rounded-2xl border border-green-400/15 bg-[#0b2545] p-4 text-center">
              <div className="text-xs font-black text-slate-500">APPROVED</div>
              <div className="mt-2 text-2xl font-black text-green-300">
                {counts.approved}
              </div>
            </div>
            <div className="rounded-2xl border border-red-400/15 bg-[#0b2545] p-4 text-center">
              <div className="text-xs font-black text-slate-500">REJECTED</div>
              <div className="mt-2 text-2xl font-black text-red-300">
                {counts.rejected}
              </div>
            </div>
          </div>

          {/* REQUEST HEADER */}
          <div className="mt-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-black">All Requests</h2>
              <p className="text-xs text-slate-500">
                {filteredRequests.length} matching request
                {filteredRequests.length !== 1 ? "s" : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={loadRequests}
              disabled={loading}
              className="rounded-xl border border-cyan-400/20 px-4 py-2 text-xs font-black text-cyan-300 disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>

          {/* STATUS FILTER */}
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {[
              { id: "all" as const, label: "All", count: counts.total },
              {
                id: "pending" as const,
                label: "Pending",
                count: counts.pending,
              },
              {
                id: "approved" as const,
                label: "Approved",
                count: counts.approved,
              },
              {
                id: "rejected" as const,
                label: "Rejected",
                count: counts.rejected,
              },
            ].map((filter) => {
              const active = statusFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setStatusFilter(filter.id)}
                  className={`shrink-0 rounded-xl border px-4 py-2 text-xs font-black transition ${active ? "border-cyan-400 bg-cyan-400 text-black" : "border-white/10 bg-[#0b2545] text-slate-400 hover:border-cyan-400/40"}`}
                >
                  {filter.label} ({filter.count})
                </button>
              );
            })}
          </div>

          {visiblePendingIds.length > 0 && (
            <div className="mt-3 flex items-center justify-between rounded-xl border border-cyan-400/15 bg-[#0b2545] px-4 py-2.5">
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
                <span className="text-xs font-black text-cyan-300">
                  {selectedIds.length} Selected
                </span>
              )}
            </div>
          )}

          {message && (
            <div className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-xs font-bold text-cyan-200">
              {message}
            </div>
          )}

          {loading ? (
            <div className="mt-4 rounded-2xl border border-cyan-400/15 bg-[#0b2545] p-6 text-sm text-slate-400">
              Loading...
            </div>
          ) : requests.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-cyan-400/15 bg-[#0b2545] p-8 text-center text-sm text-slate-400">
              কোনো Add Money request নেই।
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-[#0b2545] p-8 text-center">
              <div className="text-3xl">🔍</div>
              <p className="mt-3 text-sm font-bold text-slate-300">
                No matching requests found
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                }}
                className="mt-4 rounded-lg bg-cyan-400 px-4 py-2 text-xs font-black text-black"
              >
                Clear Search
              </button>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {filteredRequests.map((request) => {
                const working = workingId === request.id;
                const isPending = request.status === "pending";
                const isSelected = selectedIds.includes(request.id);

                return (
                  <article
                    key={request.id}
                    className={`overflow-hidden rounded-2xl border transition ${isSelected ? "border-cyan-400/60 bg-[#0c2a4f]" : "border-cyan-400/15 bg-[#0b2545]"}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
                      <div>
                        <div className="flex items-center gap-2">
                          {isPending && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectRequest(request.id)}
                              className="h-4 w-4 cursor-pointer rounded accent-cyan-400"
                            />
                          )}
                          <div className="font-black">
                            {request.customer.fullName}
                          </div>
                        </div>
                        <div className="mt-1 break-all text-xs text-slate-400">
                          {request.customer.email || "No email"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Phone: {request.customer.phone || "No phone"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatDate(request.createdAt)}
                        </div>
                      </div>
                      <div className="text-right">
                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase ${statusClass(request.status)}`}
                        >
                          {request.status}
                        </span>
                        <div className="mt-2 text-2xl font-black text-cyan-400">
                          ৳{request.amount.toLocaleString("en-BD")}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 p-5 sm:grid-cols-2">
                      <div className="rounded-xl bg-[#07182f] p-4">
                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                          Payment
                        </div>
                        <div className="mt-1 font-black uppercase">
                          {request.paymentMethod}
                        </div>
                        <div className="mt-2 text-xs text-slate-400">
                          Receiver: {request.receiverNumber}
                        </div>
                      </div>
                      <div className="min-w-0 rounded-xl bg-[#07182f] p-4">
                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                          Transaction ID
                        </div>
                        <div className="mt-1 break-all font-bold">
                          {request.transactionId}
                        </div>
                      </div>
                      <div className="rounded-xl bg-[#07182f] p-4">
                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                          Current Wallet
                        </div>
                        <div className="mt-1 text-lg font-black">
                          ৳
                          {request.customer.walletBalance.toLocaleString(
                            "en-BD",
                          )}
                        </div>
                      </div>
                      <div className="min-w-0 rounded-xl bg-[#07182f] p-4">
                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                          Request ID
                        </div>
                        <div className="mt-1 break-all font-mono text-xs text-slate-400">
                          {request.id}
                        </div>
                      </div>
                      <div className="min-w-0 rounded-xl bg-[#07182f] p-4 sm:col-span-2">
                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                          User ID
                        </div>
                        <div className="mt-1 break-all font-mono text-xs text-slate-400">
                          {request.userId}
                        </div>
                      </div>
                    </div>

                    {request.status === "pending" ? (
                      <div className="border-t border-white/10 p-5">
                        <label className="block">
                          <span className="text-xs font-black text-slate-400">
                            Admin Note (optional)
                          </span>
                          <input
                            type="text"
                            value={noteById[request.id] || ""}
                            onChange={(e) =>
                              setNoteById((current) => ({
                                ...current,
                                [request.id]: e.target.value,
                              }))
                            }
                            placeholder="Optional note"
                            className="mt-2 w-full rounded-xl border border-white/10 bg-[#07182f] px-4 py-3 text-sm outline-none focus:border-cyan-400"
                          />
                        </label>
                        <div className="mt-4 grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            disabled={working}
                            onClick={() =>
                              reviewRequest(request.id, "approved")
                            }
                            className="rounded-xl bg-green-400 px-4 py-3 text-sm font-black text-[#06172e] disabled:opacity-50"
                          >
                            {working ? "Working..." : "Approve"}
                          </button>
                          <button
                            type="button"
                            disabled={working}
                            onClick={() =>
                              reviewRequest(request.id, "rejected")
                            }
                            className="rounded-xl bg-red-500 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
                          >
                            {working ? "Working..." : "Reject"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="border-t border-white/10 p-5">
                        {request.adminNote && (
                          <div className="mb-4 rounded-xl bg-[#07182f] p-3">
                            <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                              Admin Note
                            </div>
                            <div className="mt-1 text-xs text-slate-300">
                              {request.adminNote}
                            </div>
                          </div>
                        )}
                        <button
                          type="button"
                          disabled={working}
                          onClick={() => undoRequest(request.id)}
                          className="w-full rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm font-black text-amber-300 transition hover:bg-amber-400/20 disabled:opacity-50"
                        >
                          {working ? "Undoing..." : "↩ Undo"}
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* Floating Bulk Action Bar with high z-index */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-16 left-1/2 z-[99999] flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-cyan-400/40 bg-[#07182f]/95 px-4 py-3 shadow-2xl backdrop-blur-md">
          <span className="whitespace-nowrap text-xs font-black text-cyan-300">
            {selectedIds.length} Selected
          </span>
          <button
            type="button"
            disabled={isBulkLoading}
            onClick={() => handleBulkAction("approved")}
            className="whitespace-nowrap rounded-xl bg-green-400 px-3 py-1.5 text-xs font-black text-[#06172e] transition hover:bg-green-300 disabled:opacity-50"
          >
            {isBulkLoading ? "Processing..." : "Approve Selected"}
          </button>
          <button
            type="button"
            disabled={isBulkLoading}
            onClick={() => {
              setBulkRejectNote("");
              setIsBulkRejectOpen(true);
            }}
            className="whitespace-nowrap rounded-xl bg-red-500 px-3 py-1.5 text-xs font-black text-white transition hover:bg-red-600 disabled:opacity-50"
          >
            Reject Selected
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

      {isBulkRejectOpen && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 p-5">
          <div className="w-full max-w-md rounded-2xl border border-red-400/30 bg-[#0b2545] p-5 shadow-2xl">
            <h2 className="text-xl font-black text-red-400">
              Reject {selectedIds.length} Requests
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              বাতিল করার কারণ লিখুন (Admin Note):
            </p>
            <textarea
              autoFocus
              value={bulkRejectNote}
              onChange={(e) => setBulkRejectNote(e.target.value)}
              placeholder="উদাহরণ: পেমেন্ট ট্রানজেকশন আইডি সঠিক নয়"
              className="mt-3 h-28 w-full resize-none rounded-xl border border-white/10 bg-[#07182f] p-3 text-sm text-white outline-none focus:border-red-400/50"
            />
            <button
              type="button"
              onClick={() => handleBulkAction("rejected")}
              disabled={isBulkLoading || !bulkRejectNote.trim()}
              className="mt-3 w-full rounded-xl bg-red-500 py-3 font-black text-white disabled:opacity-60"
            >
              {isBulkLoading ? "Rejecting..." : "Confirm Reject"}
            </button>
            <button
              type="button"
              disabled={isBulkLoading}
              onClick={() => {
                setIsBulkRejectOpen(false);
                setBulkRejectNote("");
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
