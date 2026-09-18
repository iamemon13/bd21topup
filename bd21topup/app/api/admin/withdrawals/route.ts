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
    const { withdrawalId, status } = body;

    if (!withdrawalId || !["approved", "rejected"].includes(status?.toLowerCase())) {
      return NextResponse.json({ error: "Invalid parameters." }, { status: 400 });
    }

    const normalizedStatus = status.toLowerCase();

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
    // APPROVED LOGIC: Approve korle balance katbe
    // ==========================================
    if (normalizedStatus === "approved") {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("wallet_balance")
        .eq("id", withdrawalItem.user_id)
        .single();

      if (!profile || Number(profile.wallet_balance) < withdrawalItem.amount) {
        return NextResponse.json({ error: "ইউজারের ওয়ালেটে পর্যাপ্ত ব্যালেন্স নেই।" }, { status: 400 });
      }

      const newBalance = Number(profile.wallet_balance) - withdrawalItem.amount;

      // Balance deduct kora
      await supabaseAdmin
        .from("profiles")
        .update({ wallet_balance: newBalance })
        .eq("id", withdrawalItem.user_id);

      // Transaction history save kora
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

      // Status update
      await supabaseAdmin
        .from("withdrawals")
        .update({ status: "approved" })
        .eq("id", withdrawalId);

      // Notification
      await supabaseAdmin
        .from("notifications")
        .insert({
          user_id: withdrawalItem.user_id,
          title: "Withdrawal Approved ✅",
          message: `Your withdrawal request of ৳${withdrawalItem.amount} has been approved and deducted from your wallet.`
        });

    } 
    // ==========================================
    // REJECTED LOGIC: Reject korle balance katbe na
    // ==========================================
    else if (normalizedStatus === "rejected") {
      await supabaseAdmin
        .from("withdrawals")
        .update({ status: "rejected" })
        .eq("id", withdrawalId);

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
