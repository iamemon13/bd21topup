"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { SupportCase } from "@/lib/support";
import AdminPageHeader, { adminPrimaryActionClass } from "@/components/AdminPageHeader";
import AdminSearchInput from "@/components/AdminSearchInput";

type Result = {
  support: SupportCase;
  caseType: "ORD" | "ADD" | "WDR";
  operationId: string;
  createdAt: string;
  updatedAt: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedBy: { fullName: string | null; email: string | null } | null;
};

type SupportListItem = Result & {
  currentStatus: string;
  customer: { fullName: string; email: string };
  amount: number | null;
  packageName: string | null;
  method: string | null;
};

export default function AdminSupportCasesPage() {
  const router = useRouter();
  const [supportId, setSupportId] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [cases, setCases] = useState<SupportListItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [resolutionNote, setResolutionNote] = useState("");
  const [resolutionError, setResolutionError] = useState("");
  const [resolving, setResolving] = useState(false);
  const detailRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    async function loadCases() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const response = await fetch("/api/admin/support-cases", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        const data = await response.json();
        if (response.ok) setCases(data.cases || []);
      } catch {
        // The existing lookup remains available if the list cannot load.
      }
    }
    void loadCases();
  }, [refreshToken]);

  useEffect(() => {
    if (!result) return;
    const frame = window.requestAnimationFrame(() => {
      detailRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [result]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function refreshSupportCases() {
    setRefreshToken((value) => value + 1);
    if (result) await lookup(result.support.supportId);
  }

  async function lookup(supportIdToLoad: string) {
    const normalizedSupportId = supportIdToLoad.trim().toUpperCase();
    if (!normalizedSupportId) {
      setResult(null);
      setError("Support ID দিন।");
      return;
    }
    setLoading(true);
    setResult(null);
    setError("");
    setResolutionError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError("প্রথমে admin account দিয়ে লগইন করুন।"); return; }
      const response = await fetch(`/api/admin/support-cases?supportId=${encodeURIComponent(normalizedSupportId)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Case পাওয়া যায়নি।"); return; }
      setResult(data);
    } catch { setError("Case লোড করা যায়নি। আবার চেষ্টা করুন।"); }
    finally { setLoading(false); }
  }

  async function resolveCase() {
    if (!result) return;
    const selectedSupportId = result.support.supportId;
    const trimmedNote = resolutionNote.trim();
    setResolutionError("");
    if (!trimmedNote) {
      setResolutionError("Resolution Note আবশ্যক।");
      return;
    }
    if (!window.confirm("এই Support Case-কে Resolved হিসেবে চিহ্নিত করবেন?")) return;

    setResolving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setResolutionError("প্রথমে admin account দিয়ে লগইন করুন।");
        return;
      }
      const response = await fetch("/api/admin/support-cases", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ supportId: selectedSupportId, resolutionNote: trimmedNote }),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) {
        setResolutionError(data.error || "Support Case resolve করা যায়নি।");
        return;
      }
      setResolutionNote("");
      await lookup(selectedSupportId);
    } catch {
      setResolutionError("Support Case resolve করা যায়নি। আবার চেষ্টা করুন।");
    } finally {
      setResolving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#07182f] px-4 pb-24 pt-8 text-white sm:pb-8">
      <div className="mx-auto max-w-xl space-y-5">
        <AdminPageHeader
          title="Support Cases"
          subtitle="Search, review, and resolve support workflow records."
          onRefresh={refreshSupportCases}
          refreshDisabled={loading || resolving}
          onLogout={logout}
        />
        <section className="space-y-3 rounded-xl border border-cyan-400/20 bg-[#0b2545] p-4">
          <h2 className="text-lg font-black">Support Case খুঁজুন</h2>
          <form onSubmit={(event) => { event.preventDefault(); void lookup(supportId); }} className="space-y-3">
            <label htmlFor="support-id" className="block text-sm">Support ID</label>
            <AdminSearchInput
              value={supportId}
              onChange={setSupportId}
              maxLength={21}
              type="text"
              placeholder="BD21-ORD-8A4B7C2D9E1F"
              ariaLabel="Support ID"
            />
            <button type="submit" disabled={loading} className={`${adminPrimaryActionClass} w-full disabled:opacity-50`}>
              {loading ? "খোঁজা হচ্ছে…" : "Case দেখুন"}
            </button>
          </form>
        </section>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        {result && <section ref={detailRef} tabIndex={-1} aria-label="Support Case" className="scroll-mt-4 space-y-3 rounded-xl border border-cyan-400/25 p-4 text-sm outline-none">
          <h2 className="break-all font-mono font-bold text-cyan-300">{result.support.supportId}</h2>
          <p>অবস্থা: {result.support.status}</p>
          <p className="break-words">কারণ: {result.support.reason}</p>
          <p className="break-all">সংশ্লিষ্ট record: {result.operationId}</p>
          {result.support.status === "resolved" && (
            <div className="space-y-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 p-3 text-emerald-100">
              <p className="font-bold text-emerald-300">✓ Resolved</p>
              <p className="break-words">Resolution: {result.resolutionNote}</p>
              <p className="break-words">Resolved by: {result.resolvedBy?.fullName || result.resolvedBy?.email || "Admin identity unavailable"}</p>
              {result.resolvedAt && <p>Resolved at: {new Intl.DateTimeFormat("en-BD", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" }).format(new Date(result.resolvedAt))}</p>}
            </div>
          )}
          {result.support.status === "open" && (
            <div className="space-y-3 rounded-lg border border-amber-400/25 bg-amber-400/5 p-3">
              <label htmlFor="resolution-note" className="block font-bold text-amber-200">Resolution Note</label>
              <textarea id="resolution-note" value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} maxLength={500} rows={3} className="w-full min-w-0 resize-y rounded-lg border border-amber-400/30 bg-[#0b2545] p-3 text-white" placeholder="কীভাবে Support Case-টি handled হয়েছে লিখুন" />
              <button type="button" onClick={() => void resolveCase()} disabled={resolving} className="w-full rounded-lg bg-amber-300 px-3 py-2 font-black text-black disabled:opacity-50 sm:w-auto">
                {resolving ? "Resolve করা হচ্ছে…" : "Mark as Resolved"}
              </button>
              {resolutionError && <p role="alert" className="break-words text-sm text-red-300">{resolutionError}</p>}
            </div>
          )}
          <Link className="inline-block max-w-full break-words text-cyan-300 underline" href={{ ORD: "/admin/orders", ADD: "/admin/add-money", WDR: "/admin/withdrawals" }[result.caseType]}>সংশ্লিষ্ট admin তালিকা খুলুন</Link>
          <p>ব্যবহারকারীর কাছে রসিদ বা স্ক্রিনশট চান এবং যাচাইকৃত account-এর সঙ্গে তথ্য মিলিয়ে দেখুন। শুধু Support ID বা Telegram পরিচয় ownership-এর প্রমাণ নয়।</p>
          <p className="text-slate-400">এখান থেকে refund, approval বা wallet পরিবর্তন করা যায় না।</p>
        </section>}
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">Recent Cases</h2>
              <p className="text-xs text-slate-400">আপনার permission অনুযায়ী সর্বশেষ support cases</p>
            </div>
            <span className="shrink-0 text-xs text-slate-500">{cases.length} cases</span>
          </div>
          {cases.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-[#0b2545] p-5 text-sm text-slate-400">
              কোনো support case পাওয়া যায়নি।
            </div>
          ) : (
            <div className="space-y-3">
              {cases.map((item) => (
                <article key={item.support.supportId} className="min-w-0 rounded-xl border border-cyan-400/20 bg-[#0b2545] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-cyan-300">
                        {item.caseType === "ORD" ? "Cancelled Order" : item.caseType === "WDR" ? "Rejected Withdrawal" : "Rejected Add Money"}
                      </p>
                      <p className="mt-1 break-all font-mono text-sm text-white">{item.support.supportId}</p>
                    </div>
                    <div className="flex max-w-full flex-wrap justify-end gap-2 text-[10px] font-black uppercase">
                      <span className="rounded-full border border-red-400/25 bg-red-400/10 px-2 py-1 text-red-300">{item.currentStatus}</span>
                      <span className={`rounded-full border px-2 py-1 ${item.support.status === "resolved" ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : "border-amber-400/25 bg-amber-400/10 text-amber-300"}`}>
                        {item.support.status}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
                    <p className="break-words">Customer: {item.customer.fullName}{item.customer.email ? ` (${item.customer.email})` : ""}</p>
                    {item.packageName && <p className="break-words">Package: {item.packageName}</p>}
                    {item.amount !== null && <p>Amount: ৳{item.amount.toLocaleString("en-BD")}</p>}
                    {item.method && <p>Method: {item.method}</p>}
                    <p className="break-words sm:col-span-2">Reason: {item.support.reason}</p>
                    <p>Date: {new Intl.DateTimeFormat("en-BD", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" }).format(new Date(item.createdAt))}</p>
                  </div>
                  <button type="button" onClick={() => { setSupportId(item.support.supportId); void lookup(item.support.supportId); }} className="mt-4 w-full rounded-lg bg-cyan-400 px-3 py-2 text-xs font-black text-black sm:w-auto">
                    Case দেখুন
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
