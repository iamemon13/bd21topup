"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import BannerSlider from "./BannerSlider";
import RecentOrders from "@/components/RecentOrders";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [balance, setBalance] = useState(0);
  const [userName, setUserName] = useState("U");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [loadingAuth, setLoadingAuth] = useState(true);

  useEffect(() => {
    async function loadUserData() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        setIsLoggedIn(true);

        try {
          const response = await fetch("/api/account", {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          });

          const result = await response.json();

          if (result.success && result.account) {
            setBalance(result.account.walletBalance || 0);

            if (result.account.avatarUrl) {
              setAvatarUrl(result.account.avatarUrl);
            } else if (result.account.fullName) {
              setUserName(result.account.fullName.charAt(0).toUpperCase());
            }
          }
        } catch (error) {
          console.error("Error loading account data:", error);
        }
      }
      setLoadingAuth(false);
    }

    loadUserData();
  }, []);

  return (
    <main className="min-h-screen bg-[#07182f] text-white">
      {/* Header - Sticky on scroll & FFbazar style Single-line Brand Name */}
      <header className="sticky top-0 z-40 border-b border-cyan-400/15 bg-[#081c36]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-3 py-2.5 sm:px-5 sm:py-3.5">
          {/* Logo & Brand Name - Clean Single Line */}
          <Link href="/" className="flex items-center gap-2 sm:gap-3">
            <Image
              src="/logo/bd21-logo.png"
              alt="BD21 Top Up"
              width={64}
              height={64}
              className="h-8 w-8 rounded-lg object-cover sm:h-11 sm:w-11"
              priority
            />

            <div className="flex items-center gap-1.5 text-lg font-black tracking-tight text-white sm:text-2xl">
              <span>
                BD<span className="text-cyan-400">21</span>
              </span>
              <span className="text-sm font-extrabold uppercase tracking-wide text-slate-200 sm:text-lg">
                Top Up
              </span>
            </div>
          </Link>

          {/* Navigation */}
          <nav className="flex items-center gap-2 text-xs font-medium sm:gap-5 sm:text-sm">
            <a
              href="#topup"
              className="hidden transition hover:text-cyan-400 sm:block"
            >
              Topup
            </a>

            <a
              href="https://t.me/BD21Support"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden transition hover:text-cyan-400 sm:block"
            >
              Contact Us
            </a>

            {/* Login / My Account Logic */}
            {loadingAuth ? (
              <div className="h-8 w-24 animate-pulse rounded-full bg-cyan-400/20 sm:h-9 sm:w-28"></div>
            ) : isLoggedIn ? (
              <Link
                href="/account"
                className="flex items-center gap-1.5 sm:gap-2"
              >
                <div className="flex items-center gap-1 rounded-full border border-cyan-400/20 bg-[#0b2545] px-2.5 py-1 text-[11px] font-bold text-cyan-300 shadow-sm transition hover:border-cyan-400 sm:px-3 sm:py-1.5 sm:text-sm">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                  >
                    <path d="M2.25 6a3 3 0 013-3h13.5a3 3 0 013 3v12a3 3 0 01-3 3H5.25a3 3 0 01-3-3V6zM3.75 6v1.5h16.5V6a1.5 1.5 0 00-1.5-1.5H5.25A1.5 1.5 0 003.75 6zM3.75 9v9a1.5 1.5 0 001.5 1.5h13.5a1.5 1.5 0 001.5-1.5V9H3.75zm10.5 4.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                  </svg>
                  ৳{balance}
                </div>
                <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 border-cyan-400 bg-cyan-400/10 text-sm font-black text-cyan-400 shadow-sm transition hover:border-cyan-300 sm:h-9 sm:w-9 sm:text-lg">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt="Profile"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    userName
                  )}
                </div>
              </Link>
            ) : (
              <Link
                href="/login"
                className="rounded-lg bg-cyan-400 px-3 py-1.5 text-xs font-bold text-[#06172e] transition hover:bg-cyan-300 sm:px-5 sm:py-2 sm:text-sm"
              >
                Login
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* Notice */}
      <section className="mx-auto max-w-7xl px-5 pt-5">
        <div className="flex overflow-hidden rounded-lg border border-cyan-400/20 bg-[#0b2545]">
          <div className="relative z-10 flex shrink-0 items-center bg-cyan-400 px-4 py-3 text-xs font-extrabold text-[#06172e]">
            ● &nbsp; NOTICE
          </div>

          <div className="notice-window flex min-w-0 flex-1 items-center overflow-hidden">
            <div className="notice-track">
              <span>
                ১৮ বছরের নিচে কেউ অর্ডার করবেন শাহ। বাবা-মা/পরিবারের অনুমতি
                ছাড়া বা অন্যের টাকা ব্যবহার করে অর্ডার করা সম্পূর্ণ নিষিদ্ধ। এ
                ধরনের ঘটনায় প্রযোজ্য আইন অনুযায়ী ব্যবস্থা নেওয়া হতে পারে।
              </span>
              <span>
                ১৮ বছরের নিচে কেউ অর্ডার করবেন না। বাবা-মা/পরিবারের অনুমতি ছাড়া
                বা অন্যের টাকা ব্যবহার করে অর্ডার করা সম্পূর্ণ নিষিদ্ধ। এ ধরনের
                ঘটনায় প্রযোজ্য আইন অনুযায়ী ব্যবস্থা নেওয়া হতে পারে।
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Hero Banner Slider */}
      <section className="mx-auto max-w-7xl px-5 pt-5">
        <BannerSlider />
      </section>

      {/* Top 2 Action Buttons Only */}
      <section className="mx-auto grid max-w-7xl grid-cols-2 gap-3 px-5 py-5 sm:gap-4">
        <a
          href="https://t.me/BD21Support"
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-xl border border-cyan-400/20 bg-[#0b2545] px-5 py-4 text-left transition hover:border-cyan-400 hover:bg-[#0d3159]"
        >
          <div className="text-xs font-medium text-cyan-300">SUPPORT</div>
          <div className="font-bold text-white">Telegram HelpLine</div>
        </a>

        <a
          href="https://t.me/bd21topup"
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-xl border border-cyan-400/20 bg-[#0b2545] px-5 py-4 text-left transition hover:border-cyan-400 hover:bg-[#0d3159]"
        >
          <div className="text-xs font-medium text-cyan-300">COMMUNITY</div>
          <div className="font-bold text-white">Join Channel</div>
        </a>
      </section>

      {/* Topup Products Grid */}
      <section id="topup" className="mx-auto max-w-7xl px-5 py-6">
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-black">FF TOPUP</h2>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {[
            {
              name: "UID TopUp (BD)",
              image: "/products/uid-topup.png",
              href: "/topup/uid",
            },
            {
              name: "Weekly / Monthly",
              image: "/products/weekly-monthly.png",
              href: "/topup/weekly-monthly",
            },
            {
              name: "Weekly Lite",
              image: "/products/weekly-lite.png",
              href: "/topup/weekly-lite",
            },
            {
              name: "Level Up Pass",
              image: "/products/level-up-pass.png",
              href: "/topup/level-up-pass", // <-- এখানে যোগ করুন
            },
            {
              name: "FF Likes",
              image: "/products/ff-likes.png",
              href: "/topup/ff-likes", // <-- এখানে যোগ করুন
            },
            {
              name: "Indonesia Server",
              image: "/products/indonesia-server.png",
              href: "/topup/indonesia-server", // <-- এখানে যোগ করুন
            },
          ].map((product) => {
            const cardContent = (
              <>
                <div className="aspect-square overflow-hidden bg-[#0d3159]">
                  <Image
                    src={product.image}
                    alt={product.name}
                    width={500}
                    height={500}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="p-4 text-center">
                  <h3 className="text-sm font-bold">{product.name}</h3>
                </div>
              </>
            );

            const cardClass =
              "overflow-hidden rounded-xl border border-cyan-400/20 bg-[#0b2545] transition duration-300 hover:-translate-y-1 hover:border-cyan-400";

            if (product.href) {
              return (
                <Link
                  key={product.name}
                  href={product.href}
                  className={cardClass}
                >
                  {cardContent}
                </Link>
              );
            }

            return (
              <div key={product.name} className={cardClass}>
                {cardContent}
              </div>
            );
          })}
        </div>
      </section>

      {/* Recent Orders (Real-time) */}
      <section className="mx-auto max-w-7xl px-5 py-6">
        <RecentOrders />
      </section>

      {/* Single Promo Banner */}
      <section className="mx-auto max-w-7xl px-5 py-8">
        <div className="overflow-hidden rounded-3xl border border-cyan-400/20 bg-gradient-to-r from-[#2a003f] via-[#5b0030] to-[#1d022f] p-6 shadow-xl md:p-10">
          <div className="grid items-center gap-6 md:grid-cols-2">
            <div>
              <p className="mb-3 text-sm font-bold uppercase tracking-[4px] text-cyan-300">
                BD21 TOP UP
              </p>
              <h2 className="text-3xl font-black leading-tight md:text-5xl">
                সকল <span className="text-cyan-400">অফার</span> জানতে
              </h2>
              <p className="mt-4 text-lg font-semibold text-white/90 md:text-2xl">
                আমাদের Telegram Channel-এ Join করুন
              </p>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-200">
                নতুন অফার, গিভঅ্যাওয়ে এবং নোটিশ সবার আগে পেতে চ্যানেলে যুক্ত
                থাকুন।
              </p>
              <div className="mt-6 flex flex-wrap gap-4">
                <a
                  href="https://t.me/bd21topup"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl bg-cyan-400 px-6 py-3 font-bold text-[#06172e] transition hover:bg-cyan-300"
                >
                  Join Telegram
                </a>
                <a
                  href="#topup"
                  className="rounded-xl border border-white/20 px-6 py-3 font-bold text-white transition hover:border-cyan-400 hover:text-cyan-300"
                >
                  Order Now
                </a>
              </div>
            </div>

            <div className="flex justify-center">
              <div className="w-full max-w-md rounded-2xl border border-white/10 bg-black/20 p-6 text-center backdrop-blur-sm">
                <div className="mb-3 text-4xl">⚡</div>
                <h3 className="text-xl font-bold text-white">
                  Fast Customer Support
                </h3>
                <p className="mt-2 text-sm text-slate-300">
                  টপ-আপ সংক্রান্ত যেকোনো সমস্যায় সরাসরি টেলিগ্রামে কথা বলুন।
                </p>
                <a
                  href="https://t.me/BD21Support"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-block rounded-xl border border-cyan-400/40 bg-cyan-400/20 px-5 py-2.5 text-sm font-semibold text-cyan-300 transition hover:bg-cyan-400 hover:text-[#06172e]"
                >
                  Contact Helpline
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
