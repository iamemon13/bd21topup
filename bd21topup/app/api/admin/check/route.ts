import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkUserRole } from "@/lib/admin-auth";

export async function GET(request: Request) {
  try {
    const authCheck = await checkUserRole(request, [
      "super_admin",
      "admin",
      "editor",
    ]);

    if ("error" in authCheck) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status },
      );
    }

    return NextResponse.json({
      success: true,
      admin: true,
      user: {
        id: authCheck.user.id,
        email: authCheck.user.email,
        role: authCheck.role,
      },
    });
  } catch (error) {
    console.error("ADMIN CHECK ERROR:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
