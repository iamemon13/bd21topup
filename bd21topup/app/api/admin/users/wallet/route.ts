import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkUserRole } from "@/lib/admin-auth";

export async function POST(request: Request) {
  try {
    // ওয়ালেট বা ব্যালেন্স এডিটের ক্ষমতা শুধু super_admin এবং admin এর থাকবে
    const authCheck = await checkUserRole(request, ["super_admin", "admin"]);

    if ("error" in authCheck) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status },
      );
    }

    const body = await request.json();

    const userId = String(body.userId || "").trim();
    const action = String(body.action || "").trim().toLowerCase();
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
      return NextResponse.json(
        { error: "Invalid action." },
        { status: 400 },
      );
    }

    const { data: user, error: userError } = await supabaseAdmin
      .from("profiles")
      .select("id, wallet_balance, full_name")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: "User not found." },
        { status: 404 },
      );
    }

    const currentBalance = Number(user.wallet_balance || 0);
    let newBalance = currentBalance;
    let direction: "credit" | "debit";

    if (action === "add") {
      newBalance = currentBalance + amount;
      direction = "credit";
    } else {
      newBalance = currentBalance - amount;
      direction = "debit";
    }

    if (newBalance < 0) {
      return NextResponse.json(
        { error: "Insufficient wallet balance." },
        { status: 400 },
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({
        wallet_balance: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (updateError) {
      return NextResponse.json(
        { error: "Wallet update failed." },
        { status: 500 },
      );
    }

    await supabaseAdmin.from("wallet_transactions").insert({
      user_id: userId,
      type: "adjustment",
      direction,
      amount,
      balance_after: newBalance,
      description: note || (action === "add" ? "Wallet balance added by admin" : "Wallet balance removed by admin"),
    });

    return NextResponse.json({
      success: true,
      newBalance,
    });
  } catch (error) {
    console.error("WALLET UPDATE SERVER ERROR:", error);
    return NextResponse.json(
      { error: "Server error." },
      { status: 500 },
    );
  }
}
