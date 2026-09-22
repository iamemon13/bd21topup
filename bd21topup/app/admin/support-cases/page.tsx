"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import type { SupportCase } from "@/lib/support";

type Result = { support: SupportCase; caseType: "ORD" | "ADD" | "WDR"; operationId: string; createdAt: string };

export default function AdminSupportCasesPage() {
  const [supportId, setSupportId] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setResult(null);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError("প্রথমে admin account দিয়ে লগইন করুন।"); return; }
      const response = await fetch(`/api/admin/support-cases?supportId=${encodeURIComponent(supportId.trim().toUpperCase())}`, {
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
        <h1 className="text-2xl font-black">Support Case খুঁজুন</h1>
        <form onSubmit={lookup} className="space-y-3">
          <label htmlFor="support-id" className="block text-sm">Support ID</label>
          <input id="support-id" value={supportId} onChange={(e) => setSupportId(e.target.value)} maxLength={21} required autoComplete="off" placeholder="BD21-ORD-8A4B7C2D9E1F" className="w-full rounded-xl border border-cyan-400/30 bg-[#0b2545] p-3 font-mono" />
          <button disabled={loading} className="rounded-xl bg-cyan-400 px-4 py-3 font-bold text-black disabled:opacity-50">{loading ? "খোঁজা হচ্ছে…" : "Case দেখুন"}</button>
        </form>
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
