import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// অ্যাডমিন ক্লায়েন্ট যা RLS পলিসি বাইপাস করে সরাসরি ডেটা ইনসার্ট করতে পারে
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized: No token provided" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    
    // টোকেন দিয়ে সরাসরি ইউজারের তথ্য যাচাই করা
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({ error: "Invalid session or unauthorized user" }, { status: 401 });
    }

    const { amount, method, accountNumber } = await req.json();

    if (!amount || Number(amount) < 100) {
      return NextResponse.json({ error: "সর্বনিম্ন ১০০ টাকা উইথড্র করতে হবে।" }, { status: 400 });
    }

    if (!method || !accountNumber) {
      return NextResponse.json({ error: "সঠিক পেমেন্ট মেথড এবং অ্যাকাউন্ট নম্বর দিন।" }, { status: 400 });
    }

    // সরাসরি অ্যাডমিন ক্লায়েন্ট দিয়ে withdrawals টেবিলে ডেটা ইনসার্ট করা
    const { error: insertError } = await supabaseAdmin
      .from("withdrawals")
      .insert([
        {
          user_id: user.id,
          amount: Number(amount),
          method,
          account_number: accountNumber,
          status: "Pending",
        },
      ]);

    if (insertError) {
      console.error("SUPABASE INSERT ERROR:", insertError);
      return NextResponse.json({ error: "উইথড্র রিকোয়েস্ট ডেটাবেসে সংরক্ষণ করা যায়নি।" }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "উইথড্রয়াল রিকোয়েস্ট সফলভাবে জমা হয়েছে!" });
  } catch (err) {
    console.error("WITHDRAW API CATCH ERROR:", err);
    return NextResponse.json({ error: "সার্ভারে অনাকাঙ্ক্ষিত সমস্যা হয়েছে।" }, { status: 500 });
  }
}
