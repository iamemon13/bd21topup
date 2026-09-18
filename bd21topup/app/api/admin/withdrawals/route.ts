import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function verifyAdmin(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: "Unauthorized", status: 401 };
  }

  const token = authHeader.replace("Bearer ", "").trim();
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return { error: "Invalid session", status: 401 };
  }

  return { user };
}

export async function PATCH(request: Request) {
  try {
    const authCheck = await verifyAdmin(request);
    if ("error" in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const body = await request.json();
    const { withdrawalId, status, reason } = body; // reason যুক্ত করা হয়েছে

    if (!withdrawalId || !["approved", "rejected"].includes(status?.toLowerCase())) {
      return NextResponse.json({ error: "Invalid parameters." }, { status: 400 });
    }

    const normalizedStatus = status.toLowerCase();

    // রিজেক্ট হলে অবশ্যই কারণ (reason) দিতে হবে
    if (normalizedStatus === "rejected" && !reason) {
      return NextResponse.json({ error: "রিজেক্ট করার কারণ (Reason) উল্লেখ করা বাধ্যতামূলক।" }, { status: 400 });
    }

    const { data: withdrawalItem, error: fetchErr } = await supabaseAdmin
      .from("withdrawals")
      .select("*")
      .eq("id", withdrawalId)
      .single();

    if (fetchErr || !withdrawalItem) {
      return NextResponse.json({ error: "Withdrawal request পাওয়া যায়নি।" }, { status: 404 });
    }

    if (withdrawalItem.status.toLowerCase() !== "pending") {
      return NextResponse.json({ error: "এই রিকোয়েস্টটি ইতিমধ্যে রিভিউ করা হয়েছে।" }, { status: 400 });
    }

    // ইউজারের বর্তমান ব্যালেন্স চেক করা
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("wallet_balance")
      .eq("id", withdrawalItem.user_id)
      .single();

    const currentBalance = profile ? Number(profile.wallet_balance) : 0;

    // ==========================================
    // APPROVED LOGIC
    // ==========================================
    if (normalizedStatus === "approved") {
      if (currentBalance < withdrawalItem.amount) {
        return NextResponse.json({ error: "ইউজারের ওয়ালেটে পর্যাপ্ত ব্যালেন্স নেই।" }, { status: 400 });
      }

      const newBalance = currentBalance - withdrawalItem.amount;

      // ১. ব্যালেন্স কাটা হচ্ছে
      await supabaseAdmin
        .from("profiles")
        .update({ wallet_balance: newBalance })
        .eq("id", withdrawalItem.user_id);

      // ২. উইথড্র স্ট্যাটাস এবং balance_after আপডেট
      await supabaseAdmin
        .from("withdrawals")
        .update({ 
          status: "approved",
          balance_after: newBalance // UI-তে সঠিক ব্যালেন্স দেখানোর জন্য
        })
        .eq("id", withdrawalId);

      // ৩. ট্রানজেকশন হিস্ট্রি সেভ করা
      await supabaseAdmin
        .from("wallet_transactions")
        .insert({
          user_id: withdrawalItem.user_id,
          amount: withdrawalItem.amount,
          direction: "debit",
          type: "Withdrawal",
          balance_after: newBalance,
          description: `Withdrawal approved (${withdrawalItem.method || 'Wallet'})`
        });

      // ৪. নোটিফিকেশন পাঠানো
      await supabaseAdmin
        .from("notifications")
        .insert({
          user_id: withdrawalItem.user_id,
          title: "Withdrawal Approved ✅",
          message: `Your withdrawal request of ৳${withdrawalItem.amount} has been approved and deducted from your wallet.`
        });

    } 
    // ==========================================
    // REJECTED LOGIC
    // ==========================================
    else if (normalizedStatus === "rejected") {
      // ১. উইথড্র স্ট্যাটাস আপডেট (admin_note এ reason সেভ করা হচ্ছে)
      await supabaseAdmin
        .from("withdrawals")
        .update({ 
          status: "rejected",
          admin_note: reason, // ডাটাবেজে কারণ সেভ থাকবে
          balance_after: currentBalance // ব্যালেন্স কাটেনি, তাই আগের ব্যালেন্সই থাকবে
        })
        .eq("id", withdrawalId);

      // ২. নোটিফিকেশন পাঠানো (কারণ সহ)
      await supabaseAdmin
        .from("notifications")
        .insert({
          user_id: withdrawalItem.user_id,
          title: "Withdrawal Rejected ❌",
          message: `Your withdrawal request of ৳${withdrawalItem.amount} was rejected. Reason: ${reason}`
        });
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
