import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// POST: নতুন অর্ডার বা ইনস্ট্যান্ট পেমেন্ট সাবমিট করা
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const body = await request.json();
    const { uid, playerName, packageName, receiverNumber, paymentMethod } =
      body;

    // ==========================================
    // 🔒 SECURITY FIX 1: Wallet Payment Bypass Prevention (স্টেপ ১)
    // ==========================================
    if (paymentMethod === "wallet") {
      return NextResponse.json(
        {
          error:
            "Wallet payments must be processed via /api/wallet-pay endpoint.",
        },
        { status: 400 },
      );
    }

    // ==========================================
    // 🔒 SECURITY FIX 2: Payment Method & Receiver Validation
    // ==========================================
    // "wallet" এখান থেকে বাদ দেওয়া হয়েছে কারণ এটি ম্যানুয়াল পেমেন্ট রুট
    const VALID_PAYMENT_METHODS = ["bkash", "nagad", "rocket"];
    const sanitizedPaymentMethod = String(paymentMethod || "")
      .trim()
      .toLowerCase();

    if (!VALID_PAYMENT_METHODS.includes(sanitizedPaymentMethod)) {
      return NextResponse.json(
        { error: "অসদুপায় বা ভুল পেমেন্ট মেথড নির্বাচন করা হয়েছে।" },
        { status: 400 },
      );
    }

    // সার্ভার-সাইড নির্ধারিত অফিশিয়াল রিসিভার নম্বর বা কনফিগারেশন ম্যাপ
    const MERCHANT_NUMBERS: Record<string, string> = {
      bkash: "01700000000",
      nagad: "01800000000",
      rocket: "01900000000",
    };

    const secureReceiverNumber =
      MERCHANT_NUMBERS[sanitizedPaymentMethod] ||
      String(receiverNumber || "").trim();

    // 🔒 SECURITY FIX 3: Transaction ID length validation
    const transactionId = String(body.transactionId || "").trim();

    if (transactionId.length < 8 || transactionId.length > 20) {
      return NextResponse.json(
        { error: "সঠিক Transaction ID দিন (৮ থেকে ২০ অক্ষরের মধ্যে)।" },
        { status: 400 },
      );
    }

    if (!uid || !packageName || !sanitizedPaymentMethod || !transactionId) {
      return NextResponse.json(
        { error: "Required fields are missing." },
        { status: 400 },
      );
    }

    // ==========================================
    // 🔒 সার্ভার-সাইড প্যাকেজ প্রাইজ চেকিং
    // ==========================================
    const { data: pkg, error: pkgError } = await supabaseAdmin
      .from("packages")
      .select("price")
      .eq("name", packageName)
      .single();

    if (pkgError || !pkg) {
      console.error("PACKAGE LOOKUP ERROR:", pkgError);
      return NextResponse.json(
        { error: "Invalid package. সঠিক প্যাকেজ নির্বাচন করুন।" },
        { status: 400 },
      );
    }

    // ডাটাবেজের আসল দাম কনফার্ম করা হলো
    const secureAmount = Number(pkg.price);

    const accName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email?.split("@")[0] ||
      "User";

    const { data, error } = await supabaseAdmin
      .from("orders")
      .insert({
        user_id: user.id,
        account_name: accName,
        uid: uid,
        player_name: playerName || "",
        package_name: packageName,
        amount: secureAmount,
        receiver_number: secureReceiverNumber,
        payment_method: sanitizedPaymentMethod,
        transaction_id: transactionId,
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "এই Transaction ID ইতিমধ্যে ব্যবহার করা হয়েছে।" },
          { status: 409 },
        );
      }
      console.error("ORDER INSERT ERROR:", error);
      // 🔒 SECURITY FIX (স্টেপ ৮ এর কিছু অংশ): ডাটাবেসের ভেতরের এরর ক্লায়েন্টকে না দেখানো
      return NextResponse.json(
        { error: "Order save করা যায়নি। সার্ভারে সমস্যা হয়েছে।" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, order: data });
  } catch (err) {
    console.error("ORDERS API SERVER ERROR:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
