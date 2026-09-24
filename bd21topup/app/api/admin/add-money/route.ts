import { financialAction } from "@/lib/financial-audit";
import { supabaseAdmin } from "@/lib/supabase-admin";
﻿import { NextResponse } from "next/server";
import { checkUserRole } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const VALID_ACTIONS = ["approved", "rejected", "undo"] as const;

type AdminAction = (typeof VALID_ACTIONS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidUuid(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isValidAction(value: string): value is AdminAction {
  return (VALID_ACTIONS as readonly string[]).includes(value);
}

/* =========================================================
   GET
   Load Add Money Requests
========================================================= */

export async function GET(request: Request) {
  try {
    const authCheck = await checkUserRole(
      request,
      ["super_admin", "admin", "editor"],
      "manage_add_money",
    );

    if ("error" in authCheck) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("add_money_requests")
      .select(
        `
        id,
        user_id,
        amount,
        payment_method,
        receiver_number,
        transaction_id,
        status,
        admin_note,
        created_at,
        reviewed_at,
        profiles:user_id(
          full_name,
          email,
          phone,
          wallet_balance
        )
        `,
      )
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      console.error("ADMIN ADD MONEY GET ERROR:", error);

      return NextResponse.json(
        { error: "Add Money requests load করা যায়নি।" },
        { status: 500 },
      );
    }

    const requests = (data ?? []).map((item) => {
      const profile = Array.isArray(item.profiles)
        ? item.profiles[0]
        : item.profiles;

      return {
        id: item.id,
        userId: item.user_id,
        amount: Number(item.amount ?? 0),
        paymentMethod: item.payment_method,
        receiverNumber: item.receiver_number,
        transactionId: item.transaction_id,
        status: item.status,
        adminNote: item.admin_note,
        createdAt: item.created_at,
        reviewedAt: item.reviewed_at,
        customer: {
          fullName: profile?.full_name || "BD21 User",
          email: profile?.email || "",
          phone: profile?.phone || "",
          walletBalance: Number(profile?.wallet_balance ?? 0),
        },
      };
    });

    return NextResponse.json({
      success: true,
      requests,
    });
  } catch (error) {
    console.error("ADMIN ADD MONEY GET SERVER ERROR:", error);

    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}

/* =========================================================
   PATCH
   Approve / Reject / Undo Add Money Request
========================================================= */

export async function PATCH(request: Request) {
  try {
    /* -----------------------------------------------------
       1. Authentication + permission check
    ----------------------------------------------------- */

    const authCheck = await checkUserRole(
      request,
      ["super_admin", "admin", "editor"],
      "manage_add_money",
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

    if (!isRecord(body)) {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 },
      );
    }

    const rawRequestId = body.requestId;
    const rawAction = body.action;
    const rawAdminNote = body.adminNote;

    /* -----------------------------------------------------
       3. Validate request ID
    ----------------------------------------------------- */

    if (!isValidUuid(rawRequestId)) {
      return NextResponse.json(
        { error: "Invalid request ID." },
        { status: 400 },
      );
    }

    const requestId = rawRequestId;

    /* -----------------------------------------------------
       4. Validate action
    ----------------------------------------------------- */

    if (typeof rawAction !== "string") {
      return NextResponse.json({ error: "Invalid action." }, { status: 400 });
    }

    const action = rawAction.trim().toLowerCase();

    if (!isValidAction(action)) {
      return NextResponse.json({ error: "Invalid action." }, { status: 400 });
    }

    /* -----------------------------------------------------
       5. Validate admin note
    ----------------------------------------------------- */

    if (
      rawAdminNote !== undefined &&
      rawAdminNote !== null &&
      typeof rawAdminNote !== "string"
    ) {
      return NextResponse.json(
        { error: "Admin note must be text." },
        { status: 400 },
      );
    }

    const adminNote =
      typeof rawAdminNote === "string" ? rawAdminNote.trim() : "";

    if (adminNote.length > 500) {
      return NextResponse.json(
        {
          error: "Admin note সর্বোচ্চ ৫০০ অক্ষরের মধ্যে হতে হবে।",
        },
        { status: 400 },
      );
    }

    if (action === "rejected" && !adminNote) {
      return NextResponse.json(
        { error: "Reject করার কারণ দেওয়া বাধ্যতামূলক।" },
        { status: 400 },
      );
    }

    /* =====================================================
       UNDO
    ===================================================== */

    if (action === "undo") {
      /*
       * Financial/state transition happens inside the
       * locked database RPC.
       *
       * We intentionally do not rely on a route-level
       * status check as the security boundary.
       */

      const { data: undoResult, error: undoError } = await financialAction({ adminId: authCheck.user.id, operation: "undo_add_money", targetId: requestId, note: adminNote || null });

      if (undoError) {
        console.error("ADMIN ADD MONEY UNDO ERROR:", undoError);

        const message = undoError.message || "";

        if (message.includes("Add Money request not found")) {
          return NextResponse.json(
            { error: "Add Money request পাওয়া যায়নি।" },
            { status: 404 },
          );
        }

        if (
          message.includes("Only approved or rejected requests can be undone")
        ) {
          return NextResponse.json(
            {
              error: "শুধুমাত্র approved বা rejected request undo করা যাবে।",
            },
            { status: 409 },
          );
        }

        if (message.includes("User profile not found")) {
          return NextResponse.json(
            { error: "User profile পাওয়া যায়নি।" },
            { status: 404 },
          );
        }

        if (
          message.includes(
            "Cannot undo this request because the user wallet balance is lower than the approved amount",
          )
        ) {
          return NextResponse.json(
            {
              error:
                "এই approved request undo করার জন্য user wallet-এ পর্যাপ্ত balance নেই।",
            },
            { status: 409 },
          );
        }

        return NextResponse.json(
          {
            error: "Request undo করা যায়নি। সার্ভারে সমস্যা হয়েছে।",
          },
          { status: 500 },
        );
      }

      /*
       * RPC itself tells us whether wallet was changed.
       *
       * wallet_changed = true  -> previously approved
       * wallet_changed = false -> previously rejected
       *
       * This avoids trusting a potentially stale
       * pre-RPC status read.
       */
      const undoResultRecord = isRecord(undoResult) ? undoResult : {};

      const previousStatus =
        undoResultRecord.wallet_changed === true ? "approved" : "rejected";

      /*
       * Financial operation already succeeded.
       * Notification failure must NOT make the API pretend
       * the financial operation failed.
       */
      let notificationCreated = false;

      const { data: updatedRequest, error: requestReadError } =
        await supabaseAdmin
          .from("add_money_requests")
          .select("id, user_id, amount")
          .eq("id", requestId)
          .maybeSingle();

      if (requestReadError) {
        console.error("ADD MONEY UNDO POST-READ ERROR:", requestReadError);
      }

      if (updatedRequest?.user_id) {
        const amount = Number(updatedRequest.amount ?? 0);

        const notificationTitle =
          previousStatus === "approved"
            ? "Add Money Reversed 🔄"
            : "Add Money Request Restored 🔄";

        const notificationMessage =
          previousStatus === "approved"
            ? `Your approved Add Money request of ৳${amount.toLocaleString()} has been reversed and returned to pending status.`
            : `Your previously rejected Add Money request of ৳${amount.toLocaleString()} has been restored and is pending review.`;

        const { error: notificationError } = await supabaseAdmin
          .from("notifications")
          .insert({
            user_id: updatedRequest.user_id,
            title: notificationTitle,
            message: notificationMessage,
            type: "wallet",
            is_read: false,
          });

        if (notificationError) {
          console.error(
            "ADD MONEY UNDO NOTIFICATION ERROR:",
            notificationError,
          );
        } else {
          notificationCreated = true;
        }
      }

      return NextResponse.json({
        success: true,
        result: undoResult,
        previousStatus,
        status: "pending",
        notificationCreated,
      });
    }

    /* =====================================================
       APPROVE / REJECT
    ===================================================== */

    /*
     * This read is used for notification metadata.
     * Atomic status enforcement remains inside the RPC.
     */
    const { data: requestInfo, error: requestInfoError } = await supabaseAdmin
      .from("add_money_requests")
      .select("id, user_id, amount, payment_method, transaction_id")
      .eq("id", requestId)
      .maybeSingle();

    if (requestInfoError) {
      console.error("ADD MONEY REQUEST READ ERROR:", requestInfoError);

      return NextResponse.json(
        { error: "Add Money request load করা যায়নি।" },
        { status: 500 },
      );
    }

    if (!requestInfo) {
      return NextResponse.json(
        { error: "Add Money request পাওয়া যায়নি।" },
        { status: 404 },
      );
    }

    /* -----------------------------------------------------
       Atomic approve / reject RPC
    ----------------------------------------------------- */

    const { data: reviewResult, error: reviewError } = await financialAction({ adminId: authCheck.user.id, operation: "add_money", targetId: requestId, action: action, note: adminNote || null });

    if (reviewError) {
      console.error("ADMIN ADD MONEY REVIEW ERROR:", reviewError);

      const message = reviewError.message || "";

      if (message.includes("Add Money request not found")) {
        return NextResponse.json(
          { error: "Add Money request পাওয়া যায়নি।" },
          { status: 404 },
        );
      }

      if (message.includes("Request already reviewed")) {
        return NextResponse.json(
          {
            error: "এই Add Money request ইতোমধ্যে review করা হয়েছে।",
          },
          { status: 409 },
        );
      }

      if (message.includes("User profile not found")) {
        return NextResponse.json(
          { error: "User profile পাওয়া যায়নি।" },
          { status: 404 },
        );
      }

      if (message.includes("Invalid action")) {
        return NextResponse.json({ error: "Invalid action." }, { status: 400 });
      }

      return NextResponse.json(
        {
          error: "Request review করা যায়নি। সার্ভারে সমস্যা হয়েছে।",
        },
        { status: 500 },
      );
    }

    /* -----------------------------------------------------
       User notification
    ----------------------------------------------------- */

    let notificationTitle = "";
    let notificationMessage = "";

    if (action === "approved") {
      notificationTitle = "Wallet Updated ✅";
      notificationMessage = `Your Add Money request of ৳${Number(
        requestInfo.amount ?? 0,
      ).toLocaleString()} has been approved and added to your wallet.`;
    }

    if (action === "rejected") {
      notificationTitle = "Add Money Rejected ❌";
      notificationMessage = `Your Add Money request of ৳${Number(
        requestInfo.amount ?? 0,
      ).toLocaleString()} has been rejected.`;

      if (adminNote) {
        notificationMessage += ` Reason: ${adminNote}`;
      }
    }

    let notificationCreated = false;

    if (requestInfo.user_id && notificationTitle && notificationMessage) {
      const { error: notificationError } = await supabaseAdmin
        .from("notifications")
        .insert({
          user_id: requestInfo.user_id,
          title: notificationTitle,
          message: notificationMessage,
          type: "wallet",
          is_read: false,
        });

      if (notificationError) {
        console.error("ADD MONEY NOTIFICATION ERROR:", notificationError);
      } else {
        notificationCreated = true;
      }
    }

    return NextResponse.json({
      success: true,
      result: reviewResult,
      status: action,
      notificationCreated,
    });
  } catch (error) {
    console.error("ADMIN ADD MONEY PATCH SERVER ERROR:", error);

    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
