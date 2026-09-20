import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkUserRole } from "@/lib/admin-auth";

export async function POST(request: Request) {
  try {
    // 🔒 PERMISSION FIX: Admin/Editor must have "manage_users" permission
    const authCheck = await checkUserRole(
      request,
      ["super_admin", "admin", "editor"],
      "manage_users",
    );

    if ("error" in authCheck) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status },
      );
    }

    const body = await request.json();

    const userId = String(body.userId || "").trim();
    const action = String(body.action || "")
      .trim()
      .toLowerCase();
    const note = String(body.note || "").trim();
    const amount = Number(body.amount);

    if (!userId || !action) {
      return NextResponse.json(
        { error: "Missing required fields." },
        { status: 400 },
      );
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "Amount must be greater than 0." },
        { status: 400 },
      );
    }

    if (action !== "add" && action !== "remove") {
      return NextResponse.json({ error: "Invalid action." }, { status: 400 });
    }

    // Atomic RPC কল
    const { data: newBalance, error } = await supabaseAdmin.rpc(
      "admin_adjust_wallet",
      {
        p_user_id: userId,
        p_amount: amount,
        p_action: action,
        p_note: note,
      },
    );

    if (error) {
      console.error("RPC Error:", error);
      if (error.message.includes("Insufficient wallet balance")) {
        return NextResponse.json(
          { error: "Insufficient wallet balance." },
          { status: 400 },
        );
      }
      if (error.message.includes("User not found")) {
        return NextResponse.json({ error: "User not found." }, { status: 404 });
      }
      return NextResponse.json(
        { error: "Wallet update failed." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      newBalance,
    });
  } catch (error) {
    console.error("WALLET UPDATE SERVER ERROR:", error);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
