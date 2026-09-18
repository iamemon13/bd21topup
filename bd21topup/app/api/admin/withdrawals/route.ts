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

// PATCH: উইথড্রাল রিকোয়েস্ট স্ট্যাটাস আপডেট (Approve / Reject)
export async function PATCH(request: Request) {
  try {
    const authCheck = await verifyAdmin(request);
    if ("error" in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const body = await request.json();
    const { withdrawalId, status } = body;

    if (!withdrawalId || !["approved", "rejected"].includes(status?.toLowerCase())) {
      return NextResponse.json({ error: "Invalid parameters." }, { status: 400 });
    }

    const normalizedStatus = status.toLowerCase();

    // উইথড্র রিকোয়েস্ট ফেচ করা
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

    // ==========================================
    // ১. APPROVED লজিক: অ্যাপ্রুভ করলে ব্যালেন্স কাটবে
    // ==========================================
    if (normalizedStatus === "approved") {
      // ইউজারের বর্তমান ব্যালেন্স চেক করা (যাতে অ্যাপ্রুভ করার সময় পর্যাপ্ত টাকা থাকে)
      const { data: profile } = await supabaseAdmin
        .from("profiles") // আপনার ডাটাবেজ অনুযায়ী profiles বা users হবে
        .select("balance")
        .eq("id", withdrawalItem.user_id)
        .single();

      if (!profile || profile.balance < withdrawalItem.amount) {
        return NextResponse.json({ error: "ইউজারের ওয়ালেটে পর্যাপ্ত ব্যালেন্স নেই।" }, { status: 400 });
      }

      const newBalance = profile.balance - withdrawalItem.amount;

      // ব্যালেন্স কাটা হচ্ছে
      await supabaseAdmin
        .from("profiles")
        .update({ balance: newBalance })
        .eq("id", withdrawalItem.user_id);

      // ট্রানজেকশন হিস্ট্রি সেভ করা (Debit)
      await supabaseAdmin
        .from("wallet_transactions")
        .insert({
          user_id: withdrawalItem.user_id,
          amount: withdrawalItem.amount,
          type: "Withdrawal",
          description: `Withdrawal approved (${withdrawalItem.method || 'Wallet'})`,
          balance_after: newBalance
        });

      // উইথড্র স্ট্যাটাস আপডেট
      await supabaseAdmin
        .from("withdrawals")
        .update({ status: "approved" })
        .eq("id", withdrawalId);

      // নোটিফিকেশন পাঠানো
      await supabaseAdmin
        .from("notifications")
        .insert({
          user_id: withdrawalItem.user_id,
          title: "Withdrawal Approved ✅",
          message: `Your withdrawal request of ৳${withdrawalItem.amount} has been approved and deducted from your wallet.`
        });

    } 
    // ==========================================
    // ২. REJECTED লজিক: রিজেক্ট করলে শুধু স্ট্যাটাস বদলাবে, ব্যালেন্স কাটবে না
    // ==========================================
    else if (normalizedStatus === "rejected") {
      // উইথড্র স্ট্যাটাস আপডেট (রিফান্ড করার দরকার নেই, কারণ টাকা কাটাই হয়নি)
      await supabaseAdmin
        .from("withdrawals")
        .update({ status: "rejected" })
        .eq("id", withdrawalId);

      // নোটিফিকেশন পাঠানো
      await supabaseAdmin
        .from("notifications")
        .insert({
          user_id: withdrawalItem.user_id,
          title: "Withdrawal Rejected ❌",
          message: `Your withdrawal request of ৳${withdrawalItem.amount} was rejected by the admin.`
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
