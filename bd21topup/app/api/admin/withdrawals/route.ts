import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function verifyAdmin(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: "Unauthorized", status: 401 };
  }

  const token = authHeader.replace("Bearer ", "").trim();
  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(token);

  if (authError || !user) {
    return { error: "Invalid session", status: 401 };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return { error: "Forbidden", status: 403 };
  }

  if (!["admin", "super_admin"].includes(profile.role)) {
    return { error: "Forbidden", status: 403 };
  }

  return { user, role: profile.role };
}

export async function PATCH(request: Request) {
  try {
    const authCheck = await verifyAdmin(request);

    if ("error" in authCheck) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status },
      );
    }

    const body = await request.json();
    const { withdrawalId, status, reason } = body;

    if (
      !withdrawalId ||
      !["approved", "rejected"].includes(status?.toLowerCase())
    ) {
      return NextResponse.json(
        { error: "Invalid parameters." },
        { status: 400 },
      );
    }

    const normalizedStatus = status.toLowerCase();

    if (normalizedStatus === "rejected" && !reason?.trim()) {
      return NextResponse.json(
        { error: "রিজেক্ট করার কারণ (Reason) উল্লেখ করা বাধ্যতামূলক।" },
        { status: 400 },
      );
    }

    const { data: withdrawalItem, error: fetchErr } = await supabaseAdmin
      .from("withdrawals")
      .select("*")
      .eq("id", withdrawalId)
      .single();

    if (fetchErr || !withdrawalItem) {
      return NextResponse.json(
        { error: "Withdrawal request পাওয়া যায়নি।" },
        { status: 404 },
      );
    }

    if (withdrawalItem.status?.toLowerCase() !== "pending") {
      return NextResponse.json(
        { error: "এই রিকোয়েস্টটি ইতিমধ্যে রিভিউ করা হয়েছে।" },
        { status: 400 },
      );
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("wallet_balance")
      .eq("id", withdrawalItem.user_id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: "ইউজারের প্রোফাইল পাওয়া যায়নি।" },
        { status: 404 },
      );
    }

    const currentBalance = Number(profile.wallet_balance);
    const withdrawalAmount = Number(withdrawalItem.amount);

    if (
      !Number.isFinite(currentBalance) ||
      !Number.isFinite(withdrawalAmount) ||
      withdrawalAmount <= 0
    ) {
      return NextResponse.json(
        { error: "Invalid wallet balance or withdrawal amount." },
        { status: 400 },
      );
    }

    if (normalizedStatus === "approved") {
      if (currentBalance < withdrawalAmount) {
        return NextResponse.json(
          { error: "ইউজারের ওয়ালেটে পর্যাপ্ত ব্যালেন্স নেই।" },
          { status: 400 },
        );
      }

      const newBalance = currentBalance - withdrawalAmount;

      const { error: balanceUpdateErr } = await supabaseAdmin
        .from("profiles")
        .update({ wallet_balance: newBalance })
        .eq("id", withdrawalItem.user_id);

      if (balanceUpdateErr) {
        console.error("WALLET BALANCE UPDATE ERROR:", balanceUpdateErr);
        return NextResponse.json(
          { error: "ওয়ালেট ব্যালেন্স আপডেট করা যায়নি।" },
          { status: 500 },
        );
      }

      const { data: updatedWithdrawal, error: withdrawUpdateErr } =
        await supabaseAdmin
          .from("withdrawals")
          .update({
            status: "approved",
            balance_after: newBalance,
          })
          .eq("id", withdrawalId)
          .eq("status", "pending")
          .select("id")
          .maybeSingle();

      if (withdrawUpdateErr) {
        console.error("WITHDRAWAL UPDATE ERROR:", withdrawUpdateErr);
        return NextResponse.json(
          { error: "ডাটাবেজ আপডেট ফেইল করেছে।" },
          { status: 500 },
        );
      }

      if (!updatedWithdrawal) {
        return NextResponse.json(
          { error: "এই withdrawal request ইতিমধ্যে review করা হয়েছে।" },
          { status: 409 },
        );
      }

      const { error: transactionError } = await supabaseAdmin
        .from("wallet_transactions")
        .insert({
          user_id: withdrawalItem.user_id,
          amount: withdrawalAmount,
          direction: "debit",
          type: "Withdrawal",
          balance_after: newBalance,
          description: `Withdrawal approved (${withdrawalItem.method || "Wallet"})`,
        });

      if (transactionError) {
        console.error("TRANSACTION INSERT ERROR:", transactionError);
        return NextResponse.json(
          {
            error:
              "Withdrawal approved হয়েছে, কিন্তু transaction history save করা যায়নি।",
          },
          { status: 500 },
        );
      }

      const { error: notificationError } = await supabaseAdmin
        .from("notifications")
        .insert({
          user_id: withdrawalItem.user_id,
          title: "Withdrawal Approved ✅",
          message: `Your withdrawal request of ৳${withdrawalAmount} has been approved and deducted from your wallet.`,
        });

      if (notificationError) {
        console.error("NOTIFICATION INSERT ERROR:", notificationError);
      }
    } else if (normalizedStatus === "rejected") {
      const { data: updatedWithdrawal, error: rejectErr } = await supabaseAdmin
        .from("withdrawals")
        .update({
          status: "rejected",
          admin_note: reason.trim(),
          balance_after: currentBalance,
        })
        .eq("id", withdrawalId)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();

      if (rejectErr) {
        console.error("WITHDRAWAL REJECT ERROR:", rejectErr);
        return NextResponse.json(
          { error: "রিজেক্ট স্ট্যাটাস সেভ হয়নি।" },
          { status: 500 },
        );
      }

      if (!updatedWithdrawal) {
        return NextResponse.json(
          { error: "এই withdrawal request ইতিমধ্যে review করা হয়েছে।" },
          { status: 409 },
        );
      }

      const { error: notificationError } = await supabaseAdmin
        .from("notifications")
        .insert({
          user_id: withdrawalItem.user_id,
          title: "Withdrawal Rejected ❌",
          message: `Your withdrawal request of ৳${withdrawalAmount} was rejected. Reason: ${reason.trim()}`,
        });

      if (notificationError) {
        console.error("NOTIFICATION INSERT ERROR:", notificationError);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Withdrawal request ${normalizedStatus} successfully.`,
    });
  } catch (err) {
    console.error("ADMIN WITHDRAWAL PATCH ERROR:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
