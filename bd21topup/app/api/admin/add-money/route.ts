import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function requireAdmin(request: Request) {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return {
      user: null,
      response: NextResponse.json(
        {
          error: "Admin login required.",
        },
        {
          status: 401,
        },
      ),
    };
  }

  const accessToken = authHeader.replace("Bearer ", "").trim();

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !user) {
    return {
      user: null,
      response: NextResponse.json(
        {
          error: "Invalid admin session.",
        },
        {
          status: 401,
        },
      ),
    };
  }

  if (!process.env.ADMIN_USER_ID || user.id !== process.env.ADMIN_USER_ID) {
    return {
      user: null,
      response: NextResponse.json(
        {
          error: "Admin access denied.",
        },
        {
          status: 403,
        },
      ),
    };
  }

  return {
    user,
    response: null,
  };
}

/* =========================================================
   GET
   Load Add Money Requests
========================================================= */

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);

    if (!auth.user) {
      return auth.response!;
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
    /* -----------------------------------------------------
       1. Verify Admin
    ----------------------------------------------------- */

    const auth = await requireAdmin(request);

    if (!auth.user) {
      return auth.response!;
    }

    /* -----------------------------------------------------
       2. Read Request Body
    ----------------------------------------------------- */

    const body = await request.json();

    const requestId = String(body.requestId || "").trim();

    const action = String(body.action || "")
      .trim()
      .toLowerCase();

    const adminNote = String(body.adminNote || "").trim();

    /* -----------------------------------------------------
       3. Validate Request ID
    ----------------------------------------------------- */

    if (!requestId) {
      return NextResponse.json(
        {
          error: "Request ID missing.",
        },
        {
          status: 400,
        },
      );
    }

    /* -----------------------------------------------------
       4. Validate Action
    ----------------------------------------------------- */

    const validActions = ["approved", "rejected", "undo"];

    if (!validActions.includes(action)) {
      return NextResponse.json(
        {
          error: "Invalid action.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       UNDO
    ===================================================== */

    if (action === "undo") {
      /*
       * Get request information BEFORE undo.
       *
       * We need this for the notification.
       */

      const { data: requestInfo, error: requestInfoError } = await supabaseAdmin
        .from("add_money_requests")
        .select(
          `
          id,
          user_id,
          amount,
          status
          `,
        )
        .eq("id", requestId)
        .maybeSingle();

      if (requestInfoError) {
        console.error("ADD MONEY UNDO REQUEST READ ERROR:", requestInfoError);

        return NextResponse.json(
          {
            error: "Add Money request load করা যায়নি।",
          },
          {
            status: 500,
          },
        );
      }

      if (!requestInfo) {
        return NextResponse.json(
          {
            error: "Add Money request পাওয়া যায়নি।",
          },
          {
            status: 404,
          },
        );
      }

      const previousStatus = requestInfo.status;

      if (previousStatus !== "approved" && previousStatus !== "rejected") {
        return NextResponse.json(
          {
            error: "শুধুমাত্র approved বা rejected request undo করা যাবে।",
          },
          {
            status: 409,
          },
        );
      }

      /*
       * Call safe database undo function.
       */

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
          {
            error: undoError.message || "Request undo করা যায়নি।",
          },
          {
            status: 409,
          },
        );
      }

      /* ===================================================
         Undo Notification
      =================================================== */

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
        } else {
          console.log(
            "ADD MONEY UNDO NOTIFICATION CREATED:",
            requestId,
            previousStatus,
          );
        }
      }

      console.log("ADD MONEY UNDONE:", requestId, previousStatus, undoResult);

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

    /*
     * Get request BEFORE review.
     *
     * We need user_id and amount for notification.
     */

    const { data: requestInfo, error: requestInfoError } = await supabaseAdmin
      .from("add_money_requests")
      .select(
        `
        id,
        user_id,
        amount,
        payment_method,
        transaction_id,
        status
        `,
      )
      .eq("id", requestId)
      .maybeSingle();

    if (requestInfoError) {
      console.error("ADD MONEY REQUEST READ ERROR:", requestInfoError);

      return NextResponse.json(
        {
          error: "Add Money request load করা যায়নি।",
        },
        {
          status: 500,
        },
      );
    }

    if (!requestInfo) {
      return NextResponse.json(
        {
          error: "Add Money request পাওয়া যায়নি।",
        },
        {
          status: 404,
        },
      );
    }

    /* -----------------------------------------------------
       Prevent Duplicate Review
    ----------------------------------------------------- */

    if (
      requestInfo.status === "approved" ||
      requestInfo.status === "rejected"
    ) {
      return NextResponse.json(
        {
          error: `এই request ইতোমধ্যে ${requestInfo.status} হয়েছে।`,
        },
        {
          status: 409,
        },
      );
    }

    /* -----------------------------------------------------
       Review using existing RPC
    ----------------------------------------------------- */

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
        {
          error: reviewError.message || "Request review করা যায়নি।",
        },
        {
          status: 500,
        },
      );
    }

    /* =====================================================
       Notification
    ===================================================== */

    let notificationTitle = "";

    let notificationMessage = "";

    /* -----------------------------------------------------
       APPROVED
    ----------------------------------------------------- */

    if (action === "approved") {
      notificationTitle = "Wallet Updated ✅";

      notificationMessage = `Your Add Money request of ৳${Number(
        requestInfo.amount || 0,
      ).toLocaleString()} has been approved and added to your wallet.`;
    }

    /* -----------------------------------------------------
       REJECTED
    ----------------------------------------------------- */

    if (action === "rejected") {
      notificationTitle = "Add Money Rejected ❌";

      notificationMessage = `Your Add Money request of ৳${Number(
        requestInfo.amount || 0,
      ).toLocaleString()} has been rejected.`;

      if (adminNote) {
        notificationMessage += ` Reason: ${adminNote}`;
      }
    }

    /* -----------------------------------------------------
       Insert Notification
    ----------------------------------------------------- */

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

        console.log("ADD MONEY NOTIFICATION CREATED:", requestId, action);
      }
    }

    /* -----------------------------------------------------
       Final Log
    ----------------------------------------------------- */

    console.log("ADD MONEY REVIEWED:", requestId, action, reviewResult);

    /* -----------------------------------------------------
       Response
    ----------------------------------------------------- */

    return NextResponse.json({
      success: true,

      result: reviewResult,

      status: action,

      notificationCreated,
    });
  } catch (error) {
    console.error("ADMIN ADD MONEY PATCH SERVER ERROR:", error);

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
