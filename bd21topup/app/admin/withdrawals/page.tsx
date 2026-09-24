"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

type Withdrawal = {
  id: string;
  userId: string;
  amount: number;
  method: string;
  accountNumber: string;
  status: string;
  createdAt: string;
  customer?: {
    fullName: string;
    walletBalance: number;
  };
};

export default function AdminWithdrawalsPage() {
  const router = useRouter();
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadWithdrawals = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login");
        return;
      }

      const response = await fetch("/api/admin/withdrawals", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        cache: "no-store",
      });

      // 🔒 SECURITY FIX: Unauthorized user (Editor/User) কে Home Page-এ রিডাইরেক্ট করা
      if (response.status === 403) {
        router.replace("/");
        return;
      }

      if (response.status === 401) {
        router.replace("/login");
        return;
      }

      const result = await response.json();

      if (!response.ok || !result.success) {
        setMessage(result.error || "উইথড্র রিকোয়েস্ট লোড করা যায়নি।");
        return;
      }

      setWithdrawals(result.withdrawals || []);
      setMessage("");
    } catch (err) {
      console.error(err);
      setMessage("সার্ভারে সমস্যা হয়েছে।");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadWithdrawals();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadWithdrawals]);

  const stats = useMemo(() => {
    const total = withdrawals.length;
    const pending = withdrawals.filter(
      (w) => w.status.toLowerCase() === "pending",
    ).length;
    const approved = withdrawals.filter(
      (w) => w.status.toLowerCase() === "approved",
    ).length;
    const rejected = withdrawals.filter(
      (w) => w.status.toLowerCase() === "rejected",
    ).length;
    return { total, pending, approved, rejected };
  }, [withdrawals]);

  const filteredWithdrawals = useMemo(() => {
    return withdrawals.filter((item) => {
      const matchesFilter =
        activeFilter === "all" || item.status.toLowerCase() === activeFilter;
      const searchText = search.trim().toLowerCase();
      if (!matchesFilter) return false;
      if (!searchText) return true;

      const searchable = [
        item.amount.toString(),
        item.method,
        item.accountNumber,
        item.status,
        item.customer?.fullName || "",
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(searchText);
    });
  }, [withdrawals, activeFilter, search]);

  const pendingIds = useMemo(() => {
    return filteredWithdrawals
      .filter((item) => item.status.toLowerCase() === "pending")
      .map((item) => item.id);
  }, [filteredWithdrawals]);

  function handleSelectAll(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.checked) {
      setSelectedIds(pendingIds);
    } else {
      setSelectedIds([]);
    }
  }

  function handleToggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  }

  async function updateStatus(ids: string[], newStatus: string) {
    if (ids.length === 0) return;

    let reason = "";
    if (newStatus.toLowerCase() === "rejected") {
      const userInput = window.prompt("রিজেক্ট করার কারণ (Reason) লিখুন:");
      if (!userInput || userInput.trim() === "") {
        alert("রিজেক্ট করার কারণ (Reason) দেওয়া বাধ্যতামূলক!");
        return;
      }
      reason = userInput.trim();
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }

      for (const id of ids) {
        const response = await fetch("/api/admin/withdrawals", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            withdrawalId: id,
            status: newStatus.toLowerCase(),
            reason: reason,
          }),
        });

        if (response.status === 403) {
          alert("Access Denied");
          router.replace("/");
          return;
        }

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Status update failed");
        }
      }

      setSelectedIds([]);
      setMessage(
        `সফলভাবে ${ids.length}টি রিকোয়েস্ট ${newStatus} করা হয়েছে ✅`,
      );
      setTimeout(() => setMessage(""), 3000);
      loadWithdrawals();
    } catch (err: unknown) {
      console.error(err);
      alert(
        "সার্ভারে সমস্যা হয়েছে: " +
          (err instanceof Error ? err.message : ""),
      );
    }
  }

  async function copyText(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (err) {
      console.error("Copy failed", err);
    }
  }

  return (
    <main className="min-h-screen bg-[#061b35] p-4 pb-24 text-white sm:p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between rounded-2xl border border-cyan-500/30 bg-[#0b294d] p-4">
          <div>
            <h1 className="text-xl font-black text-cyan-400">
              Withdrawal Requests
            </h1>
            <p className="text-xs text-slate-300">
              ইউজারদের সকল উইথড্র রিকোয়েস্ট ম্যানেজ করুন
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/admin"
              className="rounded-xl border border-cyan-400/20 bg-[#07182f] px-3 py-2 text-xs font-bold text-cyan-300 transition hover:border-cyan-400"
            >
              Home
            </Link>
            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                router.replace("/login");
              }}
              className="rounded-xl bg-cyan-400 px-3 py-2 text-xs font-black text-[#06172e]"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Search & Refresh */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
              🔍
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search account, method, amount..."
              className="h-11 w-full rounded-xl border border-cyan-400/20 bg-[#0b294d] pl-10 pr-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
            />
          </div>
          <button
            type="button"
            onClick={loadWithdrawals}
            className="rounded-xl border border-cyan-400/20 bg-[#0b294d] px-4 text-xs font-black text-cyan-300 transition hover:border-cyan-400"
          >
            Refresh
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-2xl border border-cyan-500/20 bg-[#0b294d] p-3 text-center">
            <p className="text-[10px] font-black uppercase text-slate-400">
              Total
            </p>
            <p className="mt-1 text-2xl font-black text-cyan-400">
              {stats.total}
            </p>
          </div>
          <div className="rounded-2xl border border-yellow-500/20 bg-[#0b294d] p-3 text-center">
            <p className="text-[10px] font-black uppercase text-slate-400">
              Pending
            </p>
            <p className="mt-1 text-2xl font-black text-yellow-300">
              {stats.pending}
            </p>
          </div>
          <div className="rounded-2xl border border-green-500/20 bg-[#0b294d] p-3 text-center">
            <p className="text-[10px] font-black uppercase text-slate-400">
              Approved
            </p>
            <p className="mt-1 text-2xl font-black text-green-300">
              {stats.approved}
            </p>
          </div>
          <div className="rounded-2xl border border-red-500/20 bg-[#0b294d] p-3 text-center">
            <p className="text-[10px] font-black uppercase text-slate-400">
              Rejected
            </p>
            <p className="mt-1 text-2xl font-black text-red-300">
              {stats.rejected}
            </p>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { id: "all", label: `All (${stats.total})` },
            { id: "pending", label: `Pending (${stats.pending})` },
            { id: "approved", label: `Approved (${stats.approved})` },
            { id: "rejected", label: `Rejected (${stats.rejected})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id)}
              className={`rounded-xl border py-2 text-xs font-black transition ${activeFilter === tab.id ? "border-cyan-400 bg-cyan-400 text-black" : "border-cyan-400/20 bg-[#0b294d] text-slate-300"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {pendingIds.length > 0 && (
          <div className="flex items-center justify-between rounded-xl border border-cyan-500/20 bg-[#0b294d] px-4 py-3">
            <label className="flex items-center gap-2 text-xs font-bold text-cyan-300 cursor-pointer">
              <input
                type="checkbox"
                checked={
                  selectedIds.length > 0 &&
                  selectedIds.length === pendingIds.length
                }
                onChange={handleSelectAll}
                className="h-4 w-4 rounded accent-cyan-400"
              />
              Select All Pending ({pendingIds.length})
            </label>
            {selectedIds.length > 0 && (
              <span className="text-xs font-black text-cyan-300">
                {selectedIds.length} Selected
              </span>
            )}
          </div>
        )}

        {message && (
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-xs font-bold text-cyan-200">
            {message}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-cyan-500/20 bg-[#0b294d] p-8 text-center text-slate-400">
            Loading...
          </div>
        ) : filteredWithdrawals.length === 0 ? (
          <div className="rounded-2xl border border-cyan-500/20 bg-[#0b294d] p-8 text-center text-slate-400">
            কোনো উইথড্র রিকোয়েস্ট পাওয়া যায়নি।
          </div>
        ) : (
          <div className="space-y-3">
            {filteredWithdrawals.map((item) => {
              const isPending = item.status.toLowerCase() === "pending";
              const isSelected = selectedIds.includes(item.id);

              return (
                <div
                  key={item.id}
                  className={`flex flex-col gap-3 rounded-2xl border bg-[#0b294d] p-4 sm:flex-row sm:items-center sm:justify-between ${isSelected ? "border-cyan-400 bg-cyan-400/5" : "border-cyan-500/20"}`}
                >
                  <div className="flex items-start gap-3">
                    {isPending && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelect(item.id)}
                        className="mt-1 h-4 w-4 rounded accent-cyan-400 cursor-pointer"
                      />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-black text-cyan-400">
                          ৳{item.amount}
                        </span>
                        <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-[10px] font-bold text-cyan-300 uppercase">
                          {item.method}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${item.status.toLowerCase() === "approved" ? "bg-green-400/10 text-green-300" : item.status.toLowerCase() === "rejected" ? "bg-red-400/10 text-red-300" : "bg-amber-400/10 text-amber-300"}`}
                        >
                          {item.status}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-col gap-1 text-xs text-slate-300">
                        {item.customer && (
                          <div className="font-bold text-cyan-200">
                            {item.customer.fullName}
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <span>
                            Account:{" "}
                            <strong className="text-white">
                              {item.accountNumber}
                            </strong>
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              copyText(item.accountNumber, item.id)
                            }
                            className="rounded-md bg-cyan-400/20 px-2 py-0.5 text-[10px] font-bold text-cyan-300 hover:bg-cyan-400/30"
                          >
                            {copiedId === item.id ? "Copied! ✓" : "Copy"}
                          </button>
                        </div>
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500">
                        Time: {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  {isPending && (
                    <div className="flex items-center gap-2 sm:self-center">
                      <button
                        type="button"
                        onClick={() => updateStatus([item.id], "Approved")}
                        className="rounded-xl bg-green-500 px-3 py-2 text-xs font-black text-black transition hover:bg-green-400"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => updateStatus([item.id], "Rejected")}
                        className="rounded-xl bg-red-500 px-3 py-2 text-xs font-black text-white transition hover:bg-red-400"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Bulk Action Bar */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-16 left-1/2 z-[99999] flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-cyan-400/40 bg-[#07182f]/95 px-4 py-3 shadow-2xl backdrop-blur-md">
          <span className="whitespace-nowrap text-xs font-black text-cyan-300">
            {selectedIds.length} Selected
          </span>
          <button
            type="button"
            onClick={() => updateStatus(selectedIds, "Approved")}
            className="whitespace-nowrap rounded-xl bg-green-400 px-3 py-1.5 text-xs font-black text-black transition hover:bg-green-300"
          >
            Approve Selected
          </button>
          <button
            type="button"
            onClick={() => updateStatus(selectedIds, "Rejected")}
            className="whitespace-nowrap rounded-xl bg-red-500 px-3 py-1.5 text-xs font-black text-white transition hover:bg-red-600"
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
    </main>
  );
}
