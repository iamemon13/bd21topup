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

  const selectedPaymentOption = paymentOptions.find(
    (option) => option.id === selectedPayment,
  );

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

      <section className="mx-auto max-w-6xl px-5 py-8">
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
            {/* Step 1 */}
            <div className="rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-400 font-black text-[#06172e]">
                  1
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

            {/* Step 2 */}
            <div className="rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-400 font-black text-[#06172e]">
                  2
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
                          <div className="text-sm font-bold">{item.name}</div>

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

            {/* Step 3 */}
            <div className="rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-400 font-black text-[#06172e]">
                  3
                </span>

                <h2 className="text-lg font-black">Select Payment Option</h2>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {paymentOptions.map((option) => {
                  const isSelected = selectedPayment === option.id;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setSelectedPayment(option.id);

                        if (option.id === "instant") {
                          setShowWalletPay(false);
                          setWalletMessage("");
                        }
                      }}
                      className={`group relative overflow-hidden rounded-2xl border p-5 text-left transition ${
                        isSelected
                          ? "border-cyan-400 bg-cyan-400/10 shadow-[0_0_24px_rgba(34,211,238,0.16)]"
                          : "border-white/10 bg-[#07182f] hover:border-cyan-400/70"
                      }`}
                    >
                      {isSelected && (
                        <span className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-cyan-400 text-sm font-black text-[#06172e]">
                          ✓
                        </span>
                      )}

                      <div className="flex items-center gap-4">
                        <div
                          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-2xl ${
                            isSelected
                              ? "bg-cyan-400 text-[#06172e]"
                              : "bg-white/5 text-white"
                          }`}
                        >
                          {option.icon}
                        </div>

                        <div className="min-w-0 pr-7">
                          <div
                            className={`font-black ${
                              isSelected ? "text-cyan-400" : "text-white"
                            }`}
                          >
                            {option.name}
                          </div>

                          <p className="mt-1 text-xs leading-5 text-slate-400">
                            {option.description}
                          </p>
                        </div>
                      </div>

                      {option.id === "wallet" && (
                        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-400">
                              BD21 Wallet Balance
                            </span>
                            <span className="font-bold text-cyan-400">
                              {loadingWallet
                                ? "Loading..."
                                : `৳${walletBalance}`}
                            </span>
                          </div>
                        </div>
                      )}

                      {option.id === "instant" && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {["bKash", "Nagad", "Rocket", "Upay"].map((name) => (
                            <span
                              key={name}
                              className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-semibold text-slate-300"
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 4 */}
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
                    {selectedPaymentOption
                      ? selectedPaymentOption.name
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
      </section>

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
