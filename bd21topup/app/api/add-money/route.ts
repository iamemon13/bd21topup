import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { paymentConfig } from "@/lib/payment-config";

const allowedMethods = ["bkash", "nagad", "rocket", "upay"] as const;
type PaymentMethod = (typeof allowedMethods)[number];

async function getUserFromRequest(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { user: null, response: NextResponse.json({ error: "Login required." }, { status: 401 }) };
  }

  const token = authHeader.replace("Bearer ", "").trim();
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return { user: null, response: NextResponse.json({ error: "Invalid or expired session." }, { status: 401 }) };
  }

  return { user, response: null };
}

// GET: ইউজারের নিজের Add Money রিকোয়েস্টগুলোর হিস্ট্রি লোড করা
export async function GET(request: Request) {
  try {
    const auth = await getUserFromRequest(request);
    if (!auth.user) {
      return auth.response!;
    }

    const { data, error } = await supabaseAdmin
      .from("add_money_requests")
      .select("id, amount, payment_method, receiver_number, transaction_id, status, admin_note, created_at, reviewed_at")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("ADD MONEY GET ERROR:", error);
      return NextResponse.json({ error: "Add Money history load করা যায়নি।" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      requests: data ?? [],
    });
  } catch (error) {
    console.error("ADD MONEY GET SERVER ERROR:", error);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}

// POST: নতুন Add Money রিকোয়েস্ট সাবমিট করা
export async function POST(request: Request) {
  try {
    const auth = await getUserFromRequest(request);
    if (!auth.user) {
      return auth.response!;
    }

    const body = await request.json();

    const amount = Number(body.amount);
    const paymentMethod = String(body.paymentMethod || "").trim().toLowerCase() as PaymentMethod;
    const transactionId = String(body.transactionId || "").trim();

    if (!Number.isFinite(amount) || amount < 10 || amount > 100000) {
      return NextResponse.json({ error: "Amount ৳10 থেকে ৳100,000 এর মধ্যে হতে হবে।" }, { status: 400 });
    }

    if (!allowedMethods.includes(paymentMethod)) {
      return NextResponse.json({ error: "সঠিক payment method select করুন।" }, { status: 400 });
    }

    if (transactionId.length < 4 || transactionId.length > 80) {
      return NextResponse.json({ error: "সঠিক Transaction ID দিন।" }, { status: 400 });
    }

    const receiverNumber = paymentConfig[paymentMethod]?.number;

    if (!receiverNumber) {
      return NextResponse.json({ error: "Payment receiver configured না।" }, { status: 500 });
    }

    const { data, error } = await supabaseAdmin
      .from("add_money_requests")
      .insert({
        user_id: auth.user.id,
        amount,
        payment_method: paymentMethod,
        receiver_number: receiverNumber,
        transaction_id: transactionId,
        status: "pending",
      })
      .select("id, amount, payment_method, receiver_number, transaction_id, status, created_at")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "এই Transaction ID আগে ব্যবহার করা হয়েছে।" }, { status: 409 });
      }

      console.error("ADD MONEY CREATE ERROR:", error);
      return NextResponse.json({ error: "Add Money request submit করা যায়নি।" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: "Add Money request submitted.",
      request: data,
    });
  } catch (error) {
    console.error("ADD MONEY POST SERVER ERROR:", error);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
