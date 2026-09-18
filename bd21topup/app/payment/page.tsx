"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { paymentConfig } from "@/lib/payment-config";
import { supabase } from "@/lib/supabase";

type PaymentMethod = {
  id: "bkash" | "nagad" | "rocket" | "upay";
  name: string;
  banglaName: string;
  logo: string;
  ussd: string;
  accent: string;
  verifyColor: string;
};

const paymentMethods: PaymentMethod[] = [
  {
    id: "bkash",
    name: "bKash",
    banglaName: "বিকা বিকাশ",
    logo: "/payment/bkash.png",
    ussd: "*247#",
    accent: "#d82370",
    verifyColor: "#c80024",
  },
  {
    id: "nagad",
    name: "Nagad",
    banglaName: "নগদ",
    logo: "/payment/nagad.png",
    ussd: "*167#",
    accent: "#ef3b28",
    verifyColor: "#d62b18",
  },
  {
    id: "rocket",
    name: "Rocket",
    banglaName: "রকেট",
    logo: "/payment/rocket.png",
    ussd: "*322#",
    accent: "#8b2a91",
    verifyColor: "#711b77",
  },
  {
    id: "upay",
    name: "Upay",
    banglaName: "উপায়",
    logo: "/payment/upay.png",
    ussd: "*268#",
    accent: "#1555a3",
    verifyColor: "#0d4385",
  },
];

function PaymentContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const uid = searchParams.get("uid") || "";
  const player = searchParams.get("player") || "";
  const packageName = searchParams.get("package") || "";
  const amount = Number(searchParams.get("amount") || "0");

  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(
    null,
  );
  const [transactionId, setTransactionId] = useState("");
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  const receiverNumber = selectedMethod
    ? paymentConfig[selectedMethod.id].number
    : "";

  const amountText = useMemo(() => {
    if (!Number.isFinite(amount)) return "0";
    return String(Math.round(amount));
  }, [amount]);

  useEffect(() => {
    async function requireLogin() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.replace(`/login?next=${encodeURIComponent(next)}`);
        return;
      }

      setAuthReady(true);
    }

    requireLogin();
  }, []);

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(receiverNumber);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1300);
    } catch {
      setCopied(false);
    }
  }

  async function verifyPayment() {
    if (!selectedMethod) return;

    const trxId = transactionId.trim();

    if (!trxId) {
      setMessage("আগে Transaction ID লিখুন।");
      return;
    }

    setIsSubmitting(true);
    setMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.replace(`/login?next=${encodeURIComponent(next)}`);
        return;
      }

      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          uid,
          playerName: player,
          packageName,
          amount: amount,
          receiverNumber: receiverNumber,
          paymentMethod: selectedMethod.id,
          transactionId: trxId,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Order submit করা যায়নি।");
        setIsSubmitting(false);
        return;
      }

      setMessage("Order submitted successfully! Redirecting...");
      router.push("/orders");
    } catch (error) {
      console.error("ORDER SUBMIT ERROR:", error);
      setMessage("Server-এর সাথে connection করা যায়নি।");
      setIsSubmitting(false);
    }
  }

  if (!authReady) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#07182f] px-4 text-white">
        <div className="rounded-xl border border-cyan-400/20 bg-[#0b2545] px-5 py-4 text-sm font-bold text-slate-300">
          Checking login...
        </div>
      </main>
    );
  }

  if (selectedMethod) {
    return (
      <main
        className="min-h-screen bg-[#07182f] px-3 py-3 text-white sm:py-5"
        style={{ colorScheme: "dark" }}
      >
        <div className="mx-auto w-full max-w-[410px]">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setSelectedMethod(null);
                setTransactionId("");
                setMessage("");
                setIsSubmitting(false);
              }}
              className="rounded-lg border border-cyan-400/20 bg-[#0b2545] px-3 py-1.5 text-xs font-bold text-slate-200 transition hover:border-cyan-400"
            >
              ← Back
            </button>

            <Link
              href="/topup/uid"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-400/20 bg-[#0b2545] text-lg text-slate-300 transition hover:border-cyan-400"
            >
              ×
            </Link>
          </div>

          <div className="flex h-[80px] items-center justify-center rounded-xl border border-cyan-400/20 bg-white px-4 shadow-lg">
            <Image
              src={selectedMethod.logo}
              alt={selectedMethod.name}
              width={200}
              height={70}
              className="max-h-[56px] w-auto object-contain"
              style={{ width: "auto", height: "auto" }}
              priority
            />
          </div>

          <div className="mt-2 flex h-[42px] items-center justify-center rounded-xl border border-cyan-400/15 bg-[#0b2545] text-xl font-black text-cyan-300">
            ৳{amountText}
          </div>

          <section
            className="mt-2 rounded-xl px-4 pb-4 pt-4 text-white shadow-lg sm:px-5"
            style={{ backgroundColor: selectedMethod.accent }}
          >
            <h1 className="text-center text-[15px] font-black">
              ট্রানজেকশন আইডি দিন
            </h1>

            <div className="mt-3 rounded-xl border border-cyan-300/40 bg-[#07182f] p-2.5 shadow-inner">
              <input
                type="text"
                value={transactionId}
                onChange={(e) => {
                  setTransactionId(e.target.value);
                  setMessage("");
                }}
                placeholder="Transaction ID লিখুন"
                className="h-[46px] w-full rounded-lg border border-cyan-300/35 bg-[#07182f] px-3 text-[13px] font-semibold text-white outline-none placeholder:text-slate-400 focus:border-cyan-300"
              />
            </div>

            <div className="mt-4 text-[12px] font-medium leading-[1.6]">
              <InstructionRow>
                *{selectedMethod.ussd} ডায়াল করে {selectedMethod.name} মেনুতে
                যান অথবা {selectedMethod.name} অ্যাপ খুলুন।
              </InstructionRow>

              <InstructionRow>
                Send Money / সেন্ড মানি নির্বাচন করুন।
              </InstructionRow>

              <InstructionRow>
                <div className="flex flex-wrap items-center gap-1">
                  <span>এই নম্বরে টাকা পাঠান:</span>
                  <span className="font-black text-yellow-200">
                    {receiverNumber}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={copyNumber}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-black/20 px-3 py-1.5 text-[11px] font-black text-white transition hover:bg-black/30"
                >
                  ⧉ {copied ? "কপি হয়েছে" : "কপি"}
                </button>
              </InstructionRow>

              <InstructionRow>
                টাকার পরিমাণ:{" "}
                <span className="font-black text-yellow-200">
                  ৳{amountText}
                </span>
              </InstructionRow>

              <InstructionRow>
                নিশ্চিত করে আপনার {selectedMethod.name} PIN দিন।
              </InstructionRow>

              <InstructionRow>
                টাকা পাঠিয়ে Transaction ID কপি করুন।
              </InstructionRow>

              <InstructionRow last>
                Transaction ID উপরের ঘরে লিখে Verify চাপুন।
              </InstructionRow>
            </div>
          </section>

          {message && (
            <div className="mt-2 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-center text-[11px] font-bold text-cyan-200">
              {message}
            </div>
          )}

          <button
            type="button"
            onClick={verifyPayment}
            disabled={isSubmitting}
            className="mt-2 h-[44px] w-full rounded-xl text-[15px] font-black text-white shadow-lg transition hover:brightness-95 active:scale-[0.995] disabled:cursor-not-allowed disabled:opacity-60"
            style={{ backgroundColor: selectedMethod.verifyColor }}
          >
            {isSubmitting ? "সাবমিট হচ্ছে..." : "ভেরিফাই"}
          </button>

          <div className="mt-2 rounded-xl border border-cyan-400/20 bg-[#0b2545] px-4 py-3 text-center shadow-lg">
            <div className="text-[11px] text-slate-400">Player</div>
            <div className="mt-0.5 truncate text-[13px] font-black text-white">
              {player || "—"}
            </div>

            <div className="mt-2 text-[11px] text-slate-400">Package</div>
            <div className="mt-0.5 text-[13px] font-black text-white">
              {packageName || "—"}
            </div>

            <div className="mt-2 text-[11px] text-slate-400">UID</div>
            <div className="mt-0.5 text-[13px] font-black tracking-wide text-white">
              {uid || "—"}
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen bg-[#07182f] px-3 py-4 text-white"
      style={{ colorScheme: "dark" }}
    >
      <div className="mx-auto w-full max-w-[430px] rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-400/15 bg-[#07182f] text-sm text-slate-300 transition hover:border-cyan-400"
          >
            ⌂
          </Link>

          <Link
            href="/topup/uid"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-400/15 bg-[#07182f] text-lg text-slate-300 transition hover:border-cyan-400"
          >
            ×
          </Link>
        </div>

        <div className="mt-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-cyan-400 text-sm font-black text-[#06172e] shadow-lg">
            B21
          </div>

          <h1 className="mt-2 text-lg font-black">
            BD21 <span className="text-cyan-400">Pay</span>
          </h1>

          <p className="text-[10px] text-slate-400">Secure Instant Payment</p>
        </div>

        <div className="mt-3 rounded-lg bg-cyan-400 px-4 py-2 text-center text-xs font-black text-[#06172e]">
          মোবাইল ব্যাংকিং
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {paymentMethods.map((method) => (
            <button
              key={method.id}
              type="button"
              onClick={() => setSelectedMethod(method)}
              className="flex min-h-[80px] items-center justify-center rounded-xl border border-cyan-400/15 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-400"
            >
              <Image
                src={method.logo}
                alt={method.name}
                width={180}
                height={60}
                className="max-h-[52px] w-auto object-contain"
                style={{ width: "auto", height: "auto" }}
              />
            </button>
          ))}
        </div>

        <div className="mt-3 rounded-xl border border-cyan-400/15 bg-[#07182f] p-3 text-[11px]">
          <div className="flex justify-between gap-3">
            <span className="text-slate-400">Player</span>
            <span className="max-w-[65%] truncate font-bold">{player}</span>
          </div>

          <div className="mt-1.5 flex justify-between gap-3">
            <span className="text-slate-400">Package</span>
            <span className="font-bold">{packageName}</span>
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-cyan-400 px-4 py-3 text-center text-base font-black text-[#06172e]">
          পে করুন ৳{amountText}
        </div>

        <p className="mt-2 text-center text-[10px] leading-4 text-slate-400">
          Payment method নির্বাচন করলে instruction screen খুলবে।
        </p>
      </div>
    </main>
  );
}

function InstructionRow({
  children,
  last = false,
}: {
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <div className={last ? "" : "border-b border-white/15"}>
      <div className="flex items-start gap-2.5 py-3">
        <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-white" />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

export default function PaymentPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[#07182f] text-slate-400">
          Loading payment...
        </main>
      }
    >
      <PaymentContent />
    </Suspense>
  );
}
