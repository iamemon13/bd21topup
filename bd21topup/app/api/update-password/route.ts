import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Onumodito noy (Unauthorized)" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Oboidho seshon (Invalid session)" }, { status: 401 });
    }

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!newPassword || newPassword.length < 6) {
      return NextResponse.json({ error: "Notun password kompokkhe 6 okhorer hote hobe." }, { status: 400 });
    }

    const identities = user.identities || [];
    const hasEmailIdentity = identities.some((id: any) => id.provider === "email");
    const isPasswordAlreadySet = user.user_metadata?.password_set === true;

    if (hasEmailIdentity || isPasswordAlreadySet) {
      if (!currentPassword) {
        return NextResponse.json({ error: "Bortoman password dite hobe." }, { status: 400 });
      }

      const { error: signInError } = await supabaseAdmin.auth.signInWithPassword({
        email: user.email || "",
        password: currentPassword,
      });

      if (signInError) {
        return NextResponse.json({ error: "Bortoman password sothik noy." }, { status: 400 });
      }
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: newPassword,
      user_metadata: {
        ...user.user_metadata,
        password_set: true,
      },
    });

    if (updateError) {
      return NextResponse.json({ error: updateError.message || "Password update kora jayni." }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Password shofolvabe update kora hoyeche!" });
  } catch (error) {
    console.error("UPDATE PASSWORD API ERROR:", error);
    return NextResponse.json({ error: "Sarvar error hoyeche." }, { status: 500 });
  }
}
