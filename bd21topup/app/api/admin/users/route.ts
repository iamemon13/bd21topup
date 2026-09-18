import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkUserRole } from "@/lib/admin-auth";

export async function GET(request: Request) {
  try {
    // শুধু super_admin এবং admin এই পেজ দেখতে পারবে
    const authCheck = await checkUserRole(request, ["super_admin", "admin"]);

    if ("error" in authCheck) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status },
      );
    }

    const { data: users, error } = await supabaseAdmin
      .from("profiles")
      .select(
        `
          id,
          full_name,
          email,
          phone,
          wallet_balance,
          role,
          created_at
          `,
      )
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      console.error("ADMIN USERS ERROR:", error);
      return NextResponse.json({ error: "Users load failed" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      users: users || [],
    });
  } catch (error) {
    console.error("ADMIN USERS API ERROR:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
