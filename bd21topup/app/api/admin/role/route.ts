import { NextResponse } from "next/server";
import { supabaseAdmin, logAdminAction } from "@/lib/supabase-admin";

const ALLOWED_ROLES = ["super_admin", "admin", "editor", "user"] as const;

const ALLOWED_PERMISSIONS = [
  "manage_users",
  "manage_orders",
  "manage_add_money",
  "manage_withdrawals",
  "manage_packages",
] as const;

type AllowedRole = (typeof ALLOWED_ROLES)[number];
type AllowedPermission = (typeof ALLOWED_PERMISSIONS)[number];

function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7).trim();

  return token || null;
}

function isValidUuid(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isAllowedRole(value: unknown): value is AllowedRole {
  return (
    typeof value === "string" &&
    (ALLOWED_ROLES as readonly string[]).includes(value)
  );
}

function isAllowedPermission(value: unknown): value is AllowedPermission {
  return (
    typeof value === "string" &&
    (ALLOWED_PERMISSIONS as readonly string[]).includes(value)
  );
}

/* =========================================================
   GET
   Return current authenticated user's role + permissions
========================================================= */

export async function GET(request: Request) {
  try {
    const token = getBearerToken(request);

    if (!token) {
      return NextResponse.json(
        { error: "Missing or invalid authorization token." },
        { status: 401 },
      );
    }

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      console.error("ADMIN ROLE AUTH ERROR:", authError);

      return NextResponse.json(
        { error: "Invalid or expired session." },
        { status: 401 },
      );
    }

    const { data: adminData, error: adminRoleError } = await supabaseAdmin
      .from("admin_roles")
      .select("role, permissions")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminRoleError) {
      console.error("ADMIN ROLE GET ERROR:", adminRoleError);

      return NextResponse.json(
        { error: "Failed to fetch account role." },
        { status: 500 },
      );
    }

    /*
     * No admin_roles record means this is a normal user.
     *
     * Important:
     * Returning "user" instead of null keeps frontend
     * authorization/redirect logic consistent.
     */
    return NextResponse.json({
      role: adminData?.role || "user",
      permissions: Array.isArray(adminData?.permissions)
        ? adminData.permissions
        : [],
    });
  } catch (error) {
    console.error("UNHANDLED EXCEPTION IN GET /api/admin/role:", error);

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

/* =========================================================
   PATCH
   Update another user's role + permissions
   Super Admin only
========================================================= */

export async function PATCH(request: Request) {
  try {
    const token = getBearerToken(request);

    if (!token) {
      return NextResponse.json(
        { error: "Missing or invalid authorization token." },
        { status: 401 },
      );
    }

    /* -----------------------------------------------------
       1. Authenticate requester
    ----------------------------------------------------- */

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      console.error("ADMIN ROLE PATCH AUTH ERROR:", authError);

      return NextResponse.json(
        { error: "Invalid or expired session." },
        { status: 401 },
      );
    }

    /* -----------------------------------------------------
       2. Verify requester is Super Admin
    ----------------------------------------------------- */

    const { data: requesterAdminData, error: requesterRoleError } =
      await supabaseAdmin
        .from("admin_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

    if (requesterRoleError) {
      console.error("ADMIN ROLE REQUESTER LOOKUP ERROR:", requesterRoleError);

      return NextResponse.json(
        { error: "Failed to verify administrator privileges." },
        { status: 500 },
      );
    }

    if (requesterAdminData?.role !== "super_admin") {
      return NextResponse.json(
        {
          error: "Unauthorized. Only Super Admin can change roles.",
        },
        { status: 403 },
      );
    }

    /* -----------------------------------------------------
       3. Parse request body safely
    ----------------------------------------------------- */

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400 },
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 },
      );
    }

    const requestBody = body as Record<string, unknown>;

    const userId = requestBody.userId;
    const role = requestBody.role;
    const permissions = requestBody.permissions;

    /* -----------------------------------------------------
       4. Validate target user ID
    ----------------------------------------------------- */

    if (!isValidUuid(userId)) {
      return NextResponse.json({ error: "Invalid user ID." }, { status: 400 });
    }

    /* -----------------------------------------------------
       5. Validate role
    ----------------------------------------------------- */

    if (!isAllowedRole(role)) {
      return NextResponse.json(
        { error: "Invalid role specified." },
        { status: 400 },
      );
    }

    /* -----------------------------------------------------
       6. Validate permissions type
    ----------------------------------------------------- */

    if (
      permissions !== undefined &&
      permissions !== null &&
      !Array.isArray(permissions)
    ) {
      return NextResponse.json(
        { error: "Permissions must be an array." },
        { status: 400 },
      );
    }

    const rawPermissions =
      permissions === undefined || permissions === null ? [] : permissions;

    /*
     * Array.isArray was checked above.
     * This additional guard keeps TypeScript/runtime logic explicit.
     */
    if (!Array.isArray(rawPermissions)) {
      return NextResponse.json(
        { error: "Permissions must be an array." },
        { status: 400 },
      );
    }

    /* -----------------------------------------------------
       7. Whitelist every permission
    ----------------------------------------------------- */

    if (!rawPermissions.every(isAllowedPermission)) {
      return NextResponse.json(
        { error: "Invalid permission specified." },
        { status: 400 },
      );
    }

    /*
     * Remove duplicates.
     *
     * Example:
     * ["manage_orders", "manage_orders"]
     *
     * becomes:
     * ["manage_orders"]
     */
    let normalizedPermissions: AllowedPermission[] = [
      ...new Set(rawPermissions),
    ];

    /*
     * Normal users must never carry admin permissions.
     */
    if (role === "user") {
      normalizedPermissions = [];
    }

    /* -----------------------------------------------------
       8. Prevent Super Admin self-demotion
    ----------------------------------------------------- */

    if (user.id === userId && role !== "super_admin") {
      return NextResponse.json(
        {
          error:
            "Security risk: You cannot demote your own Super Admin account.",
        },
        { status: 403 },
      );
    }

    /* -----------------------------------------------------
       9. Update / insert role
    ----------------------------------------------------- */

    const { error: updateError } = await supabaseAdmin
      .from("admin_roles")
      .upsert(
        {
          user_id: userId,
          role,
          permissions: normalizedPermissions,
        },
        {
          onConflict: "user_id",
        },
      );

    if (updateError) {
      console.error("ROLE UPDATE DB ERROR:", updateError);

      /*
       * FK violation usually means target auth user
       * does not exist.
       */
      if (updateError.code === "23503") {
        return NextResponse.json(
          { error: "Target user does not exist." },
          { status: 404 },
        );
      }

      return NextResponse.json(
        { error: "Failed to update role in database." },
        { status: 500 },
      );
    }

    /* -----------------------------------------------------
       10. Audit log
    ----------------------------------------------------- */

    await logAdminAction({
      adminId: user.id,
      actionType: "UPDATE_USER_ROLE",
      targetId: userId,
      details: `Role updated to ${role}. Permissions: ${
        normalizedPermissions.length > 0
          ? normalizedPermissions.join(", ")
          : "none"
      }`,
    });

    /* -----------------------------------------------------
       11. Success
    ----------------------------------------------------- */

    return NextResponse.json({
      success: true,
      role,
      permissions: normalizedPermissions,
    });
  } catch (error) {
    console.error("UNHANDLED EXCEPTION IN PATCH /api/admin/role:", error);

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
