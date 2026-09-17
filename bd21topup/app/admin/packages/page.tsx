"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

type Package = {
  id: string;
  name: string;
  price: number;
  category?: string;
};

const CATEGORIES = [
  { id: "uid", name: "UID TopUp (BD)", icon: "💎" },
  { id: "weekly-monthly", name: "Weekly / Monthly", icon: "📅" },
  { id: "weekly-lite", name: "Weekly Lite", icon: "🎫" },
  { id: "level-up-pass", name: "Level Up Pass", icon: "⭐" },
  { id: "ff-likes", name: "FF Likes", icon: "👍" },
  { id: "indonesia-server", name: "Indonesia Server", icon: "🇮🇩" },
];

export default function AdminPackages() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [editPrice, setEditPrice] = useState<string>("");
  
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetchPackages();
  }, []);

  async function fetchPackages() {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push("/admin/login");
        return;
      }

      const response = await fetch("/api/admin/packages", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const result = await response.json();

      if (result.success) {
        setPackages(result.packages);
      }
    } catch (error) {
      console.error("Error fetching packages:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdatePackage(id: string) {
    if (!editName.trim()) {
      alert("প্যাকেজের নাম লিখুন");
      return;
    }
    if (!editPrice || isNaN(Number(editPrice))) {
      alert("সঠিক দাম লিখুন");
      return;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch("/api/admin/packages", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          id,
          name: editName.trim(),
          price: Number(editPrice),
        }),
      });

      const result = await response.json();
      if (result.success) {
        alert("প্যাকেজ সফলভাবে আপডেট হয়েছে!");
        setEditingId(null);
        fetchPackages();
      } else {
        alert(result.error || "আপডেট ফেইল হয়েছে");
      }
    } catch (error) {
      alert("সার্ভার এরর");
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/admin/login");
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#07182f] text-cyan-400">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-cyan-400 border-t-transparent"></div>
      </div>
    );
  }

  const filteredPackages = packages
    .filter((pkg) => {
      const cat = pkg.category || "uid";
      const nameLower = pkg.name.trim().toLowerCase();
      const isBasicWeeklyMonthly = nameLower === "weekly" || nameLower === "monthly";

      if (selectedCategory === "uid") {
        return cat === "uid" || isBasicWeeklyMonthly;
      }

      if (selectedCategory === "weekly-monthly") {
        return cat === "weekly-monthly" && !isBasicWeeklyMonthly;
      }

      return cat === selectedCategory;
    })
    .sort((a, b) => {
      const nameA = a.name.trim().toLowerCase();
      const nameB = b.name.trim().toLowerCase();
      const getRank = (name: string) => {
        if (name === "weekly") return 1;
        if (name === "monthly") return 2;
        return 3;
      };
      const rankA = getRank(nameA);
      const rankB = getRank(nameB);
      if (rankA !== rankB) return rankA - rankB;
      return a.price - b.price;
    });

  return (
    <main className="min-h-screen bg-[#07182f] p-5 text-white sm:p-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-cyan-400/20 pb-5">
          <div>
            <h1 className="text-2xl font-black text-cyan-400">BD21 ADMIN</h1>
            <p className="text-sm text-slate-400">Manage Package Names & Prices</p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/admin"
              className="rounded-lg border border-cyan-400/20 bg-[#0b2545] px-4 py-2 text-sm font-bold transition hover:border-cyan-400"
            >
              Dashboard
            </Link>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-2 text-sm font-bold text-rose-400 transition hover:bg-rose-500 hover:text-white"
            >
              Logout
            </button>
          </div>
        </div>

        {!selectedCategory ? (
          <div>
            <h2 className="mb-5 text-xl font-bold">Select a Category</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className="group flex flex-col items-center justify-center gap-3 rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-6 transition hover:-translate-y-1 hover:border-cyan-400 hover:bg-[#0d3159]"
                >
                  <span className="text-3xl">{cat.icon}</span>
                  <span className="text-center font-bold text-cyan-100 group-hover:text-cyan-400">
                    {cat.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-cyan-300">
                {CATEGORIES.find((c) => c.id === selectedCategory)?.name} Packages
              </h2>
              <button
                onClick={() => setSelectedCategory(null)}
                className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-bold transition hover:bg-slate-600"
              >
                ← Back to Categories
              </button>
            </div>

            {filteredPackages.length === 0 ? (
              <div className="rounded-xl border border-cyan-400/20 bg-[#0b2545] p-10 text-center font-semibold text-slate-400">
                এই ক্যাটাগরিতে কোনো প্যাকেজ পাওয়া যায়নি।
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                {filteredPackages.map((pkg) => (
                  <div
                    key={pkg.id}
                    className="rounded-xl border border-cyan-400/20 bg-[#0b2545] p-5 transition hover:border-cyan-400"
                  >
                    {editingId === pkg.id ? (
                      <div className="space-y-3">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full rounded-lg border border-cyan-400/30 bg-[#06172e] px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
                          placeholder="Package Name"
                        />
                        <input
                          type="number"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          className="w-full rounded-lg border border-cyan-400/30 bg-[#06172e] px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
                          placeholder="Package Price"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleUpdatePackage(pkg.id)}
                            className="w-full rounded-lg bg-green-500 py-2 text-xs font-bold text-white transition hover:bg-green-400"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="rounded-lg bg-slate-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-500"
                          >
                            X
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="text-sm font-bold text-cyan-100">{pkg.name}</div>
                        <div className="mt-4 flex items-center justify-between">
                          <div className="text-xl font-black text-cyan-400">৳{pkg.price}</div>
                          <button
                            onClick={() => {
                              setEditingId(pkg.id);
                              setEditName(pkg.name);
                              setEditPrice(pkg.price.toString());
                            }}
                            className="rounded-lg bg-cyan-400/10 px-3 py-1.5 text-xs font-bold text-cyan-400 transition hover:bg-cyan-400 hover:text-[#06172e]"
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
