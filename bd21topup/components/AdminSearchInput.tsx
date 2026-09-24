"use client";

export const adminInputClass =
  "h-11 w-full min-w-0 rounded-xl border border-cyan-400/25 bg-[#07182f] px-4 text-sm text-white outline-none placeholder:text-slate-500 transition focus:border-cyan-300 focus:ring-1 focus:ring-cyan-300/30";

type AdminSearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: "search" | "text";
  maxLength?: number;
  clearable?: boolean;
  ariaLabel?: string;
};

export default function AdminSearchInput({
  value,
  onChange,
  placeholder,
  type = "search",
  maxLength,
  clearable = false,
  ariaLabel,
}: AdminSearchInputProps) {
  return (
    <div className="relative min-w-0">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
        🔍
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-label={ariaLabel}
        className={`${adminInputClass} pl-10 ${clearable && value ? "pr-10" : "pr-4"}`}
      />
      {clearable && value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 transition hover:text-white"
        >
          ✕
        </button>
      )}
    </div>
  );
}
