"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { paymentConfig } from "@/lib/payment-config";

type MethodId = "bkash" | "nagad" | "rocket" | "upay";

type AddMoneyRequest = {
  id: string;
  amount: number | string;
  payment_method: MethodId;
  receiver_number: string;
  transaction_id: string;
  status: "pending" | "approved" | "rejected";
  admin_note?: string | null;
  created_at: string;
  reviewed_at?: string | null;
};

const methods: {
  id: MethodId;
  name: string;
  image: string;
}[] = [
  { id: "bkash", name: "bKash", image: "/payment/bkash.png" },
  { id: "nagad", name: "Nagad", image: "/payment/nagad.png" },
  { id: "rocket", name: "Rocket", image: "/payment/rocket.png" },
  { id: "upay", name: "Upay", image: "/payment/upay.png" },
];

function statusClass(status: AddMoneyRequest["status"]) {
  if (status === "approved") {
    return "border-green-400/20 bg-green-400/10 text-green-300";
  }

  if (status === "rejected") {
    return "border-red-400/20 bg-red-400/10 text-red-300";
  }

  return "border-amber-400/20 bg-amber-400/10 text-amber-300";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-BD", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dhaka",
  }).format(new Date(value));
}

export default function AddMoneyPage() {
  const router = useRouter();

  const [selectedMethod, setSelectedMethod] = useState<MethodId>("bkash");
  const [amount, setAmount] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [requests, setRequests] = useState<AddMoneyRequest[]>([]);
  const [message, setMessage] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const selected = useMemo(
    () => methods.find((item) => item.id === selectedMethod)!,
    [selectedMethod],
  );

  const receiverNumber = paymentConfig[selectedMethod].number;

  useEffect(() => {
    loadHistory();
  }, []);

  async function getSessionOrRedirect() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      const next = "/add-money";
      window.localStorage.setItem("bd21_auth_next", next);
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return null;
    }

    return session;
  }

  async function loadHistory() {
    try {
      const session = await getSessionOrRedirect();
      if (!session) return;

      const response = await fetch("/api/add-money", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = await response.json();

      if (response.status === 401) {
        await supabase.auth.signOut();
        router.replace("/login?next=%2Fadd-money");
        return;
      }

      if (!response.ok) {
        setMessage(data.error || "History load করা যায়নি।");
        return;
      }

      setRequests(data.requests || []);
    } catch (error) {
      console.error("ADD MONEY HISTORY ERROR:", error);
      setMessage("Server-এর সাথে connection করা যায়নি।");
    } finally {
      setLoadingHistory(false);
    }
  }

  async function submitRequest() {
    const numericAmount = Number(amount);
    const cleanTrxId = transactionId.trim();

    if (!Number.isFinite(numericAmount) || numericAmount < 10) {
      setMessage("কমপক্ষে ৳10 amount দিন।");
      return;
    }

    if (!cleanTrxId) {
      setMessage("Transaction ID দিন।");
      return;
    }

    setSubmitting(true);
    setMessage("");

    try {
      const session = await getSessionOrRedirect();
      if (!session) return;

      const response = await fetch("/api/add-money", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          amount: numericAmount,
          paymentMethod: selectedMethod,
          transactionId: cleanTrxId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Request submit করা যায়নি।");
        return;
      }

      setAmount("");
      setTransactionId("");
      setMessage("Request submitted ✅ Redirecting...");

      // সফল হলে Transactions পেজের Wallet ট্যাবে রিডাইরেক্ট করে দেবে
      router.push("/transactions?tab=wallet");
    } catch (error) {
      console.error("ADD MONEY SUBMIT ERROR:", error);
      setMessage("Server-এর সাথে connection করা যায়নি।");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(receiverNumber);
      setMessage("Receiver number copied ✅");
    } catch {
      setMessage(`Receiver: ${receiverNumber}`);
    }
  }

  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-[#07182f] text-white">
      <header className="border-b border-cyan-400/15 bg-[#081c36]">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-5">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <Image
              src="/logo/bd21-logo.png"
              alt="BD21 Top Up"
              width={52}
              height={52}
              className="h-11 w-11 shrink-0 rounded-xl object-cover"
            />

            <div>
              <div className="text-lg font-black">
                BD<span className="text-cyan-400">21</span>
              </div>
              <div className="text-[8px] tracking-[3px] text-slate-400">
                TOP UP
              </div>
            </div>
          </Link>

          <Link
            href="/account"
            className="shrink-0 rounded-xl border border-cyan-400/20 px-3 py-2 text-xs font-bold sm:px-4 sm:text-sm"
          >
            ← My Account
          </Link>
        </div>
      </header>

      <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-5">
        <div className="mb-6">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">
            Wallet
          </p>
          <h1 className="mt-1 text-3xl font-black">Add Money</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Payment send করে Transaction ID submit করুন। Admin approve করার পর
            wallet balance বাড়বে।
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <div className="space-y-5">
            <div className="rounded-2xl border border-cyan-400/15 bg-[#0b2545] p-5">
              <h2 className="text-lg font-black">1. Select Payment Method</h2>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {methods.map((method) => {
                  const active = selectedMethod === method.id;

                  return (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => {
                        setSelectedMethod(method.id);
                        setMessage("");
                      }}
                      className={`flex min-h-[80px] items-center justify-center rounded-xl bg-white p-3 shadow-sm transition hover:-translate-y-0.5 ${
                        active
                          ? "border-[3px] border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.5)]"
                          : "border border-cyan-400/15 hover:border-cyan-400"
                      }`}
                    >
                      <Image
                        src={method.image}
                        alt={method.name}
                        width={180}
                        height={60}
                        className="max-h-[52px] w-auto object-contain"
                        style={{ width: "auto", height: "auto" }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-cyan-400/15 bg-[#0b2545] p-5">
              <h2 className="text-lg font-black">2. Send Money</h2>

              <div className="mt-4 rounded-2xl border border-cyan-400/15 bg-[#07182f] p-4">
                <div className="text-xs font-bold text-slate-400">
                  Send Money to {selected.name}
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xl font-black text-cyan-400">
                    {receiverNumber}
                  </div>

                  <button
                    type="button"
                    onClick={copyNumber}
                    className="rounded-xl bg-cyan-400 px-4 py-2 text-xs font-black text-[#06172e]"
                  >
                    Copy Number
                  </button>
                </div>
              </div>

              <label className="mt-4 block">
                <span className="text-xs font-black text-slate-300">
                  Amount
                </span>
                <input
                  type="number"
                  min="10"
                  max="100000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Example: 500"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#07182f] px-4 py-4 text-sm outline-none placeholder:text-slate-600 focus:border-cyan-400"
                />
              </label>

              <label className="mt-4 block">
                <span className="text-xs font-black text-slate-300">
                  Transaction ID
                </span>
                <input
                  type="text"
                  value={transactionId}
                  onChange={(e) => setTransactionId(e.target.value)}
                  placeholder="Payment Transaction ID"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#07182f] px-4 py-4 text-sm outline-none placeholder:text-slate-600 focus:border-cyan-400"
                />
              </label>

              {message && (
                <div className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-xs font-bold text-cyan-200">
                  {message}
                </div>
              )}

              <button
                type="button"
                onClick={submitRequest}
                disabled={submitting}
                className="mt-5 w-full rounded-xl bg-cyan-400 px-5 py-4 font-black text-[#06172e] transition hover:bg-cyan-300 disabled:opacity-50"
              >
                {submitting ? "Submitting..." : "Submit Add Money Request"}
              </button>

              <p className="mt-3 text-[11px] leading-5 text-slate-500">
                এই stage-এ payment automatically verify হচ্ছে না। Admin payment
                claim review করে approve/reject করবে।
              </p>
            </div>
          </div>

          <div>
            <div className="rounded-2xl border border-cyan-400/15 bg-[#0b2545] p-5">
              <h2 className="text-lg font-black">Recent Requests</h2>

              {loadingHistory ? (
                <div className="mt-4 text-sm text-slate-400">Loading...</div>
              ) : requests.length === 0 ? (
                <div className="mt-4 rounded-xl bg-[#07182f] p-4 text-sm text-slate-400">
                  কোনো Add Money request নেই।
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {requests.slice(0, 8).map((request) => (
                    <div
                      key={request.id}
                      className="rounded-xl border border-white/10 bg-[#07182f] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-lg font-black text-white">
                            ৳{Number(request.amount).toLocaleString("en-BD")}
                          </div>
                          <div className="mt-1 text-xs capitalize text-slate-400">
                            {request.payment_method}
                          </div>
                        </div>

                        <span
                          className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase ${statusClass(
                            request.status,
                          )}`}
                        >
                          {request.status}
                        </span>
                      </div>

                      <div className="mt-3 break-all text-xs text-slate-400">
                        TrxID: {request.transaction_id}
                      </div>

                      <div className="mt-2 text-[10px] text-slate-500">
                        {formatDate(request.created_at)}
                      </div>

                      {request.admin_note && (
                        <div className="mt-3 rounded-lg bg-white/[0.04] px-3 py-2 text-xs text-slate-300">
                          Note: {request.admin_note}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
