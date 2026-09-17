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
  created_at: string;
};

export default function AdminUsersPage() {
  const router = useRouter();

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  const [amount, setAmount] = useState("");
  const [action, setAction] = useState<"add" | "remove">("add");
  const [note, setNote] = useState("");

  // =====================================================
  // SEARCH
  // =====================================================

  const [search, setSearch] = useState("");

  // =====================================================
  // LOAD USERS
  // =====================================================

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

      const res = await fetch("/api/admin/users", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        cache: "no-store",
      });

      if (!res.ok) {
        console.error("Users API error:", res.status);
        return;
      }

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

  // =====================================================
  // LOGOUT
  // =====================================================

  async function logout() {
    try {
      await supabase.auth.signOut();

      router.replace("/login");
      router.refresh();
    } catch (error) {
      console.error("Admin logout error:", error);

      router.replace("/login");
    }
  }

  // =====================================================
  // SEARCH FILTER
  // =====================================================

  const filteredUsers = useMemo(() => {
    const searchText = search.trim().toLowerCase();

    if (!searchText) {
      return users;
    }

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

  // =====================================================
  // UPDATE WALLET
  // =====================================================

  async function updateWallet() {
    if (!selectedUser) {
      return;
    }

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
      // Get current admin session
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        alert("Admin session expired. Please login again.");
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
        alert("Wallet updated successfully");

        setSelectedUser(null);
        setAmount("");
        setNote("");
        setAction("add");

        await loadUsers();
      } else {
        alert(data.error || "Wallet update failed");
      }
    } catch (error) {
      console.error("Wallet update error:", error);

      alert("Server error.");
    }
  }
  // =====================================================
  // CLOSE MODAL
  // =====================================================

  function closeWalletModal() {
    setSelectedUser(null);
    setAmount("");
    setNote("");
    setAction("add");
  }
    return (
    <main
      className="
        min-h-screen
        w-full
        min-w-0
        overflow-x-hidden
        bg-[#07182f]
        p-4
        text-white
      "
    >
      <div
        className="
          mx-auto
          w-full
          max-w-5xl
        "
      >
        {/* =================================================
            HEADER
        ================================================= */}

        <div
          className="
            rounded-2xl
            border
            border-cyan-400/20
            bg-[#0b2545]
            p-5
          "
        >
          <div
            className="
              flex
              items-start
              justify-between
              gap-3
            "
          >
            {/* TITLE */}

            <div className="min-w-0">
              <h1
                className="
                  text-3xl
                  font-black
                  text-cyan-400
                "
              >
                BD21 Users
              </h1>

              <p
                className="
                  mt-2
                  text-sm
                  text-slate-400
                "
              >
                User management page
              </p>
            </div>

            {/* HEADER BUTTONS */}

            <div
              className="
                flex
                shrink-0
                flex-wrap
                justify-end
                gap-2
              "
            >
              {/* REFRESH */}

              <button
                type="button"
                onClick={loadUsers}
                disabled={loading}
                className="
                  rounded-xl
                  border
                  border-cyan-400/30
                  px-3
                  py-2
                  text-xs
                  font-bold
                  text-cyan-300
                  transition
                  hover:bg-cyan-400/10
                  disabled:cursor-not-allowed
                  disabled:opacity-50
                "
              >
                {loading ? "Loading..." : "Refresh"}
              </button>

              {/* HOME */}

              <Link
                href="/admin"
                className="
                  rounded-xl
                  border
                  border-cyan-400/20
                  px-3
                  py-2
                  text-xs
                  font-bold
                  text-cyan-300
                  transition
                  hover:bg-cyan-400/10
                "
              >
                Home
              </Link>

              {/* LOGOUT */}

              <button
                type="button"
                onClick={logout}
                className="
                  rounded-xl
                  bg-cyan-400
                  px-3
                  py-2
                  text-xs
                  font-black
                  text-[#06172e]
                  transition
                  hover:opacity-90
                "
              >
                Logout
              </button>
            </div>
          </div>

          {/* =================================================
              SEARCH
          ================================================= */}

          <div
            className="
              relative
              mt-5
            "
          >
            <span
              className="
                pointer-events-none
                absolute
                left-3
                top-1/2
                -translate-y-1/2
                text-sm
                text-slate-500
              "
            >
              🔍
            </span>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, phone, user ID..."
              className="
                h-11
                w-full
                rounded-xl
                border
                border-cyan-400/20
                bg-[#07182f]
                pl-10
                pr-10
                text-sm
                text-white
                outline-none
                placeholder:text-slate-600
                focus:border-cyan-400/50
              "
            />

            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="
                  absolute
                  right-3
                  top-1/2
                  -translate-y-1/2
                  text-sm
                  text-slate-400
                  hover:text-white
                "
              >
                ✕
              </button>
            )}
          </div>

          {!loading && (
            <p
              className="
                mt-2
                text-[10px]
                text-slate-500
              "
            >
              Showing {filteredUsers.length} of {users.length} users
            </p>
          )}
        </div>

        {/* =================================================
            USERS
        ================================================= */}

        <div
          className="
            mt-5
            space-y-4
          "
        >
          {/* LOADING */}

          {loading && (
            <div
              className="
                rounded-2xl
                border
                border-cyan-400/20
                bg-[#0b2545]
                p-5
                text-center
                text-sm
                text-slate-400
              "
            >
              Loading users...
            </div>
          )}

          {/* NO USERS */}

          {!loading && users.length === 0 && (
            <div
              className="
                rounded-2xl
                border
                border-cyan-400/20
                bg-[#0b2545]
                p-5
                text-center
                text-sm
                text-slate-400
              "
            >
              No users found.
            </div>
          )}

          {/* NO SEARCH RESULT */}

          {!loading && users.length > 0 && filteredUsers.length === 0 && (
            <div
              className="
                  rounded-2xl
                  border
                  border-white/10
                  bg-[#0b2545]
                  p-8
                  text-center
                "
            >
              <div className="text-3xl">🔍</div>

              <p
                className="
                    mt-3
                    text-sm
                    font-bold
                    text-slate-300
                  "
              >
                No matching users found
              </p>

              <button
                type="button"
                onClick={() => setSearch("")}
                className="
                    mt-4
                    rounded-lg
                    bg-cyan-400
                    px-4
                    py-2
                    text-xs
                    font-black
                    text-black
                  "
              >
                Clear Search
              </button>
            </div>
          )}

          {/* USER CARDS */}

          {filteredUsers.map((user) => (
            <div
              key={user.id}
              className="
                rounded-2xl
                border
                border-cyan-400/20
                bg-[#0b2545]
                p-5
              "
            >
              {/* USER INFO */}

              <div
                className="
                  flex
                  items-start
                  justify-between
                  gap-3
                "
              >
                <div className="min-w-0">
                  <h2
                    className="
                      truncate
                      text-xl
                      font-bold
                    "
                  >
                    {user.full_name || "Unknown"}
                  </h2>

                  <p
                    className="
                      mt-1
                      break-all
                      text-sm
                      text-slate-300
                    "
                  >
                    {user.email || "No email"}
                  </p>

                  <p
                    className="
                      mt-1
                      text-sm
                      text-slate-400
                    "
                  >
                    {user.phone || "No phone"}
                  </p>
                </div>

                {user.role && (
                  <span
                    className="
                      shrink-0
                      rounded-full
                      border
                      border-cyan-400/20
                      bg-cyan-400/10
                      px-2
                      py-1
                      text-[9px]
                      font-black
                      uppercase
                      text-cyan-300
                    "
                  >
                    {user.role}
                  </span>
                )}
              </div>

              {/* USER ID */}

              <div
                className="
                  mt-3
                  rounded-xl
                  bg-[#07182f]
                  p-3
                "
              >
                <p
                  className="
                    text-[9px]
                    font-bold
                    uppercase
                    text-slate-500
                  "
                >
                  User ID
                </p>

                <p
                  className="
                    mt-1
                    break-all
                    font-mono
                    text-[10px]
                    text-slate-300
                  "
                >
                  {user.id}
                </p>
              </div>

              {/* WALLET */}

              <div
                className="
                  mt-3
                  rounded-xl
                  border
                  border-cyan-400/10
                  bg-[#07182f]
                  p-4
                "
              >
                <p
                  className="
                    text-[10px]
                    font-bold
                    uppercase
                    text-slate-500
                  "
                >
                  Wallet Balance
                </p>

                <p
                  className="
                    mt-1
                    text-2xl
                    font-black
                    text-cyan-400
                  "
                >
                  ৳{Number(user.wallet_balance ?? 0).toLocaleString("en-BD")}
                </p>
              </div>

              {/* MANAGE WALLET */}

              <button
                type="button"
                onClick={() => {
                  setSelectedUser(user);
                  setAmount("");
                  setNote("");
                  setAction("add");
                }}
                className="
                  mt-4
                  w-full
                  rounded-xl
                  bg-cyan-400
                  py-3
                  font-bold
                  text-black
                  transition
                  hover:opacity-90
                "
              >
                Manage Wallet
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* =====================================================
          WALLET MODAL
      ===================================================== */}

      {selectedUser && (
        <div
          className="
            fixed
            inset-0
            z-[99999]
            flex
            items-center
            justify-center
            bg-black/70
            p-5
          "
        >
          <div
            className="
              max-h-[90vh]
              w-full
              max-w-md
              overflow-y-auto
              rounded-2xl
              border
              border-cyan-400/30
              bg-[#0b2545]
              p-5
              shadow-2xl
            "
          >
            {/* MODAL HEADER */}

            <div
              className="
                flex
                items-start
                justify-between
                gap-3
              "
            >
              <div>
                <h2
                  className="
                    text-xl
                    font-bold
                    text-cyan-400
                  "
                >
                  Manage Wallet
                </h2>

                <p
                  className="
                    mt-1
                    text-sm
                    text-slate-300
                  "
                >
                  {selectedUser.full_name || "Unknown User"}
                </p>
              </div>

              <button
                type="button"
                onClick={closeWalletModal}
                className="
                  rounded-lg
                  bg-slate-700
                  px-3
                  py-1
                  text-sm
                  font-bold
                "
              >
                ✕
              </button>
            </div>

            {/* CURRENT BALANCE */}

            <div
              className="
                mt-4
                rounded-xl
                bg-[#07182f]
                p-4
              "
            >
              <p
                className="
                  text-[10px]
                  font-bold
                  uppercase
                  text-slate-500
                "
              >
                Current Balance
              </p>

              <p
                className="
                  mt-1
                  text-2xl
                  font-black
                  text-cyan-400
                "
              >
                ৳
                {Number(selectedUser.wallet_balance ?? 0).toLocaleString(
                  "en-BD",
                )}
              </p>
            </div>

            {/* AMOUNT */}

            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="
                mt-4
                w-full
                rounded-xl
                border
                border-white/10
                bg-[#07182f]
                p-3
                text-white
                outline-none
                placeholder:text-slate-600
                focus:border-cyan-400/50
              "
            />

            {/* ADD / REMOVE */}

            <div
              className="
                mt-3
                flex
                gap-3
              "
            >
              <button
                type="button"
                onClick={() => setAction("add")}
                className={`
                  flex-1
                  rounded-xl
                  py-3
                  font-black
                  ${
                    action === "add"
                      ? "bg-cyan-400 text-black"
                      : "bg-gray-700 text-white"
                  }
                `}
              >
                Add
              </button>

              <button
                type="button"
                onClick={() => setAction("remove")}
                className={`
                  flex-1
                  rounded-xl
                  py-3
                  font-black
                  ${
                    action === "remove"
                      ? "bg-red-500 text-white"
                      : "bg-gray-700 text-white"
                  }
                `}
              >
                Remove
              </button>
            </div>

            {/* NOTE */}

            <textarea
              placeholder="Admin note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="
                mt-3
                h-24
                w-full
                resize-none
                rounded-xl
                border
                border-white/10
                bg-[#07182f]
                p-3
                text-sm
                text-white
                outline-none
                placeholder:text-slate-600
                focus:border-cyan-400/50
              "
            />

            {/* CONFIRM */}

            <button
              type="button"
              onClick={updateWallet}
              className={`
                mt-4
                w-full
                rounded-xl
                py-3
                font-black
                ${
                  action === "remove"
                    ? "bg-red-500 text-white"
                    : "bg-cyan-400 text-black"
                }
              `}
            >
              {action === "remove" ? "Confirm Remove" : "Confirm Add"}
            </button>

            {/* CANCEL */}

            <button
              type="button"
              onClick={closeWalletModal}
              className="
                mt-2
                w-full
                rounded-xl
                bg-gray-700
                py-2
                font-bold
                text-white
              "
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
