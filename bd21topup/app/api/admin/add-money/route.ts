import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkUserRole } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/* =========================================================
   GET
   Load Add Money Requests
========================================================= */

export async function GET(request: Request) {
  try {
    // শুধু super_admin এবং admin এই পেজ এক্সেস করতে পারবে
    const authCheck = await checkUserRole(request, ["super_admin", "admin"]);

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
        {
          error: "Add Money requests load করা যায়নি।",
        },
        {
          status: 500,
        },
      );
    }

    const requests = (data ?? []).map((item: any) => {
      const profile = Array.isArray(item.profiles)
        ? item.profiles[0]
        : item.profiles;

      return {
        id: item.id,
        userId: item.user_id,
        amount: Number(item.amount || 0),
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
          walletBalance: Number(profile?.wallet_balance || 0),
        },
      };
    });

    return NextResponse.json({
      success: true,
      requests,
    });
  } catch (error) {
    console.error("ADMIN ADD MONEY SERVER ERROR:", error);

    return NextResponse.json(
      {
        error: "Server error.",
      },
      {
        status: 500,
      },
    );
  }
}

/* =========================================================
   PATCH
   Approve / Reject / Undo Add Money Request
========================================================= */

export async function PATCH(request: Request) {
  try {
    const authCheck = await checkUserRole(request, ["super_admin", "admin"]);

    if ("error" in authCheck) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status },
      );
    }

    const body = await request.json();
    const requestId = String(body.requestId || "").trim();
    const action = String(body.action || "")
      .trim()
      .toLowerCase();
    const adminNote = String(body.adminNote || "").trim();

    if (!requestId) {
      return NextResponse.json(
        { error: "Request ID missing." },
        { status: 400 },
      );
    }

    const validActions = ["approved", "rejected", "undo"];

    if (!validActions.includes(action)) {
      return NextResponse.json({ error: "Invalid action." }, { status: 400 });
    }

    /* =====================================================
       UNDO
    ===================================================== */

    if (action === "undo") {
      const { data: requestInfo, error: requestInfoError } = await supabaseAdmin
        .from("add_money_requests")
        .select("id, user_id, amount, status")
        .eq("id", requestId)
        .maybeSingle();

      if (requestInfoError) {
        console.error("ADD MONEY UNDO REQUEST READ ERROR:", requestInfoError);

        return NextResponse.json(
          { error: "Add Money request load করা যায়নি।" },
          { status: 500 },
        );
      }

      if (!requestInfo) {
        return NextResponse.json(
          { error: "Add Money request পাওয়া যায়নি।" },
          { status: 404 },
        );
      }

      const previousStatus = requestInfo.status;

      if (previousStatus !== "approved" && previousStatus !== "rejected") {
        return NextResponse.json(
          { error: "শুধুমাত্র approved বা rejected request undo করা যাবে।" },
          { status: 409 },
        );
      }

      const { data: undoResult, error: undoError } = await supabaseAdmin.rpc(
        "admin_undo_add_money",
        {
          p_request_id: requestId,
          p_admin_note: adminNote || null,
        },
      );

      if (undoError) {
        console.error("ADMIN ADD MONEY UNDO ERROR:", undoError);

        return NextResponse.json(
          { error: undoError.message || "Request undo করা যায়নি।" },
          { status: 409 },
        );
      }

      if (requestInfo.user_id) {
        let notificationTitle = "Add Money Update 🔄";
        let notificationMessage = "";

        if (previousStatus === "approved") {
          notificationTitle = "Add Money Reversed 🔄";
          notificationMessage = `Your approved Add Money request of ৳${Number(
            requestInfo.amount || 0,
          ).toLocaleString()} has been reversed and returned to pending status.`;
        }

        if (previousStatus === "rejected") {
          notificationTitle = "Add Money Request Restored 🔄";
          notificationMessage = `Your previously rejected Add Money request of ৳${Number(
            requestInfo.amount || 0,
          ).toLocaleString()} has been restored and is pending review.`;
        }

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
          console.error(
            "ADD MONEY UNDO NOTIFICATION ERROR:",
            notificationError,
          );
        }
      }

      return NextResponse.json({
        success: true,
        result: undoResult,
        previousStatus,
        status: "pending",
        notificationCreated: Boolean(requestInfo.user_id),
      });
    }

    /* =====================================================
       APPROVE / REJECT
    ===================================================== */

    const { data: requestInfo, error: requestInfoError } = await supabaseAdmin
      .from("add_money_requests")
      .select("id, user_id, amount, payment_method, transaction_id, status")
      .eq("id", requestId)
      .maybeSingle();

    if (requestInfoError) {
      console.error("ADD MONEY REQUEST READ ERROR:", requestInfoError);

      return NextResponse.json(
        { error: "Add Money request load করা যায়নি।" },
        { status: 500 },
      );
    }

    if (!requestInfo) {
      return NextResponse.json(
        { error: "Add Money request পাওয়া যায়নি।" },
        { status: 404 },
      );
    }

    if (
      requestInfo.status === "approved" ||
      requestInfo.status === "rejected"
    ) {
      return NextResponse.json(
        { error: `এই request ইতোমধ্যে ${requestInfo.status} হয়েছে।` },
        { status: 409 },
      );
    }

    const { data: reviewResult, error: reviewError } = await supabaseAdmin.rpc(
      "admin_review_add_money",
      {
        p_request_id: requestId,
        p_action: action,
        p_admin_note: adminNote || null,
      },
    );

    if (reviewError) {
      console.error("ADMIN ADD MONEY REVIEW ERROR:", reviewError);

      return NextResponse.json(
        { error: reviewError.message || "Request review করা যায়নি।" },
        { status: 500 },
      );
    }

    let notificationTitle = "";
    let notificationMessage = "";

    if (action === "approved") {
      notificationTitle = "Wallet Updated ✅";
      notificationMessage = `Your Add Money request of ৳${Number(
        requestInfo.amount || 0,
      ).toLocaleString()} has been approved and added to your wallet.`;
    }

    if (action === "rejected") {
      notificationTitle = "Add Money Rejected ❌";
      notificationMessage = `Your Add Money request of ৳${Number(
        requestInfo.amount || 0,
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

      if (!notificationError) {
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
