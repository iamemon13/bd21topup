import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { newPassword } = body;

    if (!newPassword || newPassword.length < 6) {
      return NextResponse.json({ error: "নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।" }, { status: 400 });
    }

    // Supabase Admin API দিয়ে সরাসরি পাসওয়ার্ড আপডেট করা
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });

    if (updateError) {
      return NextResponse.json({ error: updateError.message || "পাসওয়ার্ড পরিবর্তন করা যায়নি।" }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে!" });
  } catch (error) {
    console.error("UPDATE PASSWORD API ERROR:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
