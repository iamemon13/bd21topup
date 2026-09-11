import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import crypto from "crypto";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { uid, playerName, packageName, amount } = body;

    const cleanUid = String(uid || "").trim();
    const cleanPlayerName = String(playerName || "").trim();
    const cleanPackageName = String(packageName || "").trim();
    const numericAmount = Number(amount);

    if (
      !cleanUid ||
      !cleanPlayerName ||
      !cleanPackageName ||
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0
    ) {
      return NextResponse.json(
        { success: false, message: "সব তথ্য সঠিকভাবে দিন।" },
        { status: 400 },
      );
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json(
        { success: false, message: "Login session expired. আবার Login করুন।" },
        { status: 401 },
      );
    }

    // ১. ইউজারের বর্তমান প্রোফাইল ও ওয়ালেট ব্যালেন্স চেক
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("full_name, wallet_balance")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { success: false, message: "User profile পাওয়া যায়নি।" },
        { status: 404 },
      );
    }

    const currentBalance = Number(profile.wallet_balance || 0);
    if (currentBalance < numericAmount) {
      return NextResponse.json(
        { success: false, message: "পর্যাপ্ত ওয়ালেট ব্যালেন্স নেই।" },
        { status: 400 },
      );
    }

    // ২. নতুন ব্যালেন্স হিসেব করে ওয়ালেট আপডেট
    const newBalance = currentBalance - numericAmount;
    const { error: balanceUpdateError } = await supabaseAdmin
      .from("profiles")
      .update({ wallet_balance: newBalance })
      .eq("id", user.id);

    if (balanceUpdateError) {
      return NextResponse.json(
        { success: false, message: "ব্যালেন্স আপডেট করা যায়নি।" },
        { status: 500 },
      );
    }

    // ৩. ইউনিক ট্রানজেকশন আইডি
    const txId = `WALLET-${crypto.randomUUID()}`;
    const accountName =
      profile.full_name ||
      user.user_metadata?.full_name ||
      user.email?.split("@")[0] ||
      "User";

    // ৪. সরাসরি Pending স্ট্যাটাস দিয়ে নতুন অর্ডার ইনসার্ট
    const { data: orderData, error: orderError } = await supabaseAdmin
      .from("orders")
      .insert({
        user_id: user.id,
        uid: cleanUid,
        player_name: cleanPlayerName,
        account_name: accountName,
        product_name: "Free Fire UID TopUp",
        package_name: cleanPackageName,
        amount: numericAmount,
        payment_method: "wallet",
        receiver_number: "Wallet Payment",
        transaction_id: txId,
        status: "pending",
      })
      .select("id")
      .single();

    if (orderError || !orderData) {
      // অর্ডার ফেইল করলে ব্যালেন্স রোলব্যাক (টাকা ফেরত দিয়ে দেওয়া)
      await supabaseAdmin
        .from("profiles")
        .update({ wallet_balance: currentBalance })
        .eq("id", user.id);

      return NextResponse.json(
        { success: false, message: "Order প্লেস করা যায়নি।" },
        { status: 500 },
      );
    }

    // ৫. ওয়ালেট হিস্ট্রিতে রেকর্ড যোগ (যদি wallet_transactions টেবিল থাকে)
    await supabaseAdmin.from("wallet_transactions").insert({
      user_id: user.id,
      type: "purchase",
      direction: "debit",
      amount: numericAmount,
      balance_after: newBalance,
      reference_id: orderData.id,
      description: `Free Fire UID TopUp (${cleanPackageName})`,
    });

    return NextResponse.json({
      success: true,
      message: "Order placed successfully!",
      order_id: orderData.id,
      balance_after: newBalance,
    });
  } catch (error) {
    console.error("WALLET PAY ROUTE ERROR:", error);
    return NextResponse.json(
      { success: false, message: "Server error" },
      { status: 500 },
    );
  }
}

