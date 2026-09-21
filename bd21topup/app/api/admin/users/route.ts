import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkUserRole } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    // 🔒 PERMISSION FIX: Admin/Editor must have "manage_users" permission
    const authCheck = await checkUserRole(
      request,
      ["super_admin", "admin", "editor"],
      "manage_users",
    );

    if ("error" in authCheck) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status },
      );
    }

    // 🛠️ FIX 1: profiles টেবিল থেকে role ও permissions বাদ দিয়ে শুধু বেসিক ডাটা আনা হলো
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select(
        `
          id,
          full_name,
          email,
          phone,
          wallet_balance,
          created_at
        `,
      )
      .order("created_at", {
        ascending: false,
      });

    if (profilesError) {
      console.error("ADMIN USERS ERROR:", profilesError);
      return NextResponse.json({ error: "Users load failed" }, { status: 500 });
    }

    // 🛠️ FIX 2: admin_roles টেবিল থেকে সব অ্যাডমিনদের রোল আনা হলো
    const { data: adminRoles, error: rolesError } = await supabaseAdmin
      .from("admin_roles")
      .select("user_id, role, permissions");

    if (rolesError) {
      console.error("ADMIN ROLES ERROR:", rolesError);
      return NextResponse.json({ error: "Roles load failed" }, { status: 500 });
    }

    // 🛠️ FIX 3: Profile এবং Role ডাটা একসাথে মিলিয়ে (Merge) ফ্রন্টএন্ডে পাঠানো
    const users = (profiles || []).map((profile) => {
      // এই ইউজারের কোনো অ্যাডমিন রোল আছে কিনা চেক করা হচ্ছে
      const adminRole = (adminRoles || []).find(
        (ar) => ar.user_id === profile.id,
      );

      return {
        ...profile,
        role: adminRole?.role || "user", // admin_roles টেবিলে না থাকলে ডিফল্ট 'user'
        permissions: adminRole?.permissions || [],
      };
    });

    return NextResponse.json({
      success: true,
      users: users,
    });
  } catch (error) {
    console.error("ADMIN USERS API ERROR:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
