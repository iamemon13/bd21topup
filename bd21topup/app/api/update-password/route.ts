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
    const { currentPassword, newPassword } = body;

    if (!newPassword || newPassword.length < 6) {
      return NextResponse.json({ error: "Notun password kam pokhshe 6 okhorer hote hobe." }, { status: 400 });
    }

    // User-er ager password ba identity ache kina check korar jonno amra user sign-in check korte pari 
    // Jodi user-er password theke thake, tahobe currentPassword ditei hobe.
    // Supabase-e user-er password verify korar jonno admin client diye password sign-in try kora jay.
    if (currentPassword) {
      const { error: signInError } = await supabaseAdmin.auth.signInWithPassword({
        email: user.email || "",
        password: currentPassword,
      });

      if (signInError) {
        return NextResponse.json({ error: "Bortoman password sothik noy." }, { status: 400 });
      }
    }

    // Direct password update
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });

    if (updateError) {
      return NextResponse.json({ error: updateError.message || "Password update kora jayni." }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Password shofolvabe update kora hoyeche!" });
  } catch (error) {
    console.error("UPDATE PASSWORD API ERROR:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
