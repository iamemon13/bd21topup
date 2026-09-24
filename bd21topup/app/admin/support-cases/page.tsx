"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { SupportCase } from "@/lib/support";

type Result = { support: SupportCase; caseType: "ORD" | "ADD" | "WDR"; operationId: string; createdAt: string };

type SupportListItem = Result & {
  currentStatus: string;
  customer: { fullName: string; email: string };
  amount: number | null;
  packageName: string | null;
  method: string | null;
};

export default function AdminSupportCasesPage() {
  const [supportId, setSupportId] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [cases, setCases] = useState<SupportListItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
  }, []);

  async function lookup(supportIdToLoad: string) {
    setLoading(true);
    setResult(null);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError("প্রথমে admin account দিয়ে লগইন করুন।"); return; }
      const response = await fetch(`/api/admin/support-cases?supportId=${encodeURIComponent(supportIdToLoad.trim().toUpperCase())}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Case পাওয়া যায়নি।"); return; }
      setResult(data);
    } catch { setError("Case লোড করা যায়নি। আবার চেষ্টা করুন।"); }
    finally { setLoading(false); }
  }

  return (
    <main className="min-h-screen bg-[#07182f] px-4 py-8 text-white">
      <div className="mx-auto max-w-xl space-y-5">
        <Link href="/admin" className="text-sm text-cyan-300">← Admin Dashboard</Link>
        <h1 className="text-2xl font-black">Support Cases</h1>
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
                    <span className="rounded-full border border-red-400/25 bg-red-400/10 px-2 py-1 text-[10px] font-black uppercase text-red-300">
                      {item.currentStatus}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
                    <p className="break-words">Customer: {item.customer.fullName}{item.customer.email ? ` (${item.customer.email})` : ""}</p>
                    {item.packageName && <p className="break-words">Package: {item.packageName}</p>}
                    {item.amount !== null && <p>Amount: ৳{item.amount.toLocaleString("en-BD")}</p>}
                    {item.method && <p>Method: {item.method}</p>}
                    <p className="break-words sm:col-span-2">Reason: {item.support.reason}</p>
                    <p>Date: {new Intl.DateTimeFormat("en-BD", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" }).format(new Date(item.createdAt))}</p>
                  </div>
                  <button type="button" onClick={() => { setSupportId(item.support.supportId); void lookup(item.support.supportId); }} className="mt-4 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-black text-black">
                    Case দেখুন
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="space-y-3 rounded-xl border border-cyan-400/20 bg-[#0b2545] p-4">
          <h2 className="text-lg font-black">Support Case খুঁজুন</h2>
        <form onSubmit={(event) => { event.preventDefault(); void lookup(supportId); }} className="space-y-3">
          <label htmlFor="support-id" className="block text-sm">Support ID</label>
          <input id="support-id" value={supportId} onChange={(e) => setSupportId(e.target.value)} maxLength={21} required autoComplete="off" placeholder="BD21-ORD-8A4B7C2D9E1F" className="w-full rounded-xl border border-cyan-400/30 bg-[#0b2545] p-3 font-mono" />
          <button disabled={loading} className="rounded-xl bg-cyan-400 px-4 py-3 font-bold text-black disabled:opacity-50">{loading ? "খোঁজা হচ্ছে…" : "Case দেখুন"}</button>
        </form>
        </section>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        {result && <section aria-label="Support Case" className="space-y-3 rounded-xl border border-cyan-400/25 p-4 text-sm">
          <h2 className="break-all font-mono font-bold text-cyan-300">{result.support.supportId}</h2>
          <p>অবস্থা: {result.support.status}</p>
          <p className="break-words">কারণ: {result.support.reason}</p>
          <p className="break-all">সংশ্লিষ্ট record: {result.operationId}</p>
          <Link className="inline-block text-cyan-300 underline" href={{ ORD: "/admin/orders", ADD: "/admin/add-money", WDR: "/admin/withdrawals" }[result.caseType]}>সংশ্লিষ্ট admin তালিকা খুলুন</Link>
          <p>ব্যবহারকারীর কাছে রসিদ বা স্ক্রিনশট চান এবং যাচাইকৃত account-এর সঙ্গে তথ্য মিলিয়ে দেখুন। শুধু Support ID বা Telegram পরিচয় ownership-এর প্রমাণ নয়।</p>
          <p className="text-slate-400">এখান থেকে refund, approval বা wallet পরিবর্তন করা যায় না।</p>
        </section>}
      </div>
    </main>
  );
}
