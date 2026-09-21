import { supabaseAdmin } from "@/lib/supabase-admin";

export async function checkUserRole(
  request: Request,
  allowedRoles: string[],
  requiredPermission?: string,
) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return { error: "Unauthorized. Token missing.", status: 401 };
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return { error: "Invalid session.", status: 401 };
    }

    // ✅ FIX: .single() → .maybeSingle()
    const { data: adminData, error: roleError } = await supabaseAdmin
      .from("admin_roles")
      .select("role, permissions")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleError) {
      console.error("ADMIN ROLES FETCH ERROR:", roleError);
      return { error: "Access Denied. You are not an admin.", status: 403 };
    }

    if (!adminData) {
      return { error: "Access Denied. You are not an admin.", status: 403 };
    }

    if (!allowedRoles.includes(adminData.role)) {
      return { error: "Access Denied. Insufficient role.", status: 403 };
    }

    if (requiredPermission && adminData.role !== "super_admin") {
      const userPermissions = adminData.permissions || [];
      if (!userPermissions.includes(requiredPermission)) {
        return {
          error: "Access Denied. Missing required permission.",
          status: 403,
        };
      }
    }

    return {
      user,
      role: adminData.role,
      permissions: Array.isArray(adminData.permissions)
        ? adminData.permissions
        : [],
    };
  } catch (error) {
    console.error("AUTH CHECK ERROR:", error);
    return { error: "Internal server error during auth check.", status: 500 };
  }
}
