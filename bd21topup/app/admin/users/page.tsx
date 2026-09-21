"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type User = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  wallet_balance: number | null;
  role: string | null;
  permissions: string[] | null;
  created_at: string;
};

const AVAILABLE_PERMISSIONS = [
  { id: "manage_withdrawals", label: "Manage Withdrawals" },
  { id: "manage_add_money", label: "Manage Add Money" },
  { id: "manage_users", label: "Manage Users & Wallet" },
  { id: "manage_orders", label: "Manage Orders" },
  { id: "manage_packages", label: "Manage Packages & Prices" }, // 🔒 এই লাইনটি নতুন যোগ করা হয়েছে
];

export default function AdminUsersPage() {
  const router = useRouter();

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserRole, setCurrentUserRole] = useState<string>("user");

  // Wallet State
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [amount, setAmount] = useState("");
  const [action, setAction] = useState<"add" | "remove">("add");
  const [note, setNote] = useState("");

  // Role & Permission State
  const [selectedRoleUser, setSelectedRoleUser] = useState<User | null>(null);
  const [editRole, setEditRole] = useState("user");
  const [editPermissions, setEditPermissions] = useState<string[]>([]);
  const [roleUpdating, setRoleUpdating] = useState(false);

  const [search, setSearch] = useState("");

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    try {
      setLoading(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login");
        return;
      }

      // 🔒 FIXED: Fetching current user role securely
      const roleRes = await fetch("/api/admin/role", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });

      if (roleRes.ok) {
        const roleData = await roleRes.json();
        // FIXED HERE: Check for roleData.role instead of success
        if (roleData.role) {
          setCurrentUserRole(roleData.role);
        }
      }

      const res = await fetch("/api/admin/users", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        cache: "no-store",
      });

      const data = await res.json();
      if (data.success) {
        setUsers(data.users || []);
      }
    } catch (error) {
      console.error("Users load error:", error);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    try {
      await supabase.auth.signOut();
      router.replace("/login");
    } catch (error) {
      console.error("Admin logout error:", error);
      router.replace("/login");
    }
  }

  const filteredUsers = useMemo(() => {
    const searchText = search.trim().toLowerCase();
    if (!searchText) return users;

    return users.filter((user) => {
      const searchableText = [
        user.id,
        user.full_name || "",
        user.email || "",
        user.phone || "",
        user.role || "",
      ]
        .join(" ")
        .toLowerCase();
      return searchableText.includes(searchText);
    });
  }, [users, search]);

  async function updateWallet() {
    if (!selectedUser) return;
    const numericAmount = Number(amount);

    if (
      !amount.trim() ||
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0
    ) {
      alert("Please enter a valid amount.");
      return;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        alert("Session expired. Please login again.");
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/admin/users/wallet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          userId: selectedUser.id,
          amount: numericAmount,
          action,
          note: note.trim(),
        }),
      });

      const data = await res.json();
      if (data.success) {
        alert("Wallet updated successfully ✅");
        closeWalletModal();
        await loadUsers();
      } else {
        alert(data.error || "Wallet update failed");
      }
    } catch (error) {
      console.error("Wallet update error:", error);
      alert("Server error.");
    }
  }

  function closeWalletModal() {
    setSelectedUser(null);
    setAmount("");
    setNote("");
    setAction("add");
  }

  // ==========================================
  // UPDATE ROLE & PERMISSION
  // ==========================================

  function openRoleModal(user: User) {
    setSelectedRoleUser(user);
    setEditRole(user.role || "user");
    setEditPermissions(Array.isArray(user.permissions) ? user.permissions : []);
  }

  function togglePermission(permId: string) {
    setEditPermissions((prev) =>
      prev.includes(permId)
        ? prev.filter((p) => p !== permId)
        : [...prev, permId],
    );
  }
  async function saveRoleAndPermissions() {
    if (!selectedRoleUser) return;
    setRoleUpdating(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch("/api/admin/role", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          userId: selectedRoleUser.id,
          role: editRole,
          permissions: editPermissions,
        }),
      });

      // 🔒 FIX: সরাসরি res.json() না করে আগে টেক্সট হিসেবে নিচ্ছি,
      // যাতে ব্ল্যাংক রেসপন্সে অ্যাপ ক্র্যাশ না করে।
      const responseText = await res.text();
      let data: any = {};

      if (responseText) {
        try {
          data = JSON.parse(responseText);
        } catch (e) {
          console.error("Failed to parse response:", responseText);
        }
      }

      if (res.ok && data.success) {
        alert("Role and Permissions updated successfully ✅");
        setSelectedRoleUser(null);
        await loadUsers();
      } else {
        // যদি ডাটাবেস আপডেট না হয়, তবে আসল স্ট্যাটাস কোডটি অ্যালার্টে দেখাবে
        alert(data?.error || `Update failed! Server status: ${res.status}`);
      }
    } catch (error) {
      console.error(error);
      alert("Client error during update.");
    } finally {
      setRoleUpdating(false);
    }
  }

  return (
    <main className="min-h-screen w-full min-w-0 overflow-x-hidden bg-[#07182f] p-4 text-white pb-24">
      <div className="mx-auto w-full max-w-5xl">
        <div className="rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black text-cyan-400">BD21 Users</h1>
              <p className="mt-1 text-sm text-slate-400">
                Manage users, roles, and wallets
              </p>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={loadUsers}
                disabled={loading}
                className="flex-1 sm:flex-none rounded-xl border border-cyan-400/30 px-3 py-2 text-xs font-bold text-cyan-300 transition hover:bg-cyan-400/10"
              >
                {loading ? "Loading..." : "Refresh"}
              </button>
              <Link
                href="/admin"
                className="flex-1 sm:flex-none text-center rounded-xl border border-cyan-400/20 px-3 py-2 text-xs font-bold text-cyan-300 transition hover:bg-cyan-400/10"
              >
                Home
              </Link>
              <button
                type="button"
                onClick={logout}
                className="flex-1 sm:flex-none rounded-xl bg-cyan-400 px-3 py-2 text-xs font-black text-[#06172e] transition hover:opacity-90"
              >
                Logout
              </button>
            </div>
          </div>

          <div className="relative mt-5">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
              🔍
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, phone, role..."
              className="h-11 w-full rounded-xl border border-cyan-400/20 bg-[#07182f] pl-10 pr-10 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-400/50"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>
          {!loading && (
            <p className="mt-2 text-[10px] text-slate-500">
              Showing {filteredUsers.length} of {users.length} users
            </p>
          )}
        </div>

        <div className="mt-5 space-y-4">
          {loading && (
            <div className="rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-5 text-center text-sm text-slate-400">
              Loading users...
            </div>
          )}

          {!loading && users.length > 0 && filteredUsers.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-[#0b2545] p-8 text-center">
              <div className="text-3xl">🔍</div>
              <p className="mt-3 text-sm font-bold text-slate-300">
                No matching users found
              </p>
            </div>
          )}

          {filteredUsers.map((user) => (
            <div
              key={user.id}
              className="rounded-2xl border border-cyan-400/20 bg-[#0b2545] p-5 flex flex-col sm:flex-row gap-4 justify-between"
            >
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="truncate text-xl font-bold">
                    {user.full_name || "Unknown"}
                  </h2>
                  {user.role && (
                    <span
                      className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-black uppercase ${
                        user.role === "super_admin"
                          ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                          : user.role === "admin"
                            ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-300"
                            : user.role === "editor"
                              ? "border-purple-400/20 bg-purple-400/10 text-purple-300"
                              : "border-slate-400/20 bg-slate-400/10 text-slate-300"
                      }`}
                    >
                      {user.role.replace("_", " ")}
                    </span>
                  )}
                </div>

                <p className="text-sm text-slate-300">
                  {user.email || "No email"}
                </p>
                <p className="text-sm text-slate-400">
                  {user.phone || "No phone"}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-500 bg-[#07182f] px-2 py-1 rounded">
                    ID: {user.id}
                  </span>
                </div>
              </div>

              <div className="flex flex-col sm:items-end gap-3 min-w-[200px]">
                <div className="rounded-xl border border-cyan-400/10 bg-[#07182f] p-3 text-center sm:text-right w-full">
                  <p className="text-[10px] font-bold uppercase text-slate-500">
                    Wallet Balance
                  </p>
                  <p className="mt-1 text-2xl font-black text-cyan-400">
                    ৳{Number(user.wallet_balance ?? 0).toLocaleString("en-BD")}
                  </p>
                </div>

                <div className="flex gap-2 w-full">
                  {currentUserRole === "super_admin" && (
                    <button
                      type="button"
                      onClick={() => openRoleModal(user)}
                      className="flex-1 rounded-xl bg-purple-500/20 border border-purple-500/30 py-2 text-xs font-bold text-purple-300 transition hover:bg-purple-500/30"
                    >
                      Permissions
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedUser(user);
                      setAmount("");
                      setNote("");
                      setAction("add");
                    }}
                    className="flex-1 rounded-xl bg-cyan-400 py-2 text-xs font-bold text-black transition hover:opacity-90"
                  >
                    Wallet
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* =====================================================
          ROLE & PERMISSION MODAL (ONLY FOR SUPER ADMIN)
      ===================================================== */}
      {selectedRoleUser && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-purple-400/30 bg-[#0b2545] p-5 shadow-2xl">
            <div className="flex justify-between mb-4">
              <h2 className="text-xl font-bold text-purple-400">
                Manage Role & Permissions
              </h2>
              <button
                onClick={() => setSelectedRoleUser(null)}
                className="rounded-lg bg-slate-700 px-3 py-1 text-sm font-bold text-white hover:bg-slate-600"
              >
                ✕
              </button>
            </div>
            <p className="text-sm text-slate-300 mb-4">
              {selectedRoleUser.full_name || selectedRoleUser.email}
            </p>

            <div className="mb-4">
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-2">
                User Role
              </label>
              <select
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-[#07182f] p-3 text-sm text-white outline-none focus:border-purple-400/50"
              >
                <option value="user">User</option>
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>

            {(editRole === "admin" || editRole === "editor") && (
              <div className="mb-4">
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-2">
                  Specific Permissions
                </label>
                <div className="space-y-2 rounded-xl bg-[#07182f] p-3 border border-white/10">
                  {AVAILABLE_PERMISSIONS.map((perm) => (
                    <label
                      key={perm.id}
                      className="flex items-center gap-3 cursor-pointer p-2 hover:bg-white/5 rounded-lg transition"
                    >
                      <input
                        type="checkbox"
                        checked={editPermissions.includes(perm.id)}
                        onChange={() => togglePermission(perm.id)}
                        className="w-4 h-4 rounded accent-purple-400"
                      />
                      <span className="text-sm font-bold text-slate-300">
                        {perm.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={saveRoleAndPermissions}
              disabled={roleUpdating}
              className="w-full rounded-xl bg-purple-500 py-3 font-black text-white hover:bg-purple-600 disabled:opacity-50 mt-2"
            >
              {roleUpdating ? "Saving..." : "Save Role & Permissions"}
            </button>
          </div>
        </div>
      )}

      {/* =====================================================
          WALLET MODAL
      ===================================================== */}
      {selectedUser && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-cyan-400/30 bg-[#0b2545] p-5 shadow-2xl">
            <div className="flex justify-between mb-2">
              <h2 className="text-xl font-bold text-cyan-400">Manage Wallet</h2>
              <button
                onClick={closeWalletModal}
                className="rounded-lg bg-slate-700 px-3 py-1 text-sm font-bold"
              >
                ✕
              </button>
            </div>
            <p className="text-sm text-slate-300 mb-4">
              {selectedUser.full_name}
            </p>

            <div className="rounded-xl bg-[#07182f] p-4 text-center border border-white/5">
              <p className="text-[10px] font-bold uppercase text-slate-500">
                Current Balance
              </p>
              <p className="text-2xl font-black text-cyan-400 mt-1">
                ৳
                {Number(selectedUser.wallet_balance ?? 0).toLocaleString(
                  "en-BD",
                )}
              </p>
            </div>

            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-4 w-full rounded-xl border border-white/10 bg-[#07182f] p-3 text-white outline-none focus:border-cyan-400/50"
            />

            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={() => setAction("add")}
                className={`flex-1 rounded-xl py-3 font-black ${action === "add" ? "bg-cyan-400 text-black" : "bg-gray-700 text-white"}`}
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setAction("remove")}
                className={`flex-1 rounded-xl py-3 font-black ${action === "remove" ? "bg-red-500 text-white" : "bg-gray-700 text-white"}`}
              >
                Remove
              </button>
            </div>

            <textarea
              placeholder="Admin note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-3 h-20 w-full resize-none rounded-xl border border-white/10 bg-[#07182f] p-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-400/50"
            />

            <button
              type="button"
              onClick={updateWallet}
              className={`mt-4 w-full rounded-xl py-3 font-black ${action === "remove" ? "bg-red-500 text-white" : "bg-cyan-400 text-black"}`}
            >
              {action === "remove" ? "Confirm Remove" : "Confirm Add"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
