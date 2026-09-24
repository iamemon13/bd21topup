"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type ActivityItem = {
  id: string;
  adminId: string | null;
  adminEmail: string | null;
  adminRole: string | null;
  actionType: string;
  targetId: string | null;
  details: string | null;
  ipAddress: string | null;
  createdAt: string | null;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

export default function AdminActivityPage() {
  const router = useRouter();

  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [page, setPage] = useState(1);

  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0,
    hasPreviousPage: false,
    hasNextPage: false,
  });

  const [searchInput, setSearchInput] = useState("");
  const [actionInput, setActionInput] = useState("");
  const [adminInput, setAdminInput] = useState("");

  const [searchFilter, setSearchFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [adminFilter, setAdminFilter] = useState("");

  useEffect(() => {
    let cancelled = false;

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (!cancelled) {
            setLoading(true);
            setError("");
          }

          const {
            data: { session },
          } = await supabase.auth.getSession();

          if (cancelled) {
            return;
          }

          if (!session) {
            router.replace("/login");
            return;
          }

          const roleResponse = await fetch("/api/admin/role", {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
            cache: "no-store",
          });

          if (cancelled) {
            return;
          }

          if (roleResponse.status === 401) {
            await supabase.auth.signOut();

            if (!cancelled) {
              router.replace("/login");
            }

            return;
          }

          if (!roleResponse.ok) {
            setError("আপনার অ্যাডমিন অনুমতি যাচাই করা যায়নি।");
            return;
          }

          const roleData = await roleResponse.json();

          if (cancelled) {
            return;
          }

          if (roleData.role !== "super_admin") {
            router.replace("/admin");
            return;
          }

          const params = new URLSearchParams({
            page: String(page),
            limit: "25",
          });

          if (searchFilter) {
            params.set("search", searchFilter);
          }

          if (actionFilter) {
            params.set("action_type", actionFilter);
          }

          if (adminFilter) {
            params.set("admin_id", adminFilter);
          }

          const response = await fetch(
            `/api/admin/activity?${params.toString()}`,
            {
              headers: {
                Authorization: `Bearer ${session.access_token}`,
              },
              cache: "no-store",
            },
          );

          if (cancelled) {
            return;
          }

          if (response.status === 401) {
            await supabase.auth.signOut();

            if (!cancelled) {
              router.replace("/login");
            }

            return;
          }

          if (response.status === 403) {
            router.replace("/admin");
            return;
          }

          const data = await response.json();

          if (cancelled) {
            return;
          }

          if (!response.ok || !data.success) {
            setError(data.error || "Activity log load করা যায়নি।");
            return;
          }

          setItems(Array.isArray(data.items) ? data.items : []);

          setPagination(data.pagination);
        } catch (err) {
          if (!cancelled) {
            console.error("Activity page load error:", err);

            setError("Activity log load করার সময় সমস্যা হয়েছে।");
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [page, searchFilter, actionFilter, adminFilter, router]);

  function handleFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextSearch = searchInput.trim();
    const nextAction = actionInput.trim();
    const nextAdmin = adminInput.trim();

    setPage(1);
    setSearchFilter(nextSearch);
    setActionFilter(nextAction);
    setAdminFilter(nextAdmin);
  }

  function clearFilters() {
    setSearchInput("");
    setActionInput("");
    setAdminInput("");

    setSearchFilter("");
    setActionFilter("");
    setAdminFilter("");

    setPage(1);
  }

  function formatDate(value: string | null) {
    if (!value) {
      return "—";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "—";
    }

    return new Intl.DateTimeFormat("en-BD", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "Asia/Dhaka",
    }).format(date);
  }

  function formatRole(role: string | null) {
    if (!role) {
      return "Unknown";
    }

    return role.replaceAll("_", " ").toUpperCase();
  }

  return (
    <main className="min-h-screen bg-[#061b35] p-4 text-white">
      <div className="mx-auto w-full max-w-6xl">
        {/* HEADER */}
        <div className="rounded-2xl border border-cyan-500/30 bg-[#0b294d] p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-cyan-300">
                Super Admin Only
              </p>

              <h1 className="mt-1 text-2xl font-black sm:text-3xl">
                Activity Log
              </h1>

              <p className="mt-2 text-sm text-slate-300">
                Admin ও Editor-দের গুরুত্বপূর্ণ কার্যক্রম দেখুন।
              </p>
            </div>

            <Link
              href="/admin"
              className="rounded-xl border border-cyan-400/30 px-4 py-2.5 text-center text-sm font-bold text-cyan-300 transition hover:bg-cyan-400/10"
            >
              ← Dashboard
            </Link>
          </div>
        </div>

        {/* SEARCH + FILTERS */}
        <form
          onSubmit={handleFilter}
          className="mt-5 rounded-2xl border border-cyan-500/20 bg-[#0b294d] p-5"
        >
          <h2 className="text-lg font-bold">Search & Filters</h2>

          <div className="mt-4">
            <label className="mb-2 block text-xs font-bold text-slate-300">
              Search
            </label>

            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              maxLength={100}
              placeholder="Email, Admin ID, Action, Target ID, Details or IP"
              className="w-full rounded-xl border border-cyan-500/20 bg-[#07182f] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
            />

            <p className="mt-2 text-xs text-slate-500">
              সব activity record-এর মধ্যে search হবে।
            </p>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-xs font-bold text-slate-300">
                Action Type
              </label>

              <input
                type="text"
                value={actionInput}
                onChange={(event) => setActionInput(event.target.value)}
                maxLength={100}
                placeholder="যেমন: CANCEL_ORDER"
                className="w-full rounded-xl border border-cyan-500/20 bg-[#07182f] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold text-slate-300">
                Admin User ID
              </label>

              <input
                type="text"
                value={adminInput}
                onChange={(event) => setAdminInput(event.target.value)}
                placeholder="Admin UUID"
                className="w-full rounded-xl border border-cyan-500/20 bg-[#07182f] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-cyan-400 px-5 py-2.5 text-sm font-black text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Search
            </button>

            <button
              type="button"
              onClick={clearFilters}
              disabled={loading}
              className="rounded-xl border border-slate-500/40 px-5 py-2.5 text-sm font-bold text-slate-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </form>

        {/* RESULT SUMMARY */}
        {!loading && !error && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-300">
            <span>
              Total activity:{" "}
              <strong className="text-white">{pagination.total}</strong>
            </span>

            <span>
              Page {pagination.page}
              {pagination.totalPages > 0 ? ` of ${pagination.totalPages}` : ""}
            </span>
          </div>
        )}

        {/* LOADING */}
        {loading && (
          <div className="mt-5 rounded-2xl border border-cyan-500/20 bg-[#0b294d] p-10 text-center text-slate-300">
            Activity log loading...
          </div>
        )}

        {/* ERROR */}
        {!loading && error && (
          <div className="mt-5 rounded-2xl border border-red-400/30 bg-red-400/10 p-5">
            <p className="font-bold text-red-200">{error}</p>
          </div>
        )}

        {/* EMPTY */}
        {!loading && !error && items.length === 0 && (
          <div className="mt-5 rounded-2xl border border-cyan-500/20 bg-[#0b294d] p-10 text-center">
            <p className="font-bold">কোনো Activity পাওয়া যায়নি।</p>

            <p className="mt-2 text-sm text-slate-400">
              Search বা Filter পরিবর্তন করে আবার চেষ্টা করুন।
            </p>
          </div>
        )}

        {/* ACTIVITY LIST */}
        {!loading && !error && items.length > 0 && (
          <div className="mt-5 space-y-3">
            {items.map((item) => (
              <article
                key={item.id}
                className="rounded-2xl border border-cyan-500/20 bg-[#0b294d] p-4 sm:p-5"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg bg-cyan-400/10 px-2.5 py-1 text-xs font-black text-cyan-300">
                        {item.actionType}
                      </span>

                      <span className="rounded-lg bg-white/5 px-2.5 py-1 text-[11px] font-bold text-slate-300">
                        {formatRole(item.adminRole)}
                      </span>
                    </div>

                    <p className="mt-3 break-all text-sm font-bold text-white">
                      {item.adminEmail ||
                        item.adminId ||
                        "Unknown administrator"}
                    </p>

                    {item.adminEmail && item.adminId && (
                      <p className="mt-1 break-all text-xs text-slate-500">
                        {item.adminId}
                      </p>
                    )}
                  </div>

                  <time className="shrink-0 text-xs text-slate-400">
                    {formatDate(item.createdAt)}
                  </time>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Info label="Target ID" value={item.targetId || "—"} />

                  <Info label="IP Address" value={item.ipAddress || "—"} />
                </div>

                {item.details && (
                  <div className="mt-3 rounded-xl bg-[#07182f] p-3">
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Details
                    </p>

                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-200">
                      {item.details}
                    </p>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        {/* PAGINATION */}
        {!loading && !error && pagination.total > 0 && (
          <div className="mt-5 flex items-center justify-between gap-3 pb-5">
            <button
              type="button"
              disabled={!pagination.hasPreviousPage}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="rounded-xl border border-cyan-400/30 px-4 py-2.5 text-sm font-bold text-cyan-300 transition hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-30"
            >
              ← Previous
            </button>

            <span className="text-xs font-bold text-slate-400">
              {pagination.page} / {Math.max(pagination.totalPages, 1)}
            </span>

            <button
              type="button"
              disabled={!pagination.hasNextPage}
              onClick={() => setPage((current) => current + 1)}
              className="rounded-xl border border-cyan-400/30 px-4 py-2.5 text-sm font-bold text-cyan-300 transition hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-30"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#07182f] p-3">
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">
        {label}
      </p>

      <p className="mt-1 break-all text-xs text-slate-200">{value}</p>
    </div>
  );
}
