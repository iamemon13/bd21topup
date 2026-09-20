import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Login required" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "").trim();

    const {
      data: { user },
      error: authErr,
    } = await supabaseAdmin.auth.getUser(token);

    if (authErr || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const body = await request.json();
    const { amount, method, accountNumber } = body;
    const amountNum = Number(amount);

    if (!amountNum || amountNum < 100) {
      return NextResponse.json(
        { error: "কমপক্ষে ১০০ টাকা উইথড্র করতে হবে।" },
        { status: 400 },
      );
    }

    // ==========================================
    // 🔒 SECURITY FIX: Withdrawal Method Validation
    // ==========================================
    const VALID_WITHDRAWAL_METHODS = ["bkash", "nagad", "rocket"];
    const sanitizedMethod = String(method || "")
      .trim()
      .toLowerCase();

    if (!VALID_WITHDRAWAL_METHODS.includes(sanitizedMethod)) {
      return NextResponse.json(
        { error: "অসদুপায় বা ভুল উইথড্রয়াল মেথড নির্বাচন করা হয়েছে।" },
        { status: 400 },
      );
    }

    if (!/^01\d{9}$/.test(accountNumber)) {
      return NextResponse.json(
        { error: "সঠিক ১১ ডিজিটের অ্যাকাউন্ট নম্বর দিন।" },
        { status: 400 },
      );
    }

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      "process_withdrawal",
      {
        p_user_id: user.id,
        p_amount: amountNum,
        p_method: sanitizedMethod, // 🔒 Server-validated sanitized method
        p_account_number: accountNumber,
      },
    );

    if (rpcError) {
      console.error("WITHDRAW RPC ERROR:", rpcError);
      if (rpcError.message.includes("Insufficient balance")) {
        return NextResponse.json(
          { error: "আপনার ওয়ালেটে পর্যাপ্ত ব্যালেন্স নেই।" },
          { status: 400 },
        );
      }
      if (rpcError.message.includes("Profile not found")) {
        return NextResponse.json(
          { error: "অ্যাকাউন্ট লোড করা যায়নি।" },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: "রিকোয়েস্ট জমা নেওয়া যায়নি।" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Withdrawal request submitted successfully.",
      data: rpcData,
    });
  } catch (err) {
    console.error("WITHDRAW API ERROR:", err);

    return NextResponse.json(
      { error: "সার্ভারে সমস্যা হয়েছে।" },
      { status: 500 },
    );
  }
}
