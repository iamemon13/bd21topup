import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkUserRole } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

// =========================================================
// GET: Get current user's role and permissions
// =========================================================
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Invalid session." }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("role, permissions")
      .eq("id", user.id)
      .single();

    if (profileError) {
      return NextResponse.json(
        { error: "Profile not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      role: profile.role || "user",
      permissions: profile.permissions || [],
    });
  } catch (error) {
    console.error("ROLE API GET ERROR:", error);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}

// =========================================================
// PATCH: Update user role and permissions (Super Admin only)
// =========================================================
export async function PATCH(request: Request) {
  try {
    // 🔒 শুধুমাত্র super_admin এই API ব্যবহার করতে পারবে
    const authCheck = await checkUserRole(request, ["super_admin"]);

    if ("error" in authCheck) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status },
      );
    }

    const body = await request.json();
    const { userId, role, permissions } = body;

    if (!userId || !role) {
      return NextResponse.json(
        { error: "User ID এবং Role প্রদান করা আবশ্যক।" },
        { status: 400 },
      );
    }

    const validRoles = ["user", "editor", "admin", "super_admin"];
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }

    // Server-side valid permission whitelist
    const VALID_PERMISSIONS = [
      "manage_users",
      "manage_orders",
      "manage_add_money",
      "manage_withdrawals",
      "manage_packages",
      "manage_notifications",
    ];

    // Permission লিস্ট ফিল্টার ও হোয়াইটলিস্ট নিশ্চিত করা
    const userPermissions = Array.isArray(permissions)
      ? permissions.filter(
          (p) => typeof p === "string" && VALID_PERMISSIONS.includes(p),
        )
      : [];

    // সুপার অ্যাডমিন যেন ভুল করে নিজের রোল ডাউনগ্রেড না করে ফেলে
    if (userId === authCheck.user.id && role !== "super_admin") {
      return NextResponse.json(
        { error: "আপনি নিজের super_admin রোল পরিবর্তন করতে পারবেন না।" },
        { status: 400 },
      );
    }

    // ডাটাবেজে Role এবং Permissions আপডেট করা
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({
        role: role,
        permissions: userPermissions,
      })
      .eq("id", userId);

    if (updateError) {
      console.error("ROLE/PERMISSION UPDATE ERROR:", updateError);
      return NextResponse.json(
        { error: "Role এবং Permission আপডেট করা যায়নি।" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Role এবং Permission সফলভাবে আপডেট হয়েছে ✅",
    });
  } catch (error) {
    console.error("ROLE API SERVER ERROR:", error);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
