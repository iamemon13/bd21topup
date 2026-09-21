import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { z } from "zod";

// ==========================================
// 🔒 SECURITY FIX: Zod Input Validation Schema
// ==========================================
const withdrawSchema = z.object({
  // 🛠️ TypeScript Fix: Removed parameter object to match strict TS types
  amount: z.coerce
    .number()
    .min(100, "কমপক্ষে ১০০ টাকা উইথড্র করতে হবে।")
    .max(100000, "একসাথে সর্বোচ্চ ১,০০,০০০ টাকার বেশি উইথড্র করা যাবে না।"),

  // 🛠️ TypeScript Fix: Used 'message' instead of 'invalid_type_error'
  method: z.enum(["bkash", "nagad", "rocket"], {
    message: "অসদুপায় বা ভুল উইথড্রয়াল মেথড নির্বাচন করা হয়েছে।",
  }),

  accountNumber: z
    .string()
    .regex(/^01\d{9}$/, "সঠিক ১১ ডিজিটের অ্যাকাউন্ট নম্বর দিন।"),
});

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

    const validationResult = withdrawSchema.safeParse(body);

    if (!validationResult.success) {
      const errorMessage = validationResult.error.issues[0].message;
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const { amount, method, accountNumber } = validationResult.data;

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      "process_withdrawal",
      {
        p_user_id: user.id,
        p_amount: amount,
        p_method: method,
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
