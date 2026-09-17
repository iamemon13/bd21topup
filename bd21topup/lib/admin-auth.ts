import { supabaseAdmin } from "@/lib/supabase-admin";

export async function checkUserRole(request: Request, allowedRoles: string[]) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: "Unauthorized", status: 401 };
  }

  const token = authHeader.replace("Bearer ", "").trim();
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return { error: "Unauthorized", status: 401 };
  }

  // প্রোফাইল টেবিল থেকে ইউজারের রোল ফেচ করা
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return { error: "User role not found", status: 403 };
  }

  const userRole = profile.role || "user";

  // যদি ইউজারের রোল অনুমديত রোলগুলোর ভেতরে না থাকে
  if (!allowedRoles.includes(userRole)) {
    return { error: "Access Denied: You do not have permission", status: 403 };
  }

  return { user, role: userRole };
}
