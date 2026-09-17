"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

type Withdrawal = {
  id: string;
  user_id: string;
  amount: number;
  method: string;
  account_number: string;
  status: string;
  created_at: string;
};

export default function AdminWithdrawalsPage() {
  const router = useRouter();
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadWithdrawals() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }

      // সুপাবেস থেকে সব উইথড্র রিকোয়েস্ট ফেচ করা
      const { data, error } = await supabase
        .from("withdrawals")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        setMessage("উইথড্র রিকোয়েস্ট লোড করা যায়নি।");
        return;
      }

      setWithdrawals(data || []);
    } catch (err) {
      console.error(err);
      setMessage("সার্ভারে সমস্যা হয়েছে।");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWithdrawals();
  }, []);

  async function updateStatus(id: string, newStatus: string) {
    try {
      const { error } = await supabase
        .from("withdrawals")
        .update({ status: newStatus })
        .eq("id", id);

      if (error) {
        alert("স্ট্যাটাস আপডেট করা যায়নি।");
        return;
      }

      // সফল হলে লোকাল স্টেট আপডেট করা
      setWithdrawals((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status: newStatus } : item))
      );
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <main className="min-h-screen bg-[#07182f] p-4 text-white sm:p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black">Withdrawal Requests</h1>
            <p className="text-xs text-slate-400">ইউজারদের সকল উইথড্র রিকোয়েস্ট ম্যানেজ করুন</p>
          </div>
          <Link
            href="/admin"
            className="rounded-xl border border-cyan-400/20 bg-[#0b2545] px-4 py-2 text-xs font-black text-cyan-300"
          >
            ← Admin Dashboard
          </Link>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-6 text-center">
            Loading...
          </div>
        ) : message ? (
          <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-6 text-red-300">
            {message}
          </div>
        ) : withdrawals.length === 0 ? (
          <div className="rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-8 text-center text-slate-400">
            কোনো উইথড্র রিকোয়েস্ট নেই।
          </div>
        ) : (
          <div className="space-y-3">
            {withdrawals.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-4 rounded-2xl border border-cyan-400/15 bg-[#0b2545] p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-black text-cyan-400">৳{item.amount}</span>
                    <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-[10px] font-bold text-cyan-300 uppercase">
                      {item.method}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                        item.status.toLowerCase() === "approved"
                          ? "bg-green-400/10 text-green-300"
                          : item.status.toLowerCase() === "rejected"
                          ? "bg-red-400/10 text-red-300"
                          : "bg-amber-400/10 text-amber-300"
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-300">
                    Account: <strong className="text-white">{item.account_number}</strong>
                  </p>
                  <p className="text-[10px] text-slate-500">
                    Time: {new Date(item.created_at).toLocaleString()}
                  </p>
                </div>

                {item.status.toLowerCase() === "pending" && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateStatus(item.id, "Approved")}
                      className="rounded-xl bg-green-500 px-3 py-2 text-xs font-black text-black transition hover:bg-green-400"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => updateStatus(item.id, "Rejected")}
                      className="rounded-xl bg-red-500 px-3 py-2 text-xs font-black text-white transition hover:bg-red-400"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
