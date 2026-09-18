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

    // Dekhbo user-er aage thekei password ba email identity ache kina, ba tini aage password set korechen kina
    // Supabase user er app_metadata ba encrypted_password check kore boja jay user-er password set ache kina.
    // Or amra easily check korte pari user sign-in kore ba user er identities-e password provider ache kina.
    const identities = user.identities || [];
    const hasEmailIdentity = identities.some((id: any) => id.provider === "email");

    // Kintu Google user jokhon prothombar password set kore, tokhon tar identity-te email thakte pare ba na o thakte pare.
    // Sothik upaye bujhar jonno amra dekhte pari user er password ache kina ba amra currentPassword check korte pari.
    // Aaro nishchit hobar jonno: Supabase-e user er ekta flag ba user_metadata te save kore rakhte pari je tar password set kora hoiche kina.
    const isPasswordAlreadySet = user.user_metadata?.password_set === true;

    // Jodi aage thekei password set kora thake (ba email user hoy), tahole currentPassword wajib ditei hobe!
    if (hasEmailIdentity || isPasswordAlreadySet) {
      if (!currentPassword) {
        return NextResponse.json({ error: "Bortoman password (current password) dite hobe." }, { status: 400 });
      }

      // Current password sothik kina check korar jonno sign in try korbo
      const { error: signInError } = await supabaseAdmin.auth.signInWithPassword({
        email: user.email || "",
        password: currentPassword,
      });

      if (signInError) {
        return NextResponse.json({ error: "Bortoman password sothik noy." }, { status: 400 });
      }
    }

    // New password update kore dibo ebong user_metadata te password_set: true save kore dibo jate pore bujha jay tar password set kora ache
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
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
