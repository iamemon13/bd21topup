"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

type Package = {
  id: string;
  name: string;
  price: number;
};

export default function AdminPackages() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState<string>("");
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

  async function handleUpdatePrice(id: string) {
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
          price: Number(editPrice),
        }),
      });

      const result = await response.json();
      if (result.success) {
        alert("দাম আপডেট হয়েছে!");
        setEditingId(null);
        fetchPackages(); // আপডেট করার পর লিস্ট রিলোড হবে
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

  return (
    <main className="min-h-screen bg-[#07182f] p-5 text-white sm:p-10">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-10 flex flex-wrap items-center justify-between gap-4 border-b border-cyan-400/20 pb-5">
          <div>
            <h1 className="text-2xl font-black text-cyan-400">BD21 ADMIN</h1>
            <p className="text-sm text-slate-400">Manage Package Prices</p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/admin"
              className="rounded-lg border border-cyan-400/20 bg-[#0b2545] px-4 py-2 text-sm font-bold transition hover:border-cyan-400"
            >
              Home
            </Link>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-2 text-sm font-bold text-rose-400 transition hover:bg-rose-500 hover:text-white"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Packages Grid */}
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {packages.map((pkg) => (
            <div
              key={pkg.id}
              className="rounded-xl border border-cyan-400/20 bg-[#0b2545] p-5 transition hover:border-cyan-400"
            >
              <div className="text-lg font-bold text-cyan-300">{pkg.name}</div>

              {editingId === pkg.id ? (
                <div className="mt-4 flex gap-2">
                  <input
                    type="number"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    className="w-full rounded-lg border border-cyan-400/30 bg-[#06172e] px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
                    placeholder="New Price"
                  />
                  <button
                    onClick={() => handleUpdatePrice(pkg.id)}
                    className="rounded-lg bg-green-500 px-3 py-2 text-sm font-bold text-white transition hover:bg-green-400"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="rounded-lg bg-slate-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-slate-500"
                  >
                    X
                  </button>
                </div>
              ) : (
                <div className="mt-4 flex items-center justify-between">
                  <div className="text-2xl font-black">৳{pkg.price}</div>
                  <button
                    onClick={() => {
                      setEditingId(pkg.id);
                      setEditPrice(pkg.price.toString());
                    }}
                    className="rounded-lg bg-cyan-400/10 px-4 py-2 text-sm font-bold text-cyan-400 transition hover:bg-cyan-400 hover:text-[#06172e]"
                  >
                    Edit Price
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
