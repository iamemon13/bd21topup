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
      return NextResponse.json({ error: "নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।" }, { status: 400 });
    }

    // চেক করা ইউজারটির আগে থেকেই পাসওয়ার্ড প্রোভাইডার (email identity) আছে কি না
    const identities = user.identities || [];
    const hasPasswordAccount = identities.some((id: any) => id.provider === "email");

    // যদি ইউজার আগে থেকেই পাসওয়ার্ড সেট করে থাকে (বা ইমেইল পাসওয়ার্ড অ্যাকাউন্ট হয়), 
    // তবে বর্তমান পাসওয়ার্ড (currentPassword) দেওয়া বাধ্যতামূলক এবং সেটি সঠিক হতে হবে।
    if (hasPasswordAccount) {
      if (!currentPassword) {
        return NextResponse.json({ error: "আগের পাসওয়ার্ডটি দিতে হবে।" }, { status: 400 });
      }

      // বর্তমান পাসওয়ার্ড সঠিক কি না যাচাই করা
      const { error: signInError } = await supabaseAdmin.auth.signInWithPassword({
        email: user.email || "",
        password: currentPassword,
      });

      if (signInError) {
        return NextResponse.json({ error: "বর্তমান পাসওয়ার্ডটি সঠিক নয়।" }, { status: 400 });
      }
    }

    // নতুন পাসওয়ার্ড আপডেট করা (যা সুপাবেসের ডেটাবেজে স্থায়ীভাবে সেভ থাকবে, লগআউট করলেও মুছবে না)
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });

    if (updateError) {
      return NextResponse.json({ error: updateError.message || "পাসওয়ার্ড আপডেট করা যায়নি।" }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "পাসওয়ার্ড সফলভাবে সেভ ও আপডেট করা হয়েছে!" });
  } catch (error) {
    console.error("UPDATE PASSWORD API ERROR:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
