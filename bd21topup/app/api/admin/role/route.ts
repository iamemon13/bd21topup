import { NextResponse } from "next/server";
import { supabaseAdmin, logAdminAction } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token) {
      console.error("ADMIN ROLE GET ERROR: No token provided");
      return NextResponse.json({ error: "Missing token" }, { status: 401 });
    }

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      console.error("ADMIN AUTH GET USER ERROR:", authError);
      return NextResponse.json({ error: "Auth failed" }, { status: 401 });
    }

    const { data: adminData, error: adminRoleError } = await supabaseAdmin
      .from("admin_roles")
      .select("role, permissions")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminRoleError) {
      console.error("ADMIN ROLE GET ERROR (Supabase):", adminRoleError);
      return NextResponse.json(
        { error: "Failed to fetch admin role" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      role: adminData?.role || null,
      permissions: adminData?.permissions || [],
    });
  } catch (error) {
    console.error("UNHANDLED EXCEPTION IN /api/admin/role:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const authHeader = request.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 401 });
    }

    // ১. রিকোয়েস্ট কে পাঠাচ্ছে তাকে ভেরিফাই করা
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Auth failed" }, { status: 401 });
    }

    // ২. চেক করা যে, যে আপডেট করতে চাইছে সে আসলেই super_admin কি না!
    const { data: adminData } = await supabaseAdmin
      .from("admin_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminData?.role !== "super_admin") {
      return NextResponse.json(
        { error: "Unauthorized. Only Super Admin can change roles." },
        { status: 403 },
      );
    }

    // ৩. ফ্রন্টএন্ড থেকে পাঠানো ডাটা রিসিভ করা
    const body = await request.json();
    const { userId, role, permissions } = body;

    if (!userId || !role) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // 🔒 SECURITY CHECK: Role Validation
    const allowedRoles = ["super_admin", "admin", "editor", "user"];
    if (!allowedRoles.includes(role)) {
      return NextResponse.json(
        { error: "Invalid role specified." },
        { status: 400 },
      );
    }

    // 🔒 SECURITY CHECK: Prevent Self-Demotion
    if (user.id === userId && role !== "super_admin") {
      return NextResponse.json(
        {
          error:
            "Security risk: You cannot demote your own Super Admin account.",
        },
        { status: 403 },
      );
    }

    // ৪. সুপাবেস ডাটাবেসে নতুন রোল এবং পারমিশন আপডেট/ইনসার্ট করা
    const { error: updateError } = await supabaseAdmin
      .from("admin_roles")
      .upsert(
        {
          user_id: userId,
          role: role,
          permissions: permissions || [],
        },
        { onConflict: "user_id" },
      );

    if (updateError) {
      console.error("ROLE UPDATE DB ERROR:", updateError);
      return NextResponse.json(
        { error: "Failed to update role in database" },
        { status: 500 },
      );
    }

    // 🔒 AUDIT LOGGING: সফল আপডেটের রেকর্ড রাখা
    await logAdminAction({
      adminId: user.id,
      actionType: "UPDATE_USER_ROLE",
      targetId: userId,
      details: `Role updated to ${role}. Permissions: ${(permissions || []).join(", ")}`,
    });

    // ৫. সফলভাবে আপডেট হলে success: true পাঠানো
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("UNHANDLED EXCEPTION IN PATCH /api/admin/role:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
