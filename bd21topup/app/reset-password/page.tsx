"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"error" | "success">("error");
  const [isLoading, setIsLoading] = useState(false);
  const [isRecoveryReady, setIsRecoveryReady] = useState(false);
  const [isCheckingRecovery, setIsCheckingRecovery] = useState(true);

  useEffect(() => {
    let mounted = true;
    let recoveryDetected = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      if (event === "PASSWORD_RECOVERY" && session) {
        recoveryDetected = true;
        setIsRecoveryReady(true);
        setIsCheckingRecovery(false);
        setMessage("");
        return;
      }

      if (event === "SIGNED_OUT") {
        setIsRecoveryReady(false);
      }
    });

    const timeout = window.setTimeout(() => {
      if (!mounted || recoveryDetected) return;

      setIsCheckingRecovery(false);
      setMessageType("error");
      setMessage(
        "Password reset linkটি invalid বা expired হতে পারে। আবার নতুন reset link নিন.",
      );
    }, 3000);

    return () => {
      mounted = false;
      window.clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setMessage("");
    setMessageType("error");

    if (!isRecoveryReady) {
      setMessage("Password recovery session পাওয়া যায়নি। আবার reset link নিন.");
      return;
    }

    if (password.length < 8) {
      setMessage("Password কমপক্ষে 8 characters হতে হবে।");
      return;
    }

    if (password.length > 128) {
      setMessage("Password সর্বোচ্চ 128 characters হতে পারবে।");
      return;
    }

    if (password !== confirmPassword) {
      setMessage("দুইটি password এক নয়।");
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      setMessageType("success");
      setMessage("Password সফলভাবে পরিবর্তন হয়েছে ✅");

      setIsRecoveryReady(false);

      await supabase.auth.signOut();

      window.setTimeout(() => {
        router.replace("/login");
      }, 1200);
    } catch (error) {
      console.error("RESET PASSWORD ERROR:", error);
      setMessage("Password পরিবর্তন করা যায়নি। আবার চেষ্টা করুন।");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#07182f] px-4 py-8 text-white">
      <div className="w-full max-w-[410px] rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-5 shadow-2xl sm:p-6">
        <div className="flex items-center justify-between">
          <Link
            href="/login"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-400/15 bg-[#07182f] text-sm text-slate-300 transition hover:border-cyan-400"
            aria-label="Back to login"
          >
            ←
          </Link>

          <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">
            Password Reset
          </span>
        </div>

        <div className="mt-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-400 text-base font-black text-[#06172e] shadow-lg">
            B21
          </div>

          <h1 className="mt-3 text-xl font-black">
            Set New <span className="text-cyan-400">Password</span>
          </h1>

          <p className="mt-1 text-xs text-slate-400">
            Enter your new password below.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <Field
            label="New Password"
            value={password}
            onChange={(value) => {
              setPassword(value);
              setMessage("");
            }}
          />

          <Field
            label="Confirm Password"
            value={confirmPassword}
            onChange={(value) => {
              setConfirmPassword(value);
              setMessage("");
            }}
          />

          {isCheckingRecovery && !message && (
            <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-2.5 text-center text-xs font-bold text-cyan-200">
              Password reset link যাচাই করা হচ্ছে...
            </div>
          )}

          {message && (
            <div
              className={`rounded-xl px-3 py-2.5 text-center text-xs font-bold ${
                messageType === "success"
                  ? "border border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                  : "border border-rose-400/20 bg-rose-400/10 text-rose-200"
              }`}
            >
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !isRecoveryReady}
            className="h-12 w-full rounded-xl bg-cyan-400 text-sm font-black text-[#06172e] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Updating..." : "Update Password"}
          </button>
        </form>

        <p className="mt-4 text-center text-[10px] leading-5 text-slate-500">
          Password reset করতে email-এর recovery link ব্যবহার করতে হবে।
        </p>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold text-slate-300">
        {label}
      </label>

      <input
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="••••••••"
        autoComplete="new-password"
        minLength={8}
        maxLength={128}
        className="h-11 w-full rounded-xl border border-cyan-400/20 bg-[#07182f] px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400"
      />
    </div>
  );
}
