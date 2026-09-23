import { financialAction } from "@/lib/financial-audit";
import { NextResponse } from "next/server";
import { checkUserRole } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_BULK_REQUESTS = 100;

type BulkAction = "approved" | "rejected";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBulkAction(value: string): value is BulkAction {
  return value === "approved" || value === "rejected";
}

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: Request) {
  try {
    /* =====================================================
       1. AUTH + PERMISSION
    ===================================================== */

    const authCheck = await checkUserRole(
      request,
      ["super_admin", "admin", "editor"],
      "manage_add_money",
    );

    if ("error" in authCheck) {
      return NextResponse.json(
        {
          success: false,
          error: authCheck.error,
        },
        {
          status: authCheck.status,
        },
      );
    }

    const adminId = authCheck.user.id;
    const ipAddress = getClientIp(request);

    /* =====================================================
       2. SAFE JSON PARSING
    ===================================================== */

    let rawBody: unknown;

    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid JSON body.",
        },
        {
          status: 400,
        },
      );
    }

    if (!isRecord(rawBody)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       3. VALIDATE REQUEST IDS
    ===================================================== */

    if (!Array.isArray(rawBody.requestIds)) {
      return NextResponse.json(
        {
          success: false,
          error: "কমপক্ষে একটি রিকোয়েস্ট সিলেক্ট করুন।",
        },
        {
          status: 400,
        },
      );
    }

    if (rawBody.requestIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "কমপক্ষে একটি রিকোয়েস্ট সিলেক্ট করুন।",
        },
        {
          status: 400,
        },
      );
    }

    if (rawBody.requestIds.length > MAX_BULK_REQUESTS) {
      return NextResponse.json(
        {
          success: false,
          error: `একবারে সর্বোচ্চ ${MAX_BULK_REQUESTS} টি request process করা যাবে।`,
        },
        {
          status: 400,
        },
      );
    }

    if (!rawBody.requestIds.every((id) => typeof id === "string")) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request ID list.",
        },
        {
          status: 400,
        },
      );
    }

    const requestIds = [
      ...new Set(
        rawBody.requestIds.map((id) => String(id).trim().toLowerCase()),
      ),
    ];

    if (requestIds.some((id) => !UUID_REGEX.test(id))) {
      return NextResponse.json(
        {
          success: false,
          error: "এক বা একাধিক request ID invalid.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       4. VALIDATE ACTION
    ===================================================== */

    if (typeof rawBody.action !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "Action missing.",
        },
        {
          status: 400,
        },
      );
    }

    const action = rawBody.action.trim().toLowerCase();

    if (!isBulkAction(action)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid action.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       5. VALIDATE ADMIN NOTE
    ===================================================== */

    if (
      rawBody.adminNote !== undefined &&
      rawBody.adminNote !== null &&
      typeof rawBody.adminNote !== "string"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Admin note must be text.",
        },
        {
          status: 400,
        },
      );
    }

    const adminNote =
      typeof rawBody.adminNote === "string" ? rawBody.adminNote.trim() : "";

    if (adminNote.length > 500) {
      return NextResponse.json(
        {
          success: false,
          error: "Admin note 500 characters-এর বেশি হতে পারবে না।",
        },
        {
          status: 400,
        },
      );
    }

    if (action === "rejected" && !adminNote) {
      return NextResponse.json(
        {
          success: false,
          error: "Reject করার কারণ দেওয়া বাধ্যতামূলক।",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       6. PROCESS REQUESTS

       Each admin_review_add_money RPC call is atomic.
       The entire bulk batch is NOT one DB transaction.
    ===================================================== */

    const successfulRequestIds: string[] = [];

    const failedRequests: Array<{
      requestId: string;
      reason: string;
    }> = [];

    for (const requestId of requestIds) {
      const { data, error: rpcError } = await financialAction({ adminId: adminId, operation: "add_money", targetId: requestId, action: action, note: adminNote || null, bulk: true, ip: ipAddress });

      if (rpcError) {
        console.error(`BULK ADD MONEY ERROR for ${requestId}:`, rpcError);

        let reason = "Request process করা যায়নি।";

        if (rpcError.message.includes("Request already reviewed")) {
          reason = "Request ইতোমধ্যে review করা হয়েছে।";
        } else if (rpcError.message.includes("Add Money request not found")) {
          reason = "Request পাওয়া যায়নি।";
        } else if (rpcError.message.includes("User profile not found")) {
          reason = "User profile পাওয়া যায়নি।";
        }

        failedRequests.push({
          requestId,
          reason,
        });

        continue;
      }

      if (!data?.success) {
        failedRequests.push({
          requestId,
          reason: "Request process করা যায়নি।",
        });

        continue;
      }

      successfulRequestIds.push(requestId);
    }

    /* =====================================================
       7. RESPONSE
    ===================================================== */

    if (successfulRequestIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          requestedCount: requestIds.length,
          successCount: 0,
          failedCount: failedRequests.length,
          failedRequests,
          error: "কোনো Add Money request process করা যায়নি।",
        },
        {
          status: 409,
        },
      );
    }

    if (failedRequests.length > 0) {
      return NextResponse.json(
        {
          success: true,
          partialSuccess: true,
          requestedCount: requestIds.length,
          successCount: successfulRequestIds.length,
          failedCount: failedRequests.length,
          successfulRequestIds,
          failedRequests,
          message: `${successfulRequestIds.length} টি request সফল হয়েছে, ${failedRequests.length} টি process করা যায়নি।`,
        },
        {
          status: 207,
        },
      );
    }

    return NextResponse.json({
      success: true,
      partialSuccess: false,
      requestedCount: requestIds.length,
      successCount: successfulRequestIds.length,
      failedCount: 0,
      successfulRequestIds,
      message: `${successfulRequestIds.length} টি Add Money request সফলভাবে ${
        action === "approved" ? "Approve" : "Reject"
      } করা হয়েছে।`,
    });
  } catch (error) {
    console.error("ADD MONEY BULK ERROR:", error);

    return NextResponse.json(
      {
        success: false,
        error: "সার্ভারে সমস্যা হয়েছে। রিকোয়েস্ট process করা যায়নি।",
      },
      {
        status: 500,
      },
    );
  }
}
