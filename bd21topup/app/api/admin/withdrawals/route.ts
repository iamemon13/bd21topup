import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkUserRole } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/* =========================================================
   GET: Load Withdrawal Requests
========================================================= */
export async function GET(request: Request) {
  try {
    // 🔒 PERMISSION FIX: Admin/Editor must have "manage_withdrawals" permission
    const authCheck = await checkUserRole(request, ["super_admin", "admin", "editor"], "manage_withdrawals");

    if ("error" in authCheck) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("withdrawals")
      .select(`
        id,
        user_id,
        amount,
        method,
        account_number,
        status,
        admin_note,
        balance_after,
        created_at
      `)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("ADMIN WITHDRAWALS GET ERROR:", error);
      return NextResponse.json(
        { error: "Withdrawal requests load করা যায়নি।" },
        { status: 500 },
      );
    }

    const withdrawals = (data ?? []).map((item: any) => ({
      id: item.id,
      userId: item.user_id,
      amount: Number(item.amount || 0),
      method: item.method,
      accountNumber: item.account_number,
      status: item.status,
      adminNote: item.admin_note,
      balanceAfter: Number(item.balance_after || 0),
      createdAt: item.created_at,
    }));

    return NextResponse.json({
      success: true,
      withdrawals,
    });
  } catch (error) {
    console.error("ADMIN WITHDRAWALS GET SERVER ERROR:", error);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}

/* =========================================================
   PATCH: Approve / Reject Withdrawal Request
========================================================= */
export async function PATCH(request: Request) {
  try {
    // 🔒 PERMISSION FIX: Admin/Editor must have "manage_withdrawals" permission
    const authCheck = await checkUserRole(request, ["super_admin", "admin", "editor"], "manage_withdrawals");

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
      !["approved", "rejected"].includes(
        typeof status === "string" ? status.toLowerCase() : "",
      )
    ) {
      return NextResponse.json(
        { error: "Invalid parameters." },
        { status: 400 },
      );
    }

    const normalizedStatus = status.toLowerCase();
    const normalizedReason =
      typeof reason === "string" ? reason.trim() : "";

    if (normalizedStatus === "rejected" && !normalizedReason) {
      return NextResponse.json(
        { error: "বাতিল করার সঠিক কারণ (Reason) উল্লেখ করা বাধ্যতামূলক।" },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin.rpc(
      "admin_review_withdrawal",
      {
        p_withdrawal_id: withdrawalId,
        p_action: normalizedStatus,
        p_admin_note: normalizedReason || null,
      },
    );

    if (error) {
      console.error("ADMIN WITHDRAWAL RPC ERROR:", error);
      const message = error.message || "";

      if (message === "Withdrawal request not found") {
        return NextResponse.json(
          { error: "Withdrawal request পাওয়া যায়নি।" },
          { status: 404 },
        );
      }
      if (message === "Withdrawal request already reviewed") {
        return NextResponse.json(
          { error: "এই রিকোয়েস্টটি আগেই রিভিউ করা হয়েছে।" },
          { status: 400 },
        );
      }
      if (message === "Insufficient wallet balance") {
        return NextResponse.json(
          { error: "ইউজারের ওয়ালেটে পর্যাপ্ত ব্যালেন্স নেই।" },
          { status: 400 },
        );
      }
      if (message === "User profile not found") {
        return NextResponse.json(
          { error: "ইউজার প্রোফাইল পাওয়া যায়নি।" },
          { status: 404 },
        );
      }
      if (message === "Invalid withdrawal amount") {
        return NextResponse.json(
          { error: "Invalid withdrawal amount." },
          { status: 400 },
        );
      }
      if (message === "Rejection reason is required") {
        return NextResponse.json(
          { error: "বাতিল করার সঠিক কারণ (Reason) উল্লেখ করা বাধ্যতামূলক।" },
          { status: 400 },
        );
      }

      return NextResponse.json(
        { error: "Withdrawal review failed." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: `Withdrawal request ${normalizedStatus} successfully.`,
      data,
    });
  } catch (err) {
    console.error("ADMIN WITHDRAWAL PATCH ERROR:", err);
    return NextResponse.json(
      { error: "Server error." },
      { status: 500 },
    );
  }
}
