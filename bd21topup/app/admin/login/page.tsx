"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AdminLoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [message, setMessage] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  /*
   * -------------------------------------------------------
   * Check existing session
   * -------------------------------------------------------
   */

  useEffect(() => {
    async function checkExistingSession() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          return;
        }

        const response = await fetch("/api/admin/check", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        const result = await response.json();

        if (response.ok && result.admin) {
          router.replace("/admin");
          return;
        }

        await supabase.auth.signOut();
      } catch (error) {
        console.error("EXISTING SESSION CHECK ERROR:", error);
      }
    }

    checkExistingSession();
  }, [router]);

  /*
   * -------------------------------------------------------
   * Email + Password Login
   * -------------------------------------------------------
   */

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!email.trim() || !password) {
      setMessage("Email এবং password দিন।");
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error || !data.session) {
        setMessage("Email অথবা password সঠিক নয়।");
        return;
      }

      /*
       * Check Admin Access
       */

      const response = await fetch("/api/admin/check", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
        },
      });

      const result = await response.json();

      if (!response.ok || !result.admin) {
        await supabase.auth.signOut();

        setMessage("এই account-এর Admin access নেই।");

        return;
      }

      router.replace("/admin");
      router.refresh();
    } catch (error) {
      console.error("ADMIN LOGIN ERROR:", error);

      setMessage("Login করা যায়নি। আবার চেষ্টা করুন।");
    } finally {
      setIsLoading(false);
    }
  }

  /*
   * -------------------------------------------------------
   * Google Login
   * -------------------------------------------------------
   */

  async function handleGoogleLogin() {
    try {
      setIsGoogleLoading(true);
      setMessage("");

      /*
       * IMPORTANT:
       *
       * Use the existing main website Google login
       * callback instead of /auth/callback.
       */

      const redirectTo = `${window.location.origin}/login`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",

        options: {
          redirectTo,
        },
      });

      if (error) {
        console.error("GOOGLE LOGIN ERROR:", error);

        setMessage("Google login শুরু করা যায়নি।");

        setIsGoogleLoading(false);
      }
    } catch (error) {
      console.error("GOOGLE LOGIN ERROR:", error);

      setMessage("Google login করা যায়নি।");

      setIsGoogleLoading(false);
    }
  }

  return (
    <main
      className="
        flex
        min-h-screen
        items-center
        justify-center
        bg-[#07182f]
        px-4
        py-8
        text-white
      "
    >
      <div
        className="
          w-full
          max-w-[390px]
          rounded-2xl
          border
          border-cyan-400/20
          bg-[#0b2545]
          p-5
          shadow-2xl
          sm:p-6
        "
      >
        {/* =================================================
            TOP BAR
        ================================================= */}

        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="
              flex
              h-9
              w-9
              items-center
              justify-center
              rounded-lg
              border
              border-cyan-400/15
              bg-[#07182f]
              text-sm
              text-slate-300
              transition
              hover:border-cyan-400
            "
            aria-label="Go to homepage"
          >
            ←
          </Link>

          <span
            className="
              rounded-full
              border
              border-cyan-400/20
              bg-cyan-400/10
              px-3
              py-1
              text-[10px]
              font-black
              uppercase
              tracking-[0.18em]
              text-cyan-300
            "
          >
            Secure
          </span>
        </div>

        {/* =================================================
            LOGO / TITLE
        ================================================= */}

        <div className="mt-5 text-center">
          <div
            className="
              mx-auto
              flex
              h-14
              w-14
              items-center
              justify-center
              rounded-2xl
              bg-cyan-400
              text-base
              font-black
              text-[#06172e]
              shadow-lg
            "
          >
            B21
          </div>

          <h1 className="mt-3 text-xl font-black">
            BD21 <span className="text-cyan-400">Admin</span>
          </h1>

          <p className="mt-1 text-xs text-slate-400">
            Sign in to manage orders
          </p>
        </div>

        {/* =================================================
            EMAIL LOGIN
        ================================================= */}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {/* Email */}

          <div>
            <label
              htmlFor="email"
              className="
                mb-1.5
                block
                text-xs
                font-bold
                text-slate-300
              "
            >
              Admin Email
            </label>

            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);

                setMessage("");
              }}
              placeholder="admin@example.com"
              className="
                h-12
                w-full
                rounded-xl
                border
                border-cyan-400/20
                bg-[#07182f]
                px-4
                text-sm
                text-white
                outline-none
                transition
                placeholder:text-slate-500
                focus:border-cyan-400
              "
            />
          </div>

          {/* Password */}

          <div>
            <label
              htmlFor="password"
              className="
                mb-1.5
                block
                text-xs
                font-bold
                text-slate-300
              "
            >
              Password
            </label>

            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);

                setMessage("");
              }}
              placeholder="••••••••"
              className="
                h-12
                w-full
                rounded-xl
                border
                border-cyan-400/20
                bg-[#07182f]
                px-4
                text-sm
                text-white
                outline-none
                transition
                placeholder:text-slate-500
                focus:border-cyan-400
              "
            />
          </div>

          {/* Error */}

          {message && (
            <div
              className="
                rounded-xl
                border
                border-rose-400/20
                bg-rose-400/10
                px-3
                py-2.5
                text-center
                text-xs
                font-bold
                text-rose-200
              "
            >
              {message}
            </div>
          )}

          {/* Login */}

          <button
            type="submit"
            disabled={isLoading || isGoogleLoading}
            className="
              h-12
              w-full
              rounded-xl
              bg-cyan-400
              text-sm
              font-black
              text-[#06172e]
              transition
              hover:brightness-95
              disabled:cursor-not-allowed
              disabled:opacity-60
            "
          >
            {isLoading ? "Checking..." : "Login to Admin"}
          </button>
        </form>

        {/* =================================================
            OR
        ================================================= */}

        <div
          className="
            my-5
            flex
            items-center
            gap-3
          "
        >
          <div className="h-px flex-1 bg-cyan-400/10" />

          <span
            className="
              text-[10px]
              font-bold
              uppercase
              text-slate-500
            "
          >
            OR
          </span>

          <div className="h-px flex-1 bg-cyan-400/10" />
        </div>

        {/* =================================================
            GOOGLE LOGIN
        ================================================= */}

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={isLoading || isGoogleLoading}
          className="
            flex
            h-12
            w-full
            items-center
            justify-center
            gap-3
            rounded-xl
            border
            border-cyan-400/20
            bg-[#07182f]
            text-sm
            font-black
            text-white
            transition
            hover:border-cyan-400/50
            hover:bg-[#0a203d]
            disabled:cursor-not-allowed
            disabled:opacity-60
          "
        >
          <span
            className="
              flex
              h-6
              w-6
              items-center
              justify-center
              rounded-full
              bg-white
              text-sm
              font-black
              text-[#4285F4]
            "
          >
            G
          </span>

          {isGoogleLoading ? "Connecting..." : "Continue with Google"}
        </button>

        {/* =================================================
            SECURITY NOTE
        ================================================= */}

        <p
          className="
            mt-4
            text-center
            text-[10px]
            leading-5
            text-slate-500
          "
        >
          Only the authorized BD21 administrator can access this area.
        </p>
      </div>
    </main>
  );
}
