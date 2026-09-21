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

    // 🛠️ FIX 1: Fetching from admin_roles instead of profiles
    const { data: adminRole, error: adminRoleError } = await supabaseAdmin
      .from("admin_roles")
      .select("role, permissions")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminRoleError) {
      return NextResponse.json({ error: "Role fetch error." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      role: adminRole?.role || "user", // admin_roles এ না থাকলে সে সাধারণ user
      permissions: adminRole?.permissions || [],
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

    // 🛠️ FIX 2: Handle database updates correctly for the separate admin_roles table
    if (role === "user") {
      // যদি রোল user হয়, তবে তাকে admin_roles টেবিল থেকে ডিলিট করে দাও
      const { error: deleteError } = await supabaseAdmin
        .from("admin_roles")
        .delete()
        .eq("user_id", userId);

      if (deleteError) {
        console.error("ROLE DELETE ERROR:", deleteError);
        return NextResponse.json(
          { error: "ইউজারকে ডিমোট করা যায়নি।" },
          { status: 500 },
        );
      }
    } else {
      // যদি রোল admin/editor/super_admin হয়, তবে admin_roles টেবিলে upsert করো
      const { error: upsertError } = await supabaseAdmin
        .from("admin_roles")
        .upsert(
          {
            user_id: userId,
            role: role,
            permissions: userPermissions,
          },
          { onConflict: "user_id" },
        );

      if (upsertError) {
        console.error("ROLE/PERMISSION UPSERT ERROR:", upsertError);
        return NextResponse.json(
          { error: "Role এবং Permission আপডেট করা যায়নি।" },
          { status: 500 },
        );
      }
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
