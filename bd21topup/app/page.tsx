import Image from "next/image";
import Link from "next/link";
import BannerSlider from "./BannerSlider";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#07182f] text-white">
      {/* Header */}
<header className="border-b border-cyan-400/15 bg-[#081c36]">
  <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
    {/* Logo */}
    <div className="flex items-center gap-2">
      <Image
        src="/logo/bd21-logo.png"
        alt="BD21 Top Up"
        width={64}
        height={64}
        className="h-14 w-14 rounded-xl object-cover sm:h-16 sm:w-16"
        priority
      />

      <div className="hidden leading-none sm:block">
        <div className="text-xl font-black">
          BD<span className="text-cyan-400">21</span>
        </div>

        <div className="mt-1 text-[8px] tracking-[3px] text-slate-300">
          TOP UP
        </div>
      </div>
    </div>

    {/* Navigation */}
    <nav className="flex items-center gap-3 text-xs font-medium sm:gap-5 sm:text-sm">
      <a
        href="#topup"
        className="hidden transition hover:text-cyan-400 sm:block"
      >
        Topup
      </a>

      <a
        href="#contact"
        className="transition hover:text-cyan-400"
      >
        Contact Us
      </a>

      <Link
        href="/login"
        className="rounded-lg bg-cyan-400 px-4 py-2 font-bold text-[#06172e] transition hover:bg-cyan-300 sm:px-5"
      >
        Login
      </Link>
    </nav>
  </div>
</header>

      {/* Notice */}
<section className="mx-auto max-w-7xl px-5 pt-5">
  <div className="flex overflow-hidden rounded-lg border border-cyan-400/20 bg-[#0b2545]">

    {/* Fixed Notice */}
    <div className="relative z-10 flex shrink-0 items-center bg-cyan-400 px-4 py-3 text-xs font-extrabold text-[#06172e]">
      ● &nbsp; NOTICE
    </div>

    {/* Moving Notice */}
    <div className="notice-window flex min-w-0 flex-1 items-center overflow-hidden">
      <div className="notice-track">
        <span>
          ১৮ বছরের নিচে কেউ অর্ডার করবেন না। বাবা-মা/পরিবারের অনুমতি ছাড়া
          বা অন্যের টাকা ব্যবহার করে অর্ডার করা সম্পূর্ণ নিষিদ্ধ। এ ধরনের
          ঘটনায় প্রযোজ্য আইন অনুযায়ী ব্যবস্থা নেওয়া হতে পারে।
        </span>

        <span>
          ১৮ বছরের নিচে কেউ অর্ডার করবেন না। বাবা-মা/পরিবারের অনুমতি ছাড়া
          বা অন্যের টাকা ব্যবহার করে অর্ডার করা সম্পূর্ণ নিষিদ্ধ। এ ধরনের
          ঘটনায় প্রযোজ্য আইন অনুযায়ী ব্যবস্থা নেওয়া হতে পারে।
        </span>
      </div>
    </div>

  </div>
</section>

      {/* Hero Banner Slider */}
      <section className="mx-auto max-w-7xl px-5 pt-5">
        <BannerSlider />
      </section>

      {/* Support Buttons */}
<section className="mx-auto grid max-w-7xl grid-cols-2 gap-3 px-5 py-5 sm:gap-4">
  <button className="rounded-xl border border-cyan-400/20 bg-[#0b2545] px-5 py-4 text-left transition hover:border-cyan-400">
    <div className="text-xs text-cyan-300">SUPPORT</div>
    <div className="font-bold">Telegram</div>
  </button>

  <button className="rounded-xl border border-cyan-400/20 bg-[#0b2545] px-5 py-4 text-left transition hover:border-cyan-400">
    <div className="text-xs text-cyan-300">GROUP</div>
    <div className="font-bold">Join Group</div>
  </button>
</section>

      {/* Topup Section */}
      <section id="topup" className="mx-auto max-w-7xl px-5 py-10">
        <div className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-[4px] text-cyan-400">
            Games
          </p>

          <h2 className="mt-2 text-3xl font-black">FF TOPUP</h2>
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
            },
            {
              name: "Weekly Lite",
              image: "/products/weekly-lite.png",
            },
            {
              name: "Level Up Pass",
              image: "/products/level-up-pass.png",
            },
            {
              name: "FF Likes",
              image: "/products/ff-likes.png",
            },
            {
              name: "Indonesia Server",
              image: "/products/indonesia-server.png",
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
      {/* Recent Orders */}
<section className="mx-auto max-w-7xl px-5 py-10">
  <div className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#0b2545] shadow-xl">

    {/* Header */}
    <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-400/10 text-xl text-cyan-400">
          🛍️
        </div>

        <div>
          <h2 className="text-xl font-black">Recent Orders</h2>

          <div className="mt-1 flex items-center gap-2 text-xs text-green-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-400"></span>
            <span>Live</span>
            <span>〰〰</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden text-xs text-slate-400 sm:block">
          1 মিনিট আগে
        </span>

        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-lg text-slate-300 transition hover:border-cyan-400 hover:text-cyan-400"
          title="Refresh"
        >
          ↻
        </button>
      </div>
    </div>

    {/* Order List */}
    {[
      {
        name: "Rahim",
        product: "25 Diamond",
        price: "৳22",
        time: "1 minute ago",
      },
      {
        name: "Karim",
        product: "115 Diamond",
        price: "৳79",
        time: "2 minutes ago",
      },
      {
        name: "Saddam",
        product: "1x Weekly",
        price: "৳158",
        time: "4 minutes ago",
      },
      {
        name: "Jabir",
        product: "240 Diamond",
        price: "৳158",
        time: "5 minutes ago",
      },
      {
        name: "Ariful",
        product: "Level Up Pass",
        price: "৳75",
        time: "7 minutes ago",
      },
      {
        name: "Mahin",
        product: "Weekly Lite",
        price: "৳42",
        time: "9 minutes ago",
      },
      {
        name: "Sakib",
        product: "50 Diamond",
        price: "৳36",
        time: "11 minutes ago",
      },
      {
        name: "Tamim",
        product: "1x Monthly",
        price: "৳790",
        time: "13 minutes ago",
      },
    ].map((order, index) => (
      <div
        key={`${order.name}-${index}`}
        className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-white/5 px-5 py-3 last:border-0 sm:grid-cols-[1fr_170px_90px]"
      >
        {/* Customer */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-400 font-bold text-[#06172e]">
            {order.name.charAt(0)}
          </div>

          <div className="min-w-0">
            <div className="truncate text-sm font-bold">
              {order.name}
            </div>

            <div className="truncate text-xs text-slate-400">
              {order.product} - {order.price}
            </div>
          </div>
        </div>

        {/* Time */}
        <div className="hidden sm:block">
          <span className="inline-flex rounded-full border border-cyan-400/20 px-3 py-1 text-xs text-slate-300">
            ◷ {order.time}
          </span>
        </div>

        {/* Status */}
        <div className="text-right">
          <span className="inline-flex rounded-full bg-green-400/10 px-3 py-1 text-xs font-bold text-green-400">
            ✓ Done
          </span>
        </div>
      </div>
    ))}
  </div>
</section>
            {/* Promo Banner */}
      <section className="mx-auto max-w-7xl px-5 pb-10">
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
                নতুন অফার, আপডেট, সাপোর্ট এবং গুরুত্বপূর্ণ নোটিস সবার আগে
                পেতে এখনই আমাদের Telegram channel-এ যুক্ত হন।
              </p>

              <div className="mt-6 flex flex-wrap gap-4">
                <a
                  href="https://t.me/"
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
                <div className="mb-3 text-5xl">📢</div>
                <h3 className="text-2xl font-black text-white">
                  Telegram Support Available
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-200">
                  কোনো সমস্যা, প্রশ্ন বা অর্ডার আপডেটের জন্য Telegram-এ
                  যোগাযোগ করুন।
                </p>
                <div className="mt-5 rounded-xl bg-white/10 px-4 py-3 text-sm text-cyan-300">
                  Fast Response • Offer Update • Support Help
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* Footer */}
      <footer
        id="contact"
        className="mt-10 border-t border-cyan-400/15 bg-[#061426]"
      >
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 md:grid-cols-2">
          <div>
            <div className="text-3xl font-black">
              BD<span className="text-cyan-400">21</span>
            </div>

            <p className="mt-4 max-w-md text-sm leading-6 text-slate-400">
              দ্রুত, নিরাপদ ও বিশ্বস্ত গেম টপ-আপ সার্ভিস।
            </p>
          </div>

          <div>
            <h3 className="text-xl font-black">
              Contact Us
            </h3>

            <div className="mt-4 rounded-xl bg-[#0b2545] p-5">
              <div className="font-semibold">
                Telegram HelpLine
              </div>

              <div className="mt-1 text-sm text-slate-400">
                Support available every day
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-white/5 py-5 text-center text-xs text-slate-500">
          © 2026 BD21 Top Up. All Rights Reserved.
        </div>
      </footer>
    </main>
  );
}