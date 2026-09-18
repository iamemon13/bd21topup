"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import NotificationBell from "@/components/NotificationBell";

type RankJourneyItem = {
  name: string;
  min: number;
  max: number | null;
  state: "unlocked" | "current" | "locked";
};

type AccountResponse = {
  success: boolean;
  account: {
    id: string;
    email: string;
    fullName: string;
    phone: string | null;
    avatarUrl: string | null;
    verified: boolean;
    walletBalance: number;
    createdAt: string;
  };
  stats: {
    orders: number;
    completedOrders: number;
    totalSpend: number;
    weeklySpend?: number;
  };
  rank: {
    current: string;
    level: number;
    progress: number;
    next: string | null;
    amountToNext: number;
    journey: RankJourneyItem[];
  };
};

const rankStyles: Record<string, string> = {
  Bronze: "from-amber-900 to-orange-600 border-orange-400/30",
  Silver: "from-slate-500 to-slate-300 border-slate-200/30",
  Gold: "from-yellow-700 to-yellow-300 border-yellow-200/30",
  Platinum: "from-sky-700 to-cyan-300 border-cyan-200/30",
  Diamond: "from-indigo-700 to-cyan-300 border-cyan-200/30",
  Heroic: "from-red-800 to-orange-500 border-orange-300/30",
  Master: "from-orange-800 to-yellow-400 border-yellow-200/30",
  "Grand Master":
    "from-yellow-700 via-amber-400 to-yellow-200 border-yellow-200/40",
};

const rankGlyphs: Record<string, string> = {
  Bronze: "B",
  Silver: "S",
  Gold: "G",
  Platinum: "P",
  Diamond: "D",
  Heroic: "H",
  Master: "M",
  "Grand Master": "GM",
};

export default function AccountPage() {
  const router = useRouter();

  const [data, setData] = useState<AccountResponse | null>(null);
  const [message, setMessage] = useState("Loading account...");
  const [isLoading, setIsLoading] = useState(true);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const [showEditProfile, setShowEditProfile] = useState(false);
  const [editFullName, setEditFullName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editMessage, setEditMessage] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Change Password States
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Withdraw States
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawMethod, setWithdrawMethod] = useState("bKash");
  const [withdrawAccountNumber, setWithdrawAccountNumber] = useState("");
  const [withdrawMessage, setWithdrawMessage] = useState("");
  const [isSubmittingWithdraw, setIsSubmittingWithdraw] = useState(false);

  async function loadAccount() {
    setIsLoading(true);
    setMessage("Loading account...");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login");
        return;
      }

      const response = await fetch("/api/account", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        cache: "no-store",
      });

      if (response.status === 401) {
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Account load করা যায়নি।");
        return;
      }

      setData(result);
      setAvatarFailed(false);
      setMessage("");
    } catch (error) {
      console.error("ACCOUNT PAGE ERROR:", error);
      setMessage("Server-এর সাথে connection করা যায়নি।");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initials = useMemo(() => {
    const name = data?.account.fullName?.trim() || "BD21 User";
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");
  }, [data]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  function openEditProfile() {
    if (!data) return;

    setEditFullName(data.account.fullName);
    setEditPhone(data.account.phone || "");
    setEditMessage("");
    setShowEditProfile(true);
  }

  async function saveProfile() {
    const fullName = editFullName.trim();
    const phone = editPhone.trim();

    if (fullName.length < 2) {
      setEditMessage("Name কমপক্ষে 2 characters হতে হবে।");
      return;
    }

    if (phone && !/^01\d{9}$/.test(phone)) {
      setEditMessage("সঠিক 11 digit Bangladesh mobile number দিন।");
      return;
    }

    setIsSavingProfile(true);
    setEditMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login");
        return;
      }

      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          fullName,
          phone,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setEditMessage(result.error || "Profile update করা যায়নি।");
        return;
      }

      setShowEditProfile(false);
      await loadAccount();
    } catch (error) {
      console.error("PROFILE UPDATE ERROR:", error);
      setEditMessage("Server-এর সাথে connection করা যায়নি।");
    } finally {
      setIsSavingProfile(false);
    }
  }

 async function handleChangePassword() {
    // গুগল বা যাদের কারেন্ট পাসওয়ার্ড নেই, তাদের জন্য বর্তমান পাসওয়ার্ড ফিল্ড অপশনাল রাখা যেতে পারে
    // অথবা নতুন এপিআই সরাসরি নতুন পাসওয়ার্ড সেট করে নেবে।
    if (!newPassword || !confirmNewPassword) {
      setPasswordMessage("নতুন পাসওয়ার্ড এবং কনফার্ম পাসওয়ার্ড পূরণ করুন।");
      return;
    }

    if (newPassword.length < 6) {
      setPasswordMessage("নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।");
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setPasswordMessage("নতুন পাসওয়ার্ড এবং কনফার্ম পাসওয়ার্ড এক হয়নি।");
      return;
    }

    setIsChangingPassword(true);
    setPasswordMessage("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }

      // নতুন ব্যাকএন্ড এপিআই কল করা হচ্ছে (যা কারেন্ট পাসওয়ার্ড ছাড়াই সরাসরি আপডেট করবে)
      const response = await fetch("/api/update-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ newPassword }),
      });

      const result = await response.json();

      if (!response.ok) {
        setPasswordMessage(result.error || "পাসওয়ার্ড পরিবর্তন করা যায়নি।");
        setIsChangingPassword(false);
        return;
      }

      setPasswordMessage("পাসওয়ার্ড সফলভাবে সেট বা পরিবর্তন করা হয়েছে!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");

      setTimeout(() => {
        setShowChangePassword(false);
        setPasswordMessage("");
      }, 1500);
    } catch (error) {
      console.error("PASSWORD CHANGE ERROR:", error);
      setPasswordMessage("সার্ভারে সমস্যা হয়েছে, আবার চেষ্টা করুন।");
    } finally {
      setIsChangingPassword(false);
    }
  }
    async function handleWithdrawSubmit() {
    const amountNum = Number(withdrawAmount);

    if (!amountNum || amountNum < 100) {
      setWithdrawMessage("কমপক্ষে ১০০ টাকা উইথড্র করতে হবে।");
      return;
    }

    if (data && amountNum > data.account.walletBalance) {
      setWithdrawMessage("আপনার ওয়ালেটে পর্যাপ্ত ব্যালেন্স নেই।");
      return;
    }

    if (!/^01\d{9}$/.test(withdrawAccountNumber)) {
      setWithdrawMessage("সঠিক ১১ ডিজিটের বিকাশ/নগদ নম্বর দিন।");
      return;
    }

    setIsSubmittingWithdraw(true);
    setWithdrawMessage("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }

      const response = await fetch("/api/withdraw", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          amount: amountNum,
          method: withdrawMethod,
          accountNumber: withdrawAccountNumber,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setWithdrawMessage(result.error || "রিকোয়েস্ট পাঠানো ব্যর্থ হয়েছে।");
        setIsSubmittingWithdraw(false);
        return;
      }

      setWithdrawMessage("উইথড্রয়াল রিকোয়েস্ট সফলভাবে জমা হয়েছে!");
      setTimeout(() => {
        setShowWithdrawModal(false);
        loadAccount();
        router.push("/transactions"); // সফল উইথড্র-এর পর সরাসরি ট্রানজেকশন পেজে রিডাইরেক্ট করবে
      }, 1500);
    } catch (error) {
      console.error("WITHDRAW ERROR:", error);
      setWithdrawMessage("সার্ভারে সমস্যা হয়েছে।");
    } finally {
      setIsSubmittingWithdraw(false);
    }
    }
  
    if (isLoading || !data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#07182f] px-4 text-white">
        <div className="rounded-2xl border border-cyan-400/20 bg-[#0b2545] px-6 py-5 text-center text-sm font-bold text-slate-300">
          {message || "Loading account..."}
        </div>
      </main>
    );
  }

  const { account, stats, rank } = data;

  return (
    <main className="min-h-screen bg-[#07182f] px-3 py-4 text-white sm:px-4 sm:py-6">
      <div className="mx-auto w-full max-w-[760px] space-y-3">
        <header className="flex items-center justify-between rounded-2xl border border-cyan-400/15 bg-[#0b2545] px-4 py-3 shadow-xl">
          <Link
            href="/"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/15 bg-[#07182f] text-sm text-slate-300 transition hover:border-cyan-400"
          >
            ←
          </Link>

          <div className="flex items-center gap-2">
            <NotificationBell />

            <button
              type="button"
              onClick={handleLogout}
              className="rounded-xl border border-cyan-400/15 bg-[#07182f] px-3 py-2 text-[11px] font-black text-cyan-300"
            >
              Logout
            </button>
          </div>
        </header>

        <section className="rounded-2xl border border-cyan-400/15 bg-[#0b2545] p-4 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="relative shrink-0">
              {account.avatarUrl && !avatarFailed ? (
                <img
                  src={account.avatarUrl}
                  alt={account.fullName}
                  onError={() => setAvatarFailed(true)}
                  className="h-16 w-16 rounded-full border-2 border-cyan-300 object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-cyan-300 bg-[#07182f] text-lg font-black text-cyan-300">
                  {initials}
                </div>
              )}

              <span className="absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-[#0b2545] bg-emerald-400" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-black">
                  {account.fullName}
                </h2>

                {account.verified && (
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[9px] font-black text-emerald-300">
                    ✓ VERIFIED
                  </span>
                )}
              </div>

              <p className="mt-1 truncate text-[11px] text-slate-400">
                {account.email}
              </p>

              <div className="mt-2 inline-flex items-center gap-2 rounded-xl border border-cyan-400/15 bg-[#07182f] px-3 py-2">
                <RankBadge name={rank.current} size="small" />
                <div>
                  <p className="text-[11px] font-black">
                    {rank.current} Member
                  </p>
                  <p className="text-[9px] text-slate-500">
                    Level {rank.level} / Current Rank
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-cyan-400/15 bg-[#07182f] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Wallet Balance
                </p>
                <p className="mt-1 text-3xl font-black text-white">
                  ৳{account.walletBalance.toFixed(0)}
                </p>
              </div>

              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-cyan-400/15 bg-[#0b2545] text-cyan-300">
                ৳
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <Link
                href="/add-money"
                className="flex h-11 w-full items-center justify-center rounded-xl bg-cyan-400 text-sm font-black text-[#06172e] transition hover:brightness-95"
              >
                Add Money
              </Link>

              <button
                type="button"
                onClick={() => {
                  setWithdrawMessage("");
                  setWithdrawAmount("");
                  setWithdrawMethod("bKash");
                  setWithdrawAccountNumber("");
                  setShowWithdrawModal(true);
                }}
                className="flex h-11 w-full items-center justify-center rounded-xl border border-cyan-400/30 bg-[#07182f] text-sm font-black text-cyan-300 transition hover:border-cyan-400"
              >
                Withdraw
              </button>
            </div>
          </div>
        </section>

        <section
          className={`overflow-hidden rounded-2xl border bg-gradient-to-br p-4 shadow-xl ${
            rankStyles[rank.current] || rankStyles.Bronze
          }`}
        >
          <div className="flex flex-col items-center text-center">
            <RankBadge name={rank.current} size="large" />

            <p className="mt-3 text-[9px] font-black uppercase tracking-[0.18em] text-white/70">
              Current Rank
            </p>

            <h3 className="mt-1 text-2xl font-black">{rank.current}</h3>

            <p className="mt-1 text-[11px] text-white/75">
              {rank.next
                ? `Next rank: ${rank.next}`
                : "Highest BD21 rank unlocked"}
            </p>
          </div>

          <div className="mt-5">
            <div className="mb-1 flex justify-between text-[10px] font-black">
              <span>Progress</span>
              <span>{rank.progress}%</span>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-black/25">
              <div
                className="h-full rounded-full bg-white"
                style={{ width: `${rank.progress}%` }}
              />
            </div>

            <p className="mt-2 text-center text-[10px] font-bold text-white/80">
              {rank.next
                ? `আর ৳${rank.amountToNext.toLocaleString()} spend করলে ${rank.next}`
                : "Grand Master unlocked 🏆"}
            </p>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-2">
          <StatCard label="Orders" value={String(stats.orders)} icon="▣" />
          <StatCard
            label="Total Spend"
            value={`৳${stats.totalSpend.toLocaleString()}`}
            icon="৳"
          />
          <StatCard
            label="Weekly Spend"
            value={`৳${Number(stats.weeklySpend || 0).toLocaleString()}`}
            icon="◫"
          />
          <StatCard label="Rank" value={rank.current} icon="★" />
        </section>

        <section className="rounded-2xl border border-cyan-400/15 bg-[#0b2545] p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-cyan-300">
                Rank Journey
              </p>
              <h3 className="mt-1 text-sm font-black">Your Path</h3>
            </div>

            <span className="text-xs font-black text-cyan-300">
              {rank.level}/{rank.journey.length}
            </span>
          </div>

          <div className="space-y-2">
            {rank.journey.map((item) => (
              <RankJourneyRow key={item.name} item={item} />
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-cyan-400/15 bg-[#0b2545] p-4 shadow-xl">
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-cyan-300">
            Quick Menu
          </p>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <QuickLink href="/orders" label="My Orders" icon="▣" />
            <QuickLink href="/transactions" label="Transactions" icon="↔" />
            <QuickLink href="/add-money" label="Add Money" icon="+" />
          </div>
        </section>

        <section className="rounded-2xl border border-cyan-400/15 bg-[#0b2545] p-4 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-cyan-300">
                Account
              </p>

              <h3 className="mt-1 text-sm font-black">User Information</h3>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setPasswordMessage("");
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmNewPassword("");
                  setShowChangePassword(true);
                }}
                className="rounded-xl border border-cyan-400/20 bg-[#07182f] px-3 py-2 text-[10px] font-black text-cyan-300 transition hover:border-cyan-400"
              >
                🔒 Password
              </button>

              <button
                type="button"
                onClick={openEditProfile}
                className="rounded-xl border border-cyan-400/20 bg-[#07182f] px-3 py-2 text-[10px] font-black text-cyan-300 transition hover:border-cyan-400"
              >
                ✎ Edit Profile
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <InfoBox label="Name" value={account.fullName} />
            <InfoBox label="Phone" value={account.phone || "Not added yet"} />
            <InfoBox label="Email" value={account.email} />
            <InfoBox
              label="User ID"
              value={account.id.slice(0, 8).toUpperCase()}
            />
          </div>
        </section>
      </div>

      {/* Edit Profile Modal */}
      {showEditProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-cyan-400/20 bg-[#081c36] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">
                  BD21 Top Up
                </p>
                <h2 className="mt-1 text-xl font-black">Edit Profile</h2>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!isSavingProfile) {
                    setShowEditProfile(false);
                    setEditMessage("");
                  }
                }}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-[#07182f] text-xl text-slate-400"
              >
                ×
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Name
                </span>
                <input
                  type="text"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  maxLength={60}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#07182f] px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400"
                />
              </label>

              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Phone
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={editPhone}
                  onChange={(e) =>
                    setEditPhone(e.target.value.replace(/\D/g, "").slice(0, 11))
                  }
                  placeholder="01XXXXXXXXX"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#07182f] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-400"
                />
              </label>

              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Email Address
                </span>
                <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                  {account.email}
                </div>
                <p className="mt-2 text-[10px] leading-4 text-slate-500">
                  Email আপনার login account থেকে আসে, তাই Profile Edit থেকে পরিবর্তন করা যাবে না।
                </p>
              </div>
            </div>

            {editMessage && (
              <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-xs font-bold text-amber-200">
                {editMessage}
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isSavingProfile}
                onClick={() => {
                  setShowEditProfile(false);
                  setEditMessage("");
                }}
                className="rounded-xl border border-white/10 px-4 py-3 text-sm font-black text-slate-300 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={isSavingProfile}
                onClick={saveProfile}
                className="rounded-xl bg-cyan-400 px-4 py-3 text-sm font-black text-[#06172e] transition hover:bg-cyan-300 disabled:opacity-50"
              >
                {isSavingProfile ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {showChangePassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-cyan-400/20 bg-[#081c36] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">
                  Security
                </p>
                <h2 className="mt-1 text-xl font-black">Change Password</h2>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!isChangingPassword) {
                    setShowChangePassword(false);
                    setPasswordMessage("");
                  }
                }}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-[#07182f] text-xl text-slate-400"
              >
                ×
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Current Password
                </span>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#07182f] px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400"
                />
              </label>

              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  New Password
                </span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#07182f] px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400"
                />
              </label>

              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Confirm New Password
                </span>
                <input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#07182f] px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400"
                />
              </label>
            </div>

            {passwordMessage && (
              <div
                className={`mt-4 rounded-xl border px-4 py-3 text-xs font-bold ${
                  passwordMessage.includes("সফলভাবে")
                    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                    : "border-amber-400/20 bg-amber-400/10 text-amber-200"
                }`}
              >
                {passwordMessage}
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isChangingPassword}
                onClick={() => {
                  setShowChangePassword(false);
                  setPasswordMessage("");
                }}
                className="rounded-xl border border-white/10 px-4 py-3 text-sm font-black text-slate-300 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={isChangingPassword}
                onClick={handleChangePassword}
                className="rounded-xl bg-cyan-400 px-4 py-3 text-sm font-black text-[#06172e] transition hover:bg-cyan-300 disabled:opacity-50"
              >
                {isChangingPassword ? "Updating..." : "Update Password"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Withdraw Modal */}
      {showWithdrawModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-cyan-400/20 bg-[#081c36] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">
                  Wallet
                </p>
                <h2 className="mt-1 text-xl font-black">Withdraw Money</h2>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!isSubmittingWithdraw) setShowWithdrawModal(false);
                }}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-[#07182f] text-xl text-slate-400"
              >
                ×
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Amount (৳)
                </span>
                <input
                  type="number"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  placeholder="যেমন: 500"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#07182f] px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400"
                />
              </label>

              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Payment Method
                </span>
                <select
                  value={withdrawMethod}
                  onChange={(e) => setWithdrawMethod(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#07182f] px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400"
                >
                  <option value="bKash">bKash</option>
                  <option value="Nagad">Nagad</option>
                </select>
              </label>

              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Account Number (Personal)
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={withdrawAccountNumber}
                  onChange={(e) =>
                    setWithdrawAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 11))
                  }
                  placeholder="01XXXXXXXXX"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#07182f] px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400"
                />
              </label>
            </div>

            {withdrawMessage && (
              <div
                className={`mt-4 rounded-xl border px-4 py-3 text-xs font-bold ${
                  withdrawMessage.includes("সফলভাবে")
                    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                    : "border-amber-400/20 bg-amber-400/10 text-amber-200"
                }`}
              >
                {withdrawMessage}
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isSubmittingWithdraw}
                onClick={() => setShowWithdrawModal(false)}
                className="rounded-xl border border-white/10 px-4 py-3 text-sm font-black text-slate-300 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={isSubmittingWithdraw}
                onClick={handleWithdrawSubmit}
                className="rounded-xl bg-cyan-400 px-4 py-3 text-sm font-black text-[#06172e] transition hover:bg-cyan-300 disabled:opacity-50"
              >
                {isSubmittingWithdraw ? "Submitting..." : "Confirm Withdraw"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function RankBadge({ name, size }: { name: string; size: "small" | "large" }) {
  const sizeClass =
    size === "large" ? "h-20 w-20 text-xl" : "h-9 w-9 text-[10px]";

  return (
    <div
      className={`flex shrink-0 rotate-45 items-center justify-center rounded-[18px] border bg-gradient-to-br shadow-xl ${
        rankStyles[name] || rankStyles.Bronze
      } ${sizeClass}`}
    >
      <span className="-rotate-45 font-black text-white drop-shadow">
        {rankGlyphs[name] || "B"}
      </span>
    </div>
  );
}

function RankJourneyRow({ item }: { item: RankJourneyItem }) {
  const range =
    item.max === null
      ? `৳${item.min.toLocaleString()}+`
      : `৳${item.min.toLocaleString()} - ৳${item.max.toLocaleString()}`;

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${
        item.state === "current"
          ? "border-cyan-400/30 bg-cyan-400/10"
          : "border-cyan-400/10 bg-[#07182f]"
      }`}
    >
      <RankBadge name={item.name} size="small" />

      <div className="min-w-0 flex-1">
        <p
          className={`text-xs font-black ${
            item.state === "current" ? "text-cyan-300" : "text-white"
          }`}
        >
          {item.name}
        </p>
        <p className="mt-0.5 text-[9px] text-slate-500">{range}</p>
      </div>

      <span
        className={`rounded-full border px-2 py-1 text-[8px] font-black uppercase ${
          item.state === "current"
            ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-300"
            : item.state === "unlocked"
              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
              : "border-slate-500/20 bg-slate-500/10 text-slate-500"
        }`}
      >
        {item.state === "current"
          ? "✓ Current"
          : item.state === "unlocked"
            ? "✓ Unlocked"
            : "🔒 Locked"}
      </span>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: string;
}) {
  return (
    <div className="rounded-xl border border-cyan-400/15 bg-[#0b2545] p-3 shadow-lg">
      <div className="flex items-center justify-between">
        <span className="text-lg text-cyan-300">{icon}</span>
        <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">
          {label}
        </span>
      </div>

      <p className="mt-2 truncate text-sm font-black text-white">{value}</p>
    </div>
  );
}

function QuickLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[78px] flex-col items-center justify-center rounded-xl border border-cyan-400/15 bg-[#07182f] px-2 text-center transition hover:border-cyan-400"
    >
      <span className="text-xl font-black text-cyan-300">{icon}</span>
      <span className="mt-2 text-[10px] font-black text-slate-300">
        {label}
      </span>
    </Link>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-cyan-400/10 bg-[#07182f] px-3 py-3">
      <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className="mt-1 break-all text-xs font-bold text-white">{value}</p>
    </div>
  );
}
