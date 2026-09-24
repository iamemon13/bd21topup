"use client";

import Link from "next/link";

export const adminActionClass =
  "inline-flex h-10 min-w-[5.5rem] flex-1 items-center justify-center rounded-xl px-3 text-xs font-black transition sm:flex-none";

export const adminSecondaryActionClass =
  `${adminActionClass} border border-cyan-400/30 bg-transparent text-cyan-200 hover:border-cyan-300 hover:bg-cyan-400/10`;

export const adminPrimaryActionClass =
  `${adminActionClass} bg-cyan-400 text-[#06172e] hover:opacity-90`;

type AdminPageHeaderProps = {
  title: string;
  subtitle: string;
  eyebrow?: string;
  onRefresh?: () => void | Promise<void>;
  refreshLabel?: string;
  refreshDisabled?: boolean;
  onLogout: () => void | Promise<void>;
  loggingOut?: boolean;
};

export default function AdminPageHeader({
  title,
  subtitle,
  eyebrow = "BD21 ADMIN",
  onRefresh,
  refreshLabel = "Refresh",
  refreshDisabled = false,
  onLogout,
  loggingOut = false,
}: AdminPageHeaderProps) {
  return (
    <header className="rounded-2xl border border-cyan-400/25 bg-[#0b294d] p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">
            {eyebrow}
          </p>
          <h1 className="mt-1 break-words text-xl font-black text-white sm:text-2xl">
            {title}
          </h1>
          <p className="mt-1 break-words text-xs text-slate-400 sm:text-sm">
            {subtitle}
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
          {onRefresh && (
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={refreshDisabled}
              className={`${adminSecondaryActionClass} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {refreshDisabled ? "Loading..." : refreshLabel}
            </button>
          )}
          <Link href="/admin" className={adminSecondaryActionClass}>
            Dashboard
          </Link>
          <button
            type="button"
            onClick={() => void onLogout()}
            disabled={loggingOut}
            className={`${adminPrimaryActionClass} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {loggingOut ? "Logging out..." : "Logout"}
          </button>
        </div>
      </div>
    </header>
  );
}
