import { supabaseAdmin } from "./supabase-admin";

export async function checkUserRole(
  request: Request,
  allowedRoles: string[],
  requiredPermission?: string
) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return { error: "Login required.", status: 401 };
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return { error: "Invalid session.", status: 401 };
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("role, permissions")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return { error: "Access Denied: Profile not found", status: 403 };
    }

    const userRole = profile.role || "user";
    
    // super_admin সবসময় ফুল পারমিশন পাবে
    if (userRole === "super_admin") {
      return { user, profile };
    }

    // Role চেক
    if (!allowedRoles.includes(userRole)) {
      return { error: "Access Denied: You do not have permission", status: 403 };
    }

    // Specific Permission চেক (যদি রিকোয়ার্ড থাকে)
    if (requiredPermission) {
      const userPermissions = Array.isArray(profile.permissions) 
        ? profile.permissions 
        : [];
        
      if (!userPermissions.includes(requiredPermission)) {
        return { 
          error: `Access Denied: Missing '${requiredPermission}' permission`, 
          status: 403 
        };
      }
    }

    return { user, profile };
  } catch (error) {
    console.error("AUTH CHECK ERROR:", error);
    return { error: "Internal Server Error", status: 500 };
  }
}
