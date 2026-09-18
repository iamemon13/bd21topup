import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Login required" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);

    if (authErr || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const body = await request.json();
    const { amount, method, accountNumber } = body;
    const amountNum = Number(amount);

    if (!amountNum || amountNum < 100) {
      return NextResponse.json({ error: "কমপক্ষে ১০০ টাকা উইথড্র করতে হবে।" }, { status: 400 });
    }

    if (!/^01\d{9}$/.test(accountNumber)) {
      return NextResponse.json({ error: "সঠিক ১১ ডিজিটের অ্যাকাউন্ট নম্বর দিন।" }, { status: 400 });
    }

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("wallet_balance")
      .eq("id", user.id)
      .single();

    if (profileErr || !profile) {
      return NextResponse.json({ error: "অ্যাকাউন্ট লোড করা যায়নি।" }, { status: 404 });
    }

    const currentBalance = Number(profile.wallet_balance);

    if (currentBalance < amountNum) {
      return NextResponse.json({ error: "আপনার ওয়ালেটে পর্যাপ্ত ব্যালেন্স নেই।" }, { status: 400 });
    }

    // Shudhu request create kora hocche kono balance deductuion chhara
    const { error: insertErr } = await supabaseAdmin
      .from("withdrawals")
      .insert({
        user_id: user.id,
        amount: amountNum,
        method: method,
        account_number: accountNumber,
        status: "pending"
      });

    if (insertErr) {
      console.error("WITHDRAW INSERT ERROR:", insertErr);
      return NextResponse.json({ error: "রিকোয়েস্ট জমা নেওয়া যায়নি।" }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Withdrawal request submitted successfully." });
    
  } catch (err) {
    console.error("WITHDRAW API ERROR:", err);
    return NextResponse.json({ error: "সার্ভারে সমস্যা হয়েছে।" }, { status: 500 });
  }
}
