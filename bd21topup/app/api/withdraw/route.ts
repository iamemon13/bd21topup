import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const { amount, method, accountNumber } = await req.json();

    if (!amount || Number(amount) < 100) {
      return NextResponse.json({ error: "সর্বনিম্ন ১০০ টাকা উইথড্র করতে হবে।" }, { status: 400 });
    }

    if (!method || !accountNumber) {
      return NextResponse.json({ error: "সঠিক পেমেন্ট মেথড এবং অ্যাকাউন্ট নম্বর দিন।" }, { status: 400 });
    }

    // ডেটাবেসে ইনসার্ট করার চেষ্টা এবং বিস্তারিত এরর ক্যাপচার
    const { data, error: insertError } = await supabaseAdmin
      .from("withdrawals")
      .insert([
        {
          user_id: user.id,
          amount: Number(amount),
          method,
          account_number: accountNumber,
          status: "Pending",
        },
      ])
      .select();

    if (insertError) {
      console.error("DETAILED INSERT ERROR:", JSON.stringify(insertError, null, 2));
      return NextResponse.json({ error: `DB Error: ${insertError.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "উইথড্রয়াল রিকোয়েস্ট সফলভাবে জমা হয়েছে!" });
  } catch (err: any) {
    console.error("WITHDRAW API CATCH ERROR:", err);
    return NextResponse.json({ error: `Server Error: ${err?.message || "unknown"}` }, { status: 500 });
  }
}
