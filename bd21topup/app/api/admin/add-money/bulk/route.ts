
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function getAdminUser(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.replace("Bearer ", "").trim();
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) return null;
  return user;
}

export async function POST(request: Request) {
  try {
    const admin = await getAdminUser(request);
    if (!admin) {
      return NextResponse.json(
        { error: "Unauthorized access." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { requestIds, action, adminNote } = body;

    if (!Array.isArray(requestIds) || requestIds.length === 0) {
      return NextResponse.json(
        { error: "কমপক্ষে একটি রিকোয়েস্ট সিলেক্ট করুন।" },
        { status: 400 }
      );
    }

    if (action !== "approved" && action !== "rejected") {
      return NextResponse.json(
        { error: "Invalid action." },
        { status: 400 }
      );
    }

    if (action === "rejected" && (!adminNote || !adminNote.trim())) {
      return NextResponse.json(
        { error: "বাতিল করার কারণ (Admin Note) দেওয়া বাধ্যতামূলক।" },
        { status: 400 }
      );
    }

    // ডেটাবেসের সুরক্ষিত RPC দিয়ে প্রতিটি রিকোয়েস্ট প্রসেস করা
    let successCount = 0;
    for (const requestId of requestIds) {
      const { error: rpcError } = await supabaseAdmin.rpc(
        "admin_review_add_money",
        {
          p_request_id: requestId,
          p_action: action,
          p_admin_note: adminNote?.trim() || null,
        }
      );

      if (!rpcError) {
        successCount++;
      } else {
        console.error(`Error processing request ${requestId}:`, rpcError);
      }
    }

    return NextResponse.json({
      success: true,
      message: `${successCount} টি Add Money রিকোয়েস্ট সফলভাবে ${
        action === "approved" ? "Approve" : "Reject"
      } করা হয়েছে।`,
    });
  } catch (error: any) {
    console.error("ADD MONEY BULK ERROR:", error);
    return NextResponse.json(
      { error: error?.message || "সার্ভারে সমস্যা হয়েছে।" },
      { status: 500 }
    );
  }
}
