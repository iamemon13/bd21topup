"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function BottomNav() {
  const pathname = usePathname();

  const navItems = [
    {
      name: "Home",
      href: "/",
      icon: (active: boolean) => (
        <svg className={`w-5 h-5 ${active ? "text-cyan-400" : "text-slate-400"}`} fill="currentColor" viewBox="0 0 20 20">
          <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
        </svg>
      ),
    },
    {
      name: "My Orders",
      href: "/orders",
      icon: (active: boolean) => (
        <svg className={`w-5 h-5 ${active ? "text-cyan-400" : "text-slate-400"}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
        </svg>
      ),
    },
    {
      name: "Add Money",
      href: "/add-money",
      isCenter: true, // মাঝের গোল প্লাস বাটন
      icon: () => (
        <div className="flex items-center justify-center w-11 h-11 -mt-5 rounded-full bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-400/40 border-4 border-[#07182f]">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </div>
      ),
    },
    {
      name: "History",
      href: "/transactions",
      icon: (active: boolean) => (
        <svg className={`w-5 h-5 ${active ? "text-cyan-400" : "text-slate-400"}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      name: "My Account",
      href: "/account",
      icon: (active: boolean) => (
        <svg className={`w-5 h-5 ${active ? "text-cyan-400" : "text-slate-400"}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#081c36]/95 backdrop-blur-md border-t border-cyan-400/20 py-1.5 sm:hidden">
      <div className="flex items-center justify-around max-w-md mx-auto px-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className="flex flex-col items-center justify-center flex-1 py-1"
            >
              {item.icon(isActive)}
              <span
                className={`text-[10px] mt-1 ${
                  item.isCenter ? "font-bold text-cyan-300" : isActive ? "text-cyan-400 font-semibold" : "text-slate-400"
                }`}
              >
                {item.name}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
