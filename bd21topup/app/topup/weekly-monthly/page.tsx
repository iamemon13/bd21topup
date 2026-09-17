"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Package = {
  id: string;
  name: string;
  price: number;
};

export default function WeeklyMonthlyTopUpPage() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(true);
  const [selectedPackage, setSelectedPackage] = useState<Package | null>(null);

  const router = useRouter();

  const [selectedPayment, setSelectedPayment] = useState<string>("");
  const [showWalletPay, setShowWalletPay] = useState(false);
  const [walletMessage, setWalletMessage] = useState("");

  const [walletBalance, setWalletBalance] = useState(0);
  const [loadingWallet, setLoadingWallet] = useState(true);

  const [uid, setUid] = useState("");
  const [checkingUid, setCheckingUid] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [verifiedUid, setVerifiedUid] = useState("");
  const [uidError, setUidError] = useState("");

  useEffect(() => {
    loadWalletBalance();
    loadPackages();
  }, []);

    async function loadPackages() {
    try {
      const { data, error } = await supabase
        .from("packages")
        .select("*")
        .eq("category", "weekly-monthly")
        .order("price", { ascending: true });

      if (data && !error && data.length > 0) {
        // শুধু "Weekly" এবং "Monthly" (যাতে 1x বা 2x নেই) সেগুলোকে ফিল্টার করে বাদ দেওয়া হচ্ছে
        const filteredPackages = data.filter(
          (item) =>
            item.name.trim().toLowerCase() !== "weekly" &&
            item.name.trim().toLowerCase() !== "monthly"
        );
        setPackages(filteredPackages);
      } else {
        setPackages([
          { id: "1w", name: "1x Weekly", price: 158 },
          { id: "1m", name: "1x Monthly", price: 790 },
          { id: "2w", name: "2x Weekly", price: 316 },
          { id: "2m", name: "2x Monthly", price: 1580 },
          { id: "3w", name: "3x Weekly", price: 474 },
          { id: "3m", name: "3x Monthly", price: 2370 },
          { id: "4w", name: "4x Weekly", price: 632 },
          { id: "4m", name: "4x Monthly", price: 3160 },
          { id: "1m1w", name: "1 Monthly + 1 Weekly", price: 948 },
          { id: "1m4w", name: "1 Monthly + 4 Weekly", price: 1422 },
        ]);
      }
    } catch (error) {
      console.log("Packages load error:", error);
    } finally {
      setLoadingPackages(false);
    }
    }
  
  async function loadWalletBalance() {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setWalletBalance(0);
        return;
      }

      const response = await fetch("/api/account", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = await response.json();

      if (data.success) {
        setWalletBalance(data.account.walletBalance);
      }
    } catch (error) {
      console.log("Wallet load error:", error);
    } finally {
      setLoadingWallet(false);
    }
  }

  async function checkUid() {
    const cleanUid = uid.trim();

    if (!cleanUid) {
      setUidError("আগে Player UID লিখুন");
      setPlayerName("");
      setVerifiedUid("");
      return;
    }

    setCheckingUid(true);
    setUidError("");
    setPlayerName("");
    setVerifiedUid("");

    try {
      const response = await fetch("/api/check-uid", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          uid: cleanUid,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setPlayerName(data.username);
        setVerifiedUid(cleanUid);
      } else {
        setUidError(data.message || "UID পাওয়া যায়নি");
      }
    } catch {
      setUidError("UID check করা যাচ্ছে না");
    } finally {
      setCheckingUid(false);
    }
  }

  const isUidVerified =
    Boolean(playerName) && Boolean(verifiedUid) && verifiedUid === uid.trim();

  const canContinue =
    Boolean(selectedPackage) && isUidVerified && Boolean(selectedPayment);

  async function handleContinue() {
    if (!canContinue || !selectedPackage) return;

    const params = new URLSearchParams({
      uid: verifiedUid,
      player: playerName,
      package: selectedPackage.name,
      amount: String(selectedPackage.price),
    });

    const paymentUrl = `/payment?${params.toString()}`;

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      window.localStorage.setItem("bd21_auth_next", paymentUrl);
      router.push(`/login?next=${encodeURIComponent(paymentUrl)}`);
      return;
    }

    if (selectedPayment === "instant") {
      router.push(paymentUrl);
      return;
    }

    if (selectedPayment === "wallet") {
      const response = await fetch("/api/wallet-pay", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          uid: verifiedUid,
          playerName: playerName,
          packageName: selectedPackage.name,
          amount: selectedPackage.price,
        }),
      });

      const result = await response.json();

      if (result.success) {
        router.push("/orders");
      } else {
        setWalletMessage(result.message || "Wallet payment failed");
        setShowWalletPay(true);
      }
      return;
    }
  }

  return (
    <main className="min-h-screen bg-[#07182f] text-white">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-cyan-400/15 bg-[#081c36]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-5 sm:py-4">
          <Link className="flex items-center gap-2 sm:gap-3" href="/">
            <Image
              alt="BD21 Top Up"
              className="h-9 w-9 rounded-lg object-cover sm:h-11 sm:w-11"
              height={44}
              src="/logo/bd21-logo.png"
              width={44}
            />
            <div className="flex items-center gap-1.5 text-base font-black text-white sm:text-xl">
              <span>BD<span className="text-cyan-400">21</span></span>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 sm:text-sm">Top Up</span>
            </div>
          </Link>

          <Link
            className="rounded-lg border border-cyan-400/20 px-3.5 py-1.5 text-xs font-semibold transition hover:border-cyan-400 sm:text-sm"
            href="/"
          >
            ← Home
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-8">
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* Left Product Info */}
          <div>
            <div className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#0b2545]">
              <Image
                alt="Weekly Monthly"
                className="h-auto w-full"
                height={700}
                priority
                src="/products/weekly-monthly.png"
                width={700}
              />
            </div>

            <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-5">
              <h1 className="text-2xl font-black">
                Weekly / <span className="text-cyan-400">Monthly</span>
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Free Fire Weekly & Monthly Membership Instant Delivery
              </p>
            </div>
          </div>

          {/* Right Order Form */}
          <div className="space-y-5">
            {/* Step 1: Select Package */}
            <div className="rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-400 font-black text-[#06172e]">
                  1
                </span>
                <h2 className="text-lg font-black">Select Package</h2>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
                {loadingPackages ? (
                  <div className="col-span-full animate-pulse py-6 text-center text-sm font-semibold text-cyan-400">
                    Loading Packages...
                  </div>
                ) : (
                  packages.map((item) => {
                    const isSelected = selectedPackage?.id === item.id;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedPackage(item)}
                        className={`rounded-xl border p-3.5 text-center transition ${
                          isSelected
                            ? "border-cyan-400 bg-cyan-400/10 shadow-[0_0_20px_rgba(34,211,238,0.15)]"
                            : "border-white/10 bg-[#07182f] hover:border-cyan-400"
                        }`}
                      >
                        <div className="text-[13px] font-bold text-white sm:text-sm">
                          {item.name}
                        </div>
                        <div className="mt-1.5 font-black text-cyan-400">
                          ৳{item.price}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Step 2: Enter Player UID */}
            <div className="rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-400 font-black text-[#06172e]">
                  2
                </span>
                <h2 className="text-lg font-black">Enter Player UID</h2>
              </div>

              <div className="flex flex-col gap-3">
                <input
                  type="text"
                  inputMode="numeric"
                  value={uid}
                  onChange={(e) => {
                    setUid(e.target.value);
                    setPlayerName("");
                    setVerifiedUid("");
                    setUidError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      checkUid();
                    }
                  }}
                  placeholder="Enter your Free Fire UID"
                  className="w-full rounded-xl border border-white/10 bg-[#07182f] px-4 py-3.5 text-sm outline-none transition placeholder:text-slate-500 focus:border-cyan-400"
                />

                {!isUidVerified ? (
                  <button
                    type="button"
                    onClick={checkUid}
                    disabled={checkingUid}
                    className="w-full rounded-xl bg-cyan-400 px-6 py-3.5 font-bold text-[#06172e] transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {checkingUid ? "Checking..." : "Check UID"}
                  </button>
                ) : (
                  <div className="flex w-full items-center justify-between rounded-xl border border-green-400/30 bg-green-400/10 px-4 py-3">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-wider text-green-400">
                        ✓ Player Found
                      </div>
                      <div className="mt-0.5 text-base font-black text-white">
                        {playerName}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-bold uppercase text-slate-400">
                        Verified UID
                      </div>
                      <div className="text-xs font-bold text-slate-200">
                        {verifiedUid}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {uidError && (
                <div className="mt-3 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-2.5 text-xs font-semibold text-red-400">
                  ✕ {uidError}
                </div>
              )}

              <p className="mt-3 text-xs text-slate-400">
                আপনার Free Fire Player ID / UID সঠিকভাবে লিখুন।
              </p>
            </div>

            {/* Step 3: Select Payment Option */}
            <div className="rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-400 font-black text-[#06172e]">
                  3
                </span>
                <h2 className="text-lg font-black">Select Payment Option</h2>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                {/* Wallet Pay Card */}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPayment("wallet");
                    setShowWalletPay(false);
                    setWalletMessage("");
                  }}
                  className={`group relative overflow-hidden rounded-2xl bg-white text-left shadow-md transition hover:-translate-y-0.5 ${
                    selectedPayment === "wallet"
                      ? "ring-[3px] ring-cyan-400 ring-offset-2 ring-offset-[#0b2545]"
                      : "opacity-90 hover:opacity-100"
                  }`}
                >
                  {selectedPayment === "wallet" && (
                    <div className="absolute left-0 top-0 flex h-7 w-7 items-start justify-start rounded-br-xl bg-rose-500 p-1.5 shadow-sm">
                      <span className="text-[10px] font-black leading-none text-white">✓</span>
                    </div>
                  )}

                  <div className="flex min-h-[85px] flex-col items-center justify-center p-2 sm:min-h-[110px] sm:p-4">
                    <div className="flex flex-col items-center gap-1 sm:flex-row sm:gap-2">
                      <Image
                        alt="BD21"
                        className="rounded-lg shadow-sm sm:w-8"
                        height={32}
                        src="/logo/bd21-logo.png"
                        width={32}
                      />
                      <div className="text-base font-black tracking-tight text-slate-800 sm:text-xl">
                        WALLET<span className="text-rose-600">PAY</span>
                      </div>
                    </div>
                    <div className="mt-1.5 hidden items-center justify-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 shadow-inner sm:flex">
                      <span className="text-xs">💳</span>
                      <span className="text-[9px] font-black uppercase tracking-wide text-slate-500">
                        Secure BD21 Balance
                      </span>
                    </div>
                  </div>

                  <div className="bg-slate-200 px-3 py-1.5 text-center text-[11px] font-black text-slate-500 sm:px-4 sm:py-2.5 sm:text-left sm:text-xs">
                    Wallet Pay
                  </div>
                </button>

                {/* Instant Pay Card */}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPayment("instant");
                    setShowWalletPay(false);
                    setWalletMessage("");
                  }}
                  className={`group relative overflow-hidden rounded-2xl bg-white text-left shadow-md transition hover:-translate-y-0.5 ${
                    selectedPayment === "instant"
                      ? "ring-[3px] ring-cyan-400 ring-offset-2 ring-offset-[#0b2545]"
                      : "opacity-90 hover:opacity-100"
                  }`}
                >
                  {selectedPayment === "instant" && (
                    <div className="absolute left-0 top-0 flex h-7 w-7 items-start justify-start rounded-br-xl bg-rose-500 p-1.5 shadow-sm">
                      <span className="text-[10px] font-black leading-none text-white">✓</span>
                    </div>
                  )}

                  <div className="flex min-h-[85px] flex-col items-center justify-center p-2 sm:min-h-[110px] sm:p-4">
                    <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                      {["bkash", "nagad", "rocket", "upay"].map((method) => (
                        <div
                          key={method}
                          className="flex h-7 w-12 items-center justify-center rounded border border-slate-200 bg-white p-1 shadow-sm sm:h-9 sm:w-16 sm:p-1.5"
                        >
                          <Image
                            alt={method}
                            className="max-h-4 w-auto object-contain sm:max-h-5"
                            height={24}
                            src={`/payment/${method}.png`}
                            width={50}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-slate-200 px-3 py-1.5 text-center text-[11px] font-black text-slate-500 sm:px-4 sm:py-2.5 sm:text-left sm:text-xs">
                    Instant Pay
                  </div>
                </button>
              </div>

              {selectedPayment === "wallet" && (
                <div className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-cyan-200">BD21 Wallet Balance</span>
                    <span className="text-sm font-black text-cyan-400 sm:text-base">
                      {loadingWallet ? "Loading..." : `৳${walletBalance}`}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Step 4: Order Summary */}
            <div className="rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-400 font-black text-[#06172e]">
                  4
                </span>
                <h2 className="text-lg font-black">Order Summary</h2>
              </div>

              <div className="space-y-2.5 rounded-xl bg-[#07182f] p-4 text-xs sm:text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">Product</span>
                  <span>Weekly / Monthly</span>
                </div>

                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">Player</span>
                  <span className="text-right">{isUidVerified ? playerName : "Not verified"}</span>
                </div>

                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">Package</span>
                  <span className="text-right">{selectedPackage ? selectedPackage.name : "Not selected"}</span>
                </div>

                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">Payment</span>
                  <span className="text-right">
                    {selectedPayment === "wallet"
                      ? "BD21 Wallet Pay"
                      : selectedPayment === "instant"
                      ? "Instant Pay"
                      : "Not selected"}
                  </span>
                       </div>

                <div className="flex justify-between border-t border-white/10 pt-2.5">
                  <span className="font-bold">Total</span>
                  <span className="text-sm font-black text-cyan-400 sm:text-base">
                    ৳{selectedPackage?.price ?? 0}
                  </span>
                </div>
              </div>

              {!isUidVerified && (
                <p className="mt-3 text-xs text-amber-300">
                  Continue করার আগে Player UID verify করুন।
                </p>
              )}

              {isUidVerified && !selectedPackage && (
                <p className="mt-3 text-xs text-amber-300">
                  Continue করার আগে একটি package select করুন।
                </p>
              )}

              {isUidVerified && selectedPackage && !selectedPayment && (
                <p className="mt-3 text-xs text-amber-300">
                  Continue করার আগে একটি payment option select করুন।
                </p>
              )}

              <button
                type="button"
                onClick={handleContinue}
                disabled={!canContinue}
                className="mt-4 w-full rounded-xl bg-cyan-400 px-5 py-3.5 font-black text-[#06172e] transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Continue to Payment
              </button>
            </div>
          </div>
        </div>

        {/* Rules Section */}
        <div className="mt-8 rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-5 sm:p-6 lg:mt-12">
          <div className="flex flex-col gap-6 md:flex-row md:justify-between">
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-2.5">
                <Image
                  alt="BD21 Logo"
                  className="rounded-lg"
                  height={36}
                  src="/logo/bd21-logo.png"
                  width={36}
                />
                <h3 className="text-xl font-black text-white">
                  BD<span className="text-cyan-400">21</span>
                </h3>
              </div>

              <ul className="space-y-2.5 text-xs leading-relaxed text-slate-300 sm:text-sm">
                <li className="flex gap-2">
                  <span className="text-cyan-400">●</span>
                  শুধুমাত্র বাংলাদেশ সার্ভারের ID Code দিয়ে টপ আপ হবে।
                </li>
                <li className="flex gap-2">
                  <span className="text-cyan-400">●</span>
                  Player ID ভুল দিয়ে মেম্বারশিপ না পেলে BD21 কর্তৃপক্ষ দায়ী নয়।
                </li>
                <li className="flex gap-2">
                  <span className="text-cyan-400">●</span>
                  অর্ডার Cancel হলে কি কারনে Cancel হয়েছে তা অর্ডারে দেওয়া থাকবে।
                </li>
              </ul>
            </div>

            <div className="w-full md:max-w-xs">
              <h3 className="text-base font-black text-white">Contact Us</h3>
              <p className="mt-1.5 text-xs text-slate-400">
                যেকোনো সমস্যায় টেলিগ্রামে যোগাযোগ করলে দ্রুত সমাধান পাবেন।
              </p>
              <a
                href="https://t.me/BD21Support"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-xs font-bold text-[#06172e] transition hover:bg-cyan-300 sm:text-sm"
              >
                Telegram Helpdesk
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Wallet Modal */}
      {showWalletPay && selectedPackage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-cyan-400/20 bg-[#081c36] text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-400 text-lg">
                  💳
                </div>
                <div>
                  <div className="text-base font-black">
                    BD21 <span className="text-cyan-400">Wallet</span>
                  </div>
                  <div className="text-xs text-slate-400">Pay securely from your wallet</div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowWalletPay(false);
                  setWalletMessage("");
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-xl text-slate-400 transition hover:bg-white/5 hover:text-white"
              >
                ×
              </button>
            </div>

            <div className="p-5">
              <div className="rounded-2xl border border-cyan-400/15 bg-[#07182f] p-4">
                <div className="text-[10px] font-semibold uppercase tracking-[2px] text-slate-400">
                  Available Balance
                </div>
                <div className="mt-1 text-2xl font-black text-cyan-400">
                  {loadingWallet ? "Loading..." : `৳${walletBalance}`}
                </div>
              </div>

              <div className="mt-3 space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 text-xs">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-400">Package</span>
                  <span className="font-bold">{selectedPackage.name}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-400">Required Amount</span>
                  <span className="font-black text-white">৳{selectedPackage.price}</span>
                </div>
              </div>

              {walletBalance < selectedPackage.price ? (
                <>
                  <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3">
                    <div className="text-xs font-bold text-amber-300">⚠ Insufficient Balance</div>
                    <p className="mt-1 text-[11px] text-amber-100/70">
                      এই order complete করতে wallet-এ আরও ৳
                      {selectedPackage.price - walletBalance} প্রয়োজন।
                    </p>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowWalletPay(false);
                        setWalletMessage("");
                      }}
                      className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-slate-300 transition hover:bg-white/5"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => router.push("/add-money")}
                      className="rounded-xl bg-cyan-400 px-4 py-2.5 text-xs font-black text-[#06172e] transition hover:bg-cyan-300"
                    >
                      Add Money
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleContinue}
                  disabled={loadingWallet || walletBalance < selectedPackage.price}
                  className="mt-4 w-full rounded-xl bg-cyan-400 px-5 py-3.5 text-sm font-black text-[#06172e] transition hover:bg-cyan-300 disabled:opacity-50"
                >
                  Pay ৳{selectedPackage.price} from Wallet
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
