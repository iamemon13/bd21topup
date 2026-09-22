"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Mode = "login" | "signup";

function getSafeNextPath() {
  if (typeof window === "undefined") return "/account";

  const urlNext = new URLSearchParams(window.location.search).get("next");

  if (urlNext && urlNext.startsWith("/") && !urlNext.startsWith("//")) {
    return urlNext;
  }

  const savedNext = window.localStorage.getItem("bd21_auth_next");

  if (savedNext && savedNext.startsWith("/") && !savedNext.startsWith("//")) {
    return savedNext;
  }

  return "/account";
}

function consumeNextPath() {
  const next = getSafeNextPath();

  if (typeof window !== "undefined") {
    window.localStorage.removeItem("bd21_auth_next");
  }

  return next;
}

export default function CustomerLoginPage() {
  const router = useRouter();
  const redirectStartedRef = useRef(false);

  const [mode, setMode] = useState<Mode>("login");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"error" | "success">("error");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    async function checkSession() {
      if (redirectStartedRef.current) return;

      const urlNext = new URLSearchParams(window.location.search).get("next");

      if (urlNext && urlNext.startsWith("/") && !urlNext.startsWith("//")) {
        window.localStorage.setItem("bd21_auth_next", urlNext);
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session && !redirectStartedRef.current) {
        const response = await fetch("/api/account", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        const accountData = await response.json();

        redirectStartedRef.current = true;

        const userRole = accountData?.account?.role;
        if (
          userRole === "super_admin" ||
          userRole === "admin" ||
          userRole === "editor"
        ) {
          router.replace("/admin");
        } else {
          router.replace(consumeNextPath());
        }
      }
    }

    checkSession();
  }, [router]);

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setMessage("");
    setPassword("");
    setConfirmPassword("");
  }

  async function handleGoogleLogin() {
    setMessage("");
    setMessageType("error");
    setIsLoading(true);

    try {
      const next = getSafeNextPath();

      window.localStorage.setItem("bd21_auth_next", next);

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,

          queryParams: {
            access_type: "offline",
            prompt: "select_account",
          },
        },
      });

      if (error) {
        console.error("GOOGLE LOGIN ERROR:", error);

        setMessage(error.message || "Google login শুরু করা যায়নি।");

        setIsLoading(false);
      }
    } catch (error) {
      console.error("GOOGLE AUTH ERROR:", error);

      setMessage("Google login শুরু করা যায়নি।");

      setIsLoading(false);
    }
  }

  // পাসওয়ার্ড রিসেট বা ফোরগট পাসওয়ার্ড ফাংশন
  async function handleForgotPassword() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setMessageType("error");
      setMessage("আগে উপরের Email বক্সে আপনার ইমেলটি লিখুন।");
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        setMessageType("error");
        setMessage(error.message);
      } else {
        setMessageType("success");
        setMessage(
          "পাসওয়ার্ড রিসেট লিংক আপনার ইমেলে পাঠানো হয়েছে ✅ চেক করুন।",
        );
      }
    } catch (err) {
      console.error("FORGOT PASSWORD ERROR:", err);
      setMessageType("error");
      setMessage("কিছু সমস্যা হয়েছে। আবার চেষ্টা করুন।");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setMessage("");
    setMessageType("error");

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !password) {
      setMessage("Email এবং password দিন।");
      return;
    }

    if (mode === "signup") {
      const cleanName = fullName.trim();
      const cleanPhone = phone.trim();

      if (!cleanName) {
        setMessage("আপনার নাম দিন।");
        return;
      }

      if (!/^01\d{9}$/.test(cleanPhone)) {
        setMessage("সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন।");
        return;
      }

      if (password.length < 6) {
        setMessage("Password কমপক্ষে 6 characters হতে হবে।");
        return;
      }

      if (password !== confirmPassword) {
        setMessage("দুইটি password এক নয়।");
        return;
      }
    }

    setIsLoading(true);

    try {
      if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

        if (error || !data.session) {
          setMessage("Email অথবা password সঠিক নয়।");
          return;
        }

        const response = await fetch("/api/account", {
          headers: {
            Authorization: `Bearer ${data.session.access_token}`,
          },
        });

        const accountData = await response.json();

        if (!redirectStartedRef.current) {
          redirectStartedRef.current = true;

          const userRole = accountData?.account?.role;
          if (
            userRole === "super_admin" ||
            userRole === "admin" ||
            userRole === "editor"
          ) {
            router.replace("/admin");
          } else {
            router.replace(consumeNextPath());
          }
        }

        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            phone: phone.trim(),
          },
        },
      });

      if (error) {
        if (error.message.toLowerCase().includes("already")) {
          setMessage("এই email দিয়ে account আগে থেকেই আছে।");
        } else {
          setMessage(error.message);
        }
        return;
      }

      if (data.session) {
        setMessageType("success");
        setMessage("Account তৈরি হয়েছে ✅");
        const response = await fetch("/api/account", {
          headers: {
            Authorization: `Bearer ${data.session.access_token}`,
          },
        });

        const accountData = await response.json();

        if (!redirectStartedRef.current) {
          redirectStartedRef.current = true;

          const userRole = accountData?.account?.role;
          if (
            userRole === "super_admin" ||
            userRole === "admin" ||
            userRole === "editor"
          ) {
            router.replace("/admin");
          } else {
            router.replace(consumeNextPath());
          }
        }

        return;
      }

      setMessageType("success");
      setMessage(
        "Account তৈরি হয়েছে ✅ Email verification link পাঠানো হয়েছে। Email verify করে Login করুন।",
      );
      setMode("login");
      setPassword("");
      setConfirmPassword("");
    } catch (error) {
      console.error("CUSTOMER AUTH ERROR:", error);
      setMessage("কিছু সমস্যা হয়েছে। আবার চেষ্টা করুন।");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#07182f] px-4 py-8 text-white">
      <div className="w-full max-w-[410px] rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-5 shadow-2xl sm:p-6">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-400/15 bg-[#07182f] text-sm text-slate-300 transition hover:border-cyan-400"
            aria-label="Back to home"
          >
            ←
          </Link>

          <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">
            BD21 Account
          </span>
        </div>

        <div className="mt-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-400 text-base font-black text-[#06172e] shadow-lg">
            B21
          </div>

          <h1 className="mt-3 text-xl font-black">
            BD21 <span className="text-cyan-400">Top Up</span>
          </h1>

          <p className="mt-1 text-xs text-slate-400">
            {mode === "login"
              ? "Login to your account"
              : "Create your BD21 account"}
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 rounded-xl border border-cyan-400/15 bg-[#07182f] p-1">
          <button
            type="button"
            onClick={() => switchMode("login")}
            className={`h-9 rounded-lg text-xs font-black transition ${
              mode === "login" ? "bg-cyan-400 text-[#06172e]" : "text-slate-400"
            }`}
          >
            Login
          </button>

          <button
            type="button"
            onClick={() => switchMode("signup")}
            className={`h-9 rounded-lg text-xs font-black transition ${
              mode === "signup"
                ? "bg-cyan-400 text-[#06172e]"
                : "text-slate-400"
            }`}
          >
            Sign Up
          </button>
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={isLoading}
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M21.6 12.23c0-.78-.07-1.53-.2-2.25H12v4.26h5.37a4.59 4.59 0 0 1-1.99 3.01v2.77h3.22c1.88-1.73 3-4.28 3-7.79Z"
            />
            <path
              fill="#34A853"
              d="M12 22c2.7 0 4.96-.89 6.61-2.42l-3.22-2.77c-.89.6-2.04.96-3.39.96-2.6 0-4.8-1.76-5.59-4.12H3.08v2.85A9.99 9.99 0 0 0 12 22Z"
            />
            <path
              fill="#FBBC05"
              d="M6.41 13.65A5.98 5.98 0 0 1 6.1 12c0-.57.1-1.12.3-1.65V7.5H3.08A10 10 0 0 0 2 12c0 1.61.38 3.14 1.08 4.5l3.33-2.85Z"
            />
            <path
              fill="#EA4335"
              d="M12 6.23c1.47 0 2.79.5 3.82 1.49l2.87-2.87C16.95 3.23 14.7 2 12 2a9.99 9.99 0 0 0-8.92 5.5l3.33 2.85C7.2 7.99 9.4 6.23 12 6.23Z"
            />
          </svg>
          Continue with Google
        </button>

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-cyan-400/15" />
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            OR
          </span>
          <div className="h-px flex-1 bg-cyan-400/15" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === "signup" && (
            <>
              <Field
                label="Full Name"
                type="text"
                value={fullName}
                onChange={(value) => {
                  setFullName(value);
                  setMessage("");
                }}
                placeholder="Your name"
                autoComplete="name"
              />

              <Field
                label="Mobile Number"
                type="tel"
                value={phone}
                onChange={(value) => {
                  setPhone(value.replace(/\D/g, "").slice(0, 11));
                  setMessage("");
                }}
                placeholder="01XXXXXXXXX"
                autoComplete="tel"
              />
            </>
          )}

          <Field
            label="Email"
            type="email"
            value={email}
            onChange={(value) => {
              setEmail(value);
              setMessage("");
            }}
            placeholder="you@example.com"
            autoComplete="email"
          />

          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(value) => {
              setPassword(value);
              setMessage("");
            }}
            placeholder="••••••••"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
          />

          {mode === "login" && (
            <div className="text-right">
              <button
                type="button"
                onClick={handleForgotPassword}
                className="text-xs text-cyan-400 transition hover:underline"
              >
                Forgot Password?
              </button>
            </div>
          )}

          {mode === "signup" && (
            <Field
              label="Confirm Password"
              type="password"
              value={confirmPassword}
              onChange={(value) => {
                setConfirmPassword(value);
                setMessage("");
              }}
              placeholder="••••••••"
              autoComplete="new-password"
            />
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
            disabled={isLoading}
            className="h-12 w-full rounded-xl bg-cyan-400 text-sm font-black text-[#06172e] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading
              ? "Please wait..."
              : mode === "login"
                ? "Login"
                : "Create Account"}
          </button>
        </form>

        <p className="mt-4 text-center text-[10px] leading-5 text-slate-500">
          Your account will be used for My Orders and BD21 Wallet.
        </p>
      </div>
    </main>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoComplete: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold text-slate-300">
        {label}
      </label>

      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="h-11 w-full rounded-xl border border-cyan-400/20 bg-[#07182f] px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400"
      />
    </div>
  );
}
