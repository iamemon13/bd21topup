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

    // উইথড্র স্ট্যাটাস আপডেট
    const { error: updateErr } = await supabaseAdmin
      .from("withdrawals")
      .update({ status: normalizedStatus })
      .eq("id", withdrawalId);

    if (updateErr) {
      console.error("WITHDRAWAL UPDATE ERROR:", updateErr);
      return NextResponse.json({ error: "স্ট্যাটাস আপডেট করতে সমস্যা হয়েছে।" }, { status: 500 });
    }

    // REFUND LOGIC: Soki eboyami (rejected), zongisa mbongo na wallet
    if (normalizedStatus === "rejected") {
      const { data: profile } = await supabaseAdmin
        .from("profiles") // Etanda ya mosaleli
        .select("balance")
        .eq("id", withdrawalItem.user_id)
        .single();

      if (profile) {
        const newBalance = (profile.balance || 0) + withdrawalItem.amount;

        // Update balance
        await supabaseAdmin
          .from("profiles")
          .update({ balance: newBalance })
          .eq("id", withdrawalItem.user_id);

        // Record transaction
        await supabaseAdmin
          .from("wallet_transactions")
          .insert({
            user_id: withdrawalItem.user_id,
            amount: withdrawalItem.amount,
            type: "Refund",
            description: "Withdrawal rejected refund (WALLET)",
            balance_after: newBalance
          });
      }
    }

    // NOTIFICATION LOGIC: Tinda mesaje mpo na mosaleli
    const notifTitle = normalizedStatus === "approved" ? "Withdrawal Approved ✅" : "Withdrawal Rejected ❌";
    const notifMessage = normalizedStatus === "approved"
      ? `Your withdrawal request of ৳${withdrawalItem.amount} has been approved.`
      : `Your withdrawal request of ৳${withdrawalItem.amount} was rejected. The amount has been refunded to your wallet.`;

    await supabaseAdmin
      .from("notifications")
      .insert({
        user_id: withdrawalItem.user_id,
        title: notifTitle,
        message: notifMessage
      });

    return NextResponse.json({
      success: true,
      message: `Withdrawal request ${normalizedStatus} successfully.`,
    });
  } catch (err) {
    console.error("ADMIN WITHDRAWAL PATCH ERROR:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
