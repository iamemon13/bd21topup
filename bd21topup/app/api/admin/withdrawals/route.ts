import { financialAction } from "@/lib/financial-audit";
import { supabaseAdmin } from "@/lib/supabase-admin";
﻿import { NextResponse } from "next/server";
import { checkUserRole } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = ["approved", "rejected"] as const;

type ReviewStatus = (typeof ALLOWED_STATUSES)[number];

function isValidUuid(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isValidReviewStatus(value: string): value is ReviewStatus {
  return (ALLOWED_STATUSES as readonly string[]).includes(value);
}

/* =========================================================
   GET: Load Withdrawal Requests
========================================================= */

export async function GET(request: Request) {
  try {
    const authCheck = await checkUserRole(
      request,
      ["super_admin", "admin", "editor"],
      "manage_withdrawals",
    );

    if ("error" in authCheck) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("withdrawals")
      .select(
        `
        id,
        user_id,
        amount,
        method,
        account_number,
        status,
        admin_note,
        balance_after,
        created_at
      `,
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.error("ADMIN WITHDRAWALS GET ERROR:", error);

      return NextResponse.json(
        { error: "Withdrawal requests load করা যায়নি।" },
        { status: 500 },
      );
    }

    const withdrawals = (data ?? []).map((item) => ({
      id: item.id,
      userId: item.user_id,
      amount: Number(item.amount ?? 0),
      method: item.method,
      accountNumber: item.account_number,
      status: item.status,
      adminNote: item.admin_note,
      balanceAfter: Number(item.balance_after ?? 0),
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
    /* -----------------------------------------------------
       1. Authentication + permission check
    ----------------------------------------------------- */

    const authCheck = await checkUserRole(
      request,
      ["super_admin", "admin", "editor"],
      "manage_withdrawals",
    );

    if ("error" in authCheck) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status },
      );
    }

    /* -----------------------------------------------------
       2. Parse JSON safely
    ----------------------------------------------------- */

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400 },
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 },
      );
    }

    const requestBody = body as Record<string, unknown>;

    const withdrawalId = requestBody.withdrawalId;
    const rawStatus = requestBody.status;
    const rawReason = requestBody.reason;

    /* -----------------------------------------------------
       3. Validate withdrawal ID
    ----------------------------------------------------- */

    if (!isValidUuid(withdrawalId)) {
      return NextResponse.json(
        { error: "Invalid withdrawal ID." },
        { status: 400 },
      );
    }

    /* -----------------------------------------------------
       4. Validate status
    ----------------------------------------------------- */

    if (typeof rawStatus !== "string") {
      return NextResponse.json(
        { error: "Invalid withdrawal status." },
        { status: 400 },
      );
    }

    const normalizedStatus = rawStatus.trim().toLowerCase();

    if (!isValidReviewStatus(normalizedStatus)) {
      return NextResponse.json(
        {
          error: "Invalid status. Only approved or rejected is allowed.",
        },
        { status: 400 },
      );
    }

    /* -----------------------------------------------------
       5. Validate admin reason / note
    ----------------------------------------------------- */

    if (
      rawReason !== undefined &&
      rawReason !== null &&
      typeof rawReason !== "string"
    ) {
      return NextResponse.json(
        { error: "Reason must be text." },
        { status: 400 },
      );
    }

    const normalizedReason =
      typeof rawReason === "string" ? rawReason.trim() : "";

    if (normalizedReason.length > 500) {
      return NextResponse.json(
        {
          error: "Reason সর্বোচ্চ ৫০০ অক্ষরের মধ্যে হতে হবে।",
        },
        { status: 400 },
      );
    }

    if (normalizedStatus === "rejected" && !normalizedReason) {
      return NextResponse.json(
        {
          error: "বাতিল করার সঠিক কারণ (Reason) উল্লেখ করা বাধ্যতামূলক।",
        },
        { status: 400 },
      );
    }

    /* -----------------------------------------------------
       6. Atomic database review
    ----------------------------------------------------- */

    const { data, error } = await financialAction({ adminId: authCheck.user.id, operation: "withdrawal", targetId: withdrawalId, action: normalizedStatus, note: normalizedReason || null });

    if (error) {
      console.error("ADMIN WITHDRAWAL RPC ERROR:", error);

      const message = error.message || "";

      if (message.includes("Withdrawal request not found")) {
        return NextResponse.json(
          { error: "Withdrawal request পাওয়া যায়নি।" },
          { status: 404 },
        );
      }

      if (message.includes("Withdrawal request already reviewed")) {
        return NextResponse.json(
          {
            error: "এই Withdrawal request-টি আগেই review করা হয়েছে।",
          },
          { status: 409 },
        );
      }

      if (message.includes("User profile not found")) {
        return NextResponse.json(
          { error: "ইউজার প্রোফাইল পাওয়া যায়নি।" },
          { status: 404 },
        );
      }

      if (message.includes("Invalid withdrawal amount")) {
        return NextResponse.json(
          { error: "Invalid withdrawal amount." },
          { status: 400 },
        );
      }

      if (message.includes("Rejection reason is required")) {
        return NextResponse.json(
          {
            error: "বাতিল করার সঠিক কারণ (Reason) উল্লেখ করা বাধ্যতামূলক।",
          },
          { status: 400 },
        );
      }

      if (message.includes("Invalid action")) {
        return NextResponse.json(
          { error: "Invalid withdrawal action." },
          { status: 400 },
        );
      }

      return NextResponse.json(
        { error: "Withdrawal review failed." },
        { status: 500 },
      );
    }

    /* -----------------------------------------------------
       8. Success response
    ----------------------------------------------------- */

    return NextResponse.json({
      success: true,
      message: `Withdrawal request ${normalizedStatus} successfully.`,
      data,
    });
  } catch (error) {
    console.error("ADMIN WITHDRAWAL PATCH ERROR:", error);

    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
