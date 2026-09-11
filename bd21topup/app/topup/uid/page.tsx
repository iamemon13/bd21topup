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

const paymentOptions = [
  {
    id: "wallet",
    name: "BD21 Wallet Pay",
    description: "Pay from your BD21 wallet balance",
    icon: "💳",
  },
  {
    id: "instant",
    name: "Instant Pay",
    description: "bKash, Nagad, Rocket or Upay",
    icon: "⚡",
  },
];

export default function UIDTopUpPage() {
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
        .order("price", { ascending: true });

      if (data && !error) {
        setPackages(data);
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
      <header className="border-b border-cyan-400/15 bg-[#081c36]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/logo/bd21-logo.png"
              alt="BD21 Top Up"
              width={55}
              height={55}
              className="h-12 w-12 rounded-xl object-cover"
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
            href="/"
            className="rounded-lg border border-cyan-400/20 px-4 py-2 text-sm font-semibold transition hover:border-cyan-400"
          >
            ← Home
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-5">
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* Left Product */}
          <div>
            <div className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#0b2545]">
              <Image
                src="/products/uid-topup.png"
                alt="UID TopUp"
                width={700}
                height={700}
                className="h-auto w-full"
                priority
              />
            </div>

            <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-5">
              <h1 className="text-2xl font-black">
                UID <span className="text-cyan-400">TopUp</span>
              </h1>

              <p className="mt-2 text-sm leading-6 text-slate-400">
                Free Fire BD Server UID TopUp
              </p>
            </div>
          </div>

          {/* Right Order Form */}
          <div className="space-y-5">
            {/* Step 1: Select Package */}
            <div className="rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-400 font-black text-[#06172e]">
                  1
                </span>

                <h2 className="text-lg font-black">Select Package</h2>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {loadingPackages ? (
                  <div className="col-span-full py-6 text-center text-sm font-semibold text-cyan-400 animate-pulse">
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
                        className={`rounded-xl border p-4 text-left transition ${
                          isSelected
                            ? "border-cyan-400 bg-cyan-400/10 shadow-[0_0_20px_rgba(34,211,238,0.15)]"
                            : "border-white/10 bg-[#07182f] hover:border-cyan-400"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[13px] font-bold sm:text-sm">{item.name}</div>

                          {isSelected && (
                            <span className="text-sm text-cyan-400">✓</span>
                          )}
                        </div>

                        <div className="mt-2 font-black text-cyan-400">
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
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-400 font-black text-[#06172e]">
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
                  className="w-full rounded-xl border border-white/10 bg-[#07182f] px-4 py-4 text-sm outline-none transition placeholder:text-slate-500 focus:border-cyan-400"
                />

                {/* Conditional Button / Success Box */}
                {!isUidVerified ? (
                  <button
                    type="button"
                    onClick={checkUid}
                    disabled={checkingUid}
                    className="w-full rounded-xl bg-cyan-400 px-6 py-4 font-bold text-[#06172e] transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {checkingUid ? "Checking..." : "Check UID"}
                  </button>
                ) : (
                  <div className="flex w-full items-center justify-between rounded-xl border border-green-400/30 bg-green-400/10 px-4 py-3">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-wider text-green-400">
                        ✓ Player Found
                      </div>
                      <div className="mt-1 text-lg font-black text-white">
                        {playerName}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-bold uppercase text-slate-400">
                        Verified UID
                      </div>
                      <div className="text-sm font-bold text-slate-200">
                        {verifiedUid}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {uidError && (
                <div className="mt-3 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm font-semibold text-red-400">
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
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-400 font-black text-[#06172e]">
                  3
                </span>

                <h2 className="text-lg font-black">Select Payment Option</h2>
              </div>

              {/* Force Grid Cols 2 even on mobile to sit side-by-side */}
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
                    <div className="absolute left-0 top-0 flex h-7 w-7 items-start justify-start rounded-br-xl bg-rose-500 p-1.5 shadow-sm sm:h-8 sm:w-8 sm:p-2">
                      <span className="text-[10px] font-black leading-none text-white sm:text-xs">✓</span>
                    </div>
                  )}
                  
                  <div className="flex min-h-[90px] flex-col items-center justify-center p-2 sm:min-h-[120px] sm:p-4">
                    <div className="flex flex-col items-center gap-1 sm:flex-row sm:gap-2">
                      <Image src="/logo/bd21-logo.png" alt="BD21" width={32} height={32} className="rounded-lg shadow-sm sm:w-9" />
                      <div className="text-lg font-black tracking-tight text-slate-800 sm:text-2xl">
                        WALLET<span className="text-rose-600">PAY</span>
                      </div>
                    </div>
                    <div className="mt-2 hidden items-center justify-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 shadow-inner sm:flex">
                      <span className="text-xs">💳</span>
                      <span className="text-[9px] font-black uppercase tracking-wide text-slate-500 sm:text-[10px]">Secure BD21 Balance</span>
                    </div>
                  </div>
                  
                  <div className="bg-slate-200 px-3 py-2 text-center text-[11px] font-black text-slate-500 transition group-hover:bg-slate-300 group-hover:text-slate-700 sm:px-4 sm:py-3 sm:text-left sm:text-sm">
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
                    <div className="absolute left-0 top-0 flex h-7 w-7 items-start justify-start rounded-br-xl bg-rose-500 p-1.5 shadow-sm sm:h-8 sm:w-8 sm:p-2">
                      <span className="text-[10px] font-black leading-none text-white sm:text-xs">✓</span>
                    </div>
                  )}

                  <div className="flex min-h-[90px] flex-col items-center justify-center p-2 sm:min-h-[120px] sm:p-4">
                    <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                      {["bkash", "nagad", "rocket", "upay"].map((method) => (
                        <div key={method} className="flex h-8 w-14 items-center justify-center rounded border border-slate-200 bg-white p-1 shadow-sm sm:h-10 sm:w-16 sm:rounded-md sm:p-1.5">
                          <Image
                            src={`/payment/${method}.png`}
                            alt={method}
                            width={50}
                            height={24}
                            className="max-h-5 w-auto object-contain sm:max-h-6"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-slate-200 px-3 py-2 text-center text-[11px] font-black text-slate-500 transition group-hover:bg-slate-300 group-hover:text-slate-700 sm:px-4 sm:py-3 sm:text-left sm:text-sm">
                    Instant Pay
                  </div>
                </button>
              </div>

              {selectedPayment === "wallet" && (
                <div className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-cyan-200 sm:text-sm">
                      BD21 Wallet Balance
                    </span>
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
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-400 font-black text-[#06172e]">
                  4
                </span>

                <h2 className="text-lg font-black">Order Summary</h2>
              </div>

              <div className="space-y-3 rounded-xl bg-[#07182f] p-4 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">Product</span>
                  <span>UID TopUp</span>
                </div>

                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">Player</span>
                  <span className="text-right">
                    {isUidVerified ? playerName : "Not verified"}
                  </span>
                </div>

                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">Package</span>
                  <span className="text-right">
                    {selectedPackage ? selectedPackage.name : "Not selected"}
                  </span>
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

                <div className="flex justify-between border-t border-white/10 pt-3">
                  <span className="font-bold">Total</span>

                  <span className="font-black text-cyan-400">
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
                className="mt-5 w-full rounded-xl bg-cyan-400 px-5 py-4 font-black text-[#06172e] transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Continue to Payment
              </button>
            </div>
          </div>
        </div>

        {/* RULES AND FOOTER SECTION */}
        <div className="mt-8 rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-6 lg:mt-12">
          <div className="flex flex-col gap-8 md:flex-row md:justify-between">
            
            {/* Rules */}
            <div className="flex-1 space-y-4">
              <div className="flex items-center gap-3">
                <Image src="/logo/bd21-logo.png" alt="BD21 Logo" width={40} height={40} className="rounded-lg" />
                <h3 className="text-2xl font-black text-white">BD<span className="text-cyan-400">21</span></h3>
              </div>
              
              <ul className="space-y-3 text-sm leading-relaxed text-slate-300">
                <li className="flex gap-2">
                  <span className="text-cyan-400">●</span> 
                  শুধুমাত্র বাংলাদেশ সার্ভারের ID Code দিয়ে টপ আপ হবে।
                </li>
                <li className="flex gap-2">
                  <span className="text-cyan-400">●</span> 
                  Player ID ভুল দিয়ে Diamond না পেলে BD21 কর্তৃপক্ষ দায়ী নয়।
                </li>
                <li className="flex gap-2">
                  <span className="text-cyan-400">●</span> 
                  অর্ডার Cancel হলে কি কারনে তা Cancel হয়েছে তা অর্ডারে বিস্তারিত দেওয়া থাকে। সেগুলা পুরন করে পুনরায় সঠিক তথ্য দিয়ে অর্ডার করবেন।
                </li>
              </ul>
            </div>

            {/* Contact / Telegram */}
            <div className="w-full md:max-w-sm">
              <h3 className="text-lg font-black text-white">Contact Us</h3>
              <p className="mt-2 text-sm text-slate-400">
                কোন সমস্যায় পড়লে টেলিগ্রাম এ যোগাযোগ করবেন। তাহলে দ্রুত সমাধান পেয়ে যাবেন।
              </p>
              
              <a 
                href="#" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-6 py-3 font-bold text-[#06172e] transition hover:bg-cyan-300"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                </svg>
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
            {/* Wallet Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400 text-xl">
                  💳
                </div>

                <div>
                  <div className="text-lg font-black">
                    BD21 <span className="text-cyan-400">Wallet</span>
                  </div>
                  <div className="text-xs text-slate-400">
                    Pay securely from your wallet
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowWalletPay(false);
                  setWalletMessage("");
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full text-2xl text-slate-400 transition hover:bg-white/5 hover:text-white"
                aria-label="Close wallet payment"
              >
                ×
              </button>
            </div>

            <div className="p-5">
              {/* Balance */}
              <div className="rounded-2xl border border-cyan-400/15 bg-[#07182f] p-5">
                <div className="text-xs font-semibold uppercase tracking-[2px] text-slate-400">
                  Available Balance
                </div>

                <div className="mt-2 text-3xl font-black text-cyan-400">
                  {loadingWallet ? "Loading..." : `৳${walletBalance}`}
                </div>
              </div>

              {/* Amount Info */}
              <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-400">Package</span>
                  <span className="font-bold">{selectedPackage.name}</span>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-400">Required Amount</span>
                  <span className="font-black text-white">
                    ৳{selectedPackage.price}
                  </span>
                </div>
              </div>

              {walletBalance < selectedPackage.price ? (
                <>
                  <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
                    <div className="font-black text-amber-300">
                      ⚠ Insufficient Balance
                    </div>
                    <p className="mt-1 text-xs leading-5 text-amber-100/70">
                      এই order complete করতে আপনার wallet-এ আরও ৳
                      {selectedPackage.price - walletBalance} প্রয়োজন।
                    </p>
                  </div>

                  {walletMessage && (
                    <div className="mt-3 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-xs font-semibold text-cyan-300">
                      {walletMessage}
                    </div>
                  )}

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowWalletPay(false);
                        setWalletMessage("");
                      }}
                      className="rounded-xl border border-white/10 px-4 py-3 font-bold text-slate-300 transition hover:border-white/20 hover:text-white"
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        router.push("/add-money");
                      }}
                      className="rounded-xl bg-cyan-400 px-4 py-3 font-black text-[#06172e] transition hover:bg-cyan-300"
                    >
                      Add Money
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleContinue}
                  disabled={
                    loadingWallet || walletBalance < selectedPackage.price
                  }
                  className="mt-5 w-full rounded-xl bg-cyan-400 px-5 py-4 font-black text-[#06172e] transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loadingWallet
                    ? "Checking Balance..."
                    : `Pay ৳${selectedPackage.price} from Wallet`}
                </button>
              )}

              <p className="mt-4 text-center text-[11px] leading-5 text-slate-500">
                Wallet balance আপনার BD21 wallet থেকে নেওয়া হয়েছে।
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
