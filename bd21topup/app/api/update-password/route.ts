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

    const { newPassword } = await request.json();

    if (!newPassword || newPassword.length < 6) {
      return NextResponse.json({ error: "Notun password kam পক্ষে ৬ okhorer hote hobe." }, { status: 400 });
    }

    // Supabase Admin API diye direct password update/set kora (Current password lagbe na)
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });

    if (updateError) {
      return NextResponse.json({ error: updateError.message || "Password update kora jayni." }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Password shofolvabe set kora hoyeche!" });
  } catch (error) {
    console.error("SET PASSWORD ERROR:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
