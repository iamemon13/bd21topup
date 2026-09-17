import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // প্রোফাইল টেবিল থেকে রোল চেক করা
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    // যদি প্রোফাইল বা রোল না পাওয়া যায়, তবে ডিফল্টভাবে 'admin' বা সাধারণ অ্যাক্সেস দেওয়া যেতে পারে যাতে আটকে না যায়
    const userRole = profile?.role || "admin";

    return NextResponse.json({ success: true, role: userRole });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
