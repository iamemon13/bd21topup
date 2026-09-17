import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";

// সার্ভার সাইড সুপাবেস ক্লায়েন্ট (সিক্রেট রোল বা সাধারণ ক্লায়েন্ট)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const { amount, method, accountNumber } = await req.json();

    if (!amount || amount < 100) {
      return NextResponse.json({ error: "সর্বনিম্ন ১০০ টাকা উইথড্র করতে হবে।" }, { status: 400 });
    }

    if (!method || !accountNumber) {
      return NextResponse.json({ error: "সঠিক পেমেন্ট মেথড এবং অ্যাকাউন্ট নম্বর দিন।" }, { status: 400 });
    }

    // ইউজারের কারেন্ট প্রোফাইল/ওয়ালেট ব্যালেন্স চেক করার জন্য আপনার একাউন্ট এপিআই লজিক বা টেবিল চেক করতে পারেন
    // এখানে উদাহরণস্বরূপ সরাসরি উইথড্রয়াল রিকোয়েস্ট ইনসার্ট করা হচ্ছে:
    const { error: insertError } = await supabaseAdmin
      .from("withdrawals")
      .insert([
        {
          user_id: user.id,
          amount,
          method,
          account_number: accountNumber,
          status: "Pending",
        },
      ]);

    if (insertError) {
      return NextResponse.json({ error: "উইথড্র রিকোয়েস্ট সাবমিট করা যায়নি।" }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "উইথড্রয়াল রিকোয়েস্ট সফলভাবে জমা হয়েছে!" });
  } catch (err) {
    console.error("WITHDRAW API ERROR:", err);
    return NextResponse.json({ error: "সার্ভারে সমস্যা হয়েছে।" }, { status: 500 });
  }
}

