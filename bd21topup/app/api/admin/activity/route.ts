import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) return null;

  return authHeader.slice(7).trim() || null;
}

function parsePositiveInt(
  value: string | null,
  fallback: number,
  max?: number,
): number | null {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) return null;

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  if (max !== undefined && parsed > max) return null;

  return parsed;
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isValidActionType(value: string): boolean {
  return /^[A-Za-z0-9_.:-]{1,100}$/.test(value);
}

function isValidSearch(value: string): boolean {
  return value.length >= 1 && value.length <= 100 && !/[\r\n]/.test(value);
}

function escapePostgrestSearch(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/,/g, "\\,")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function sanitizeDetails(value: unknown): string | null {
  if (typeof value !== "string") return null;

  return value
    .replace(
      /(authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .slice(0, 2000);
}

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
      return NextResponse.json(
        { error: "Invalid or expired session." },
        { status: 401 },
      );
    }

    const { data: requesterRole, error: roleError } = await supabaseAdmin
      .from("admin_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleError) {
      console.error("ADMIN ACTIVITY ROLE CHECK ERROR:", roleError);

      return NextResponse.json(
        { error: "Failed to verify administrator privileges." },
        { status: 500 },
      );
    }

    if (requesterRole?.role !== "super_admin") {
      return NextResponse.json(
        { error: "Super Admin access required." },
        { status: 403 },
      );
    }

    const url = new URL(request.url);

    const page = parsePositiveInt(url.searchParams.get("page"), 1);
    const limit = parsePositiveInt(
      url.searchParams.get("limit"),
      DEFAULT_LIMIT,
      MAX_LIMIT,
    );

    if (page === null || limit === null || page > 100000) {
      return NextResponse.json(
        { error: "Invalid pagination parameters." },
        { status: 400 },
      );
    }

    const actionType = url.searchParams.get("action_type")?.trim() || "";

    const adminId = url.searchParams.get("admin_id")?.trim() || "";

    const search = url.searchParams.get("search")?.trim() || "";

    if (actionType && !isValidActionType(actionType)) {
      return NextResponse.json(
        { error: "Invalid action type." },
        { status: 400 },
      );
    }

    if (adminId && !isValidUuid(adminId)) {
      return NextResponse.json({ error: "Invalid admin ID." }, { status: 400 });
    }

    if (search && !isValidSearch(search)) {
      return NextResponse.json(
        { error: "Invalid search query." },
        { status: 400 },
      );
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabaseAdmin
      .from("admin_audit_logs")
      .select(
        "id, admin_id, action_type, target_id, details, ip_address, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(from, to);

    if (actionType) {
      query = query.eq("action_type", actionType);
    }

    if (adminId) {
      query = query.eq("admin_id", adminId);
    }

    if (search) {
      const safeSearch = escapePostgrestSearch(search);

      query = query.or(
        [
          `action_type.ilike.%${safeSearch}%`,
          `target_id.ilike.%${safeSearch}%`,
          `details.ilike.%${safeSearch}%`,
          `ip_address.ilike.%${safeSearch}%`,
        ].join(","),
      );
    }

    const { data: logs, error: logsError, count } = await query;

    if (logsError) {
      console.error("ADMIN ACTIVITY QUERY ERROR:", logsError);

      return NextResponse.json(
        { error: "Failed to fetch activity logs." },
        { status: 500 },
      );
    }

    const adminIds = [
      ...new Set(
        (logs ?? [])
          .map((log) => log.admin_id)
          .filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0,
          ),
      ),
    ];

    const roleMap = new Map<string, string>();

    if (adminIds.length > 0) {
      const { data: roles, error: rolesError } = await supabaseAdmin
        .from("admin_roles")
        .select("user_id, role")
        .in("user_id", adminIds);

      if (rolesError) {
        console.error("ADMIN ACTIVITY ACTOR ROLE LOOKUP ERROR:", rolesError);
      } else {
        for (const row of roles ?? []) {
          if (typeof row.user_id === "string" && typeof row.role === "string") {
            roleMap.set(row.user_id, row.role);
          }
        }
      }
    }

    const emailMap = new Map<string, string>();

    await Promise.all(
      adminIds.map(async (id) => {
        try {
          const { data, error } =
            await supabaseAdmin.auth.admin.getUserById(id);

          if (!error && data.user?.email) {
            emailMap.set(id, data.user.email);
          }
        } catch (error) {
          console.error("ADMIN ACTIVITY EMAIL LOOKUP ERROR:", error);
        }
      }),
    );

    const items = (logs ?? []).map((log) => ({
      id: log.id,
      adminId: log.admin_id,
      adminEmail:
        typeof log.admin_id === "string"
          ? (emailMap.get(log.admin_id) ?? null)
          : null,
      adminRole:
        typeof log.admin_id === "string"
          ? (roleMap.get(log.admin_id) ?? null)
          : null,
      actionType: log.action_type,
      targetId: log.target_id,
      details: sanitizeDetails(log.details),
      ipAddress:
        typeof log.ip_address === "string"
          ? log.ip_address.slice(0, 100)
          : null,
      createdAt: log.created_at,
    }));

    const total = count ?? 0;

    return NextResponse.json({
      success: true,
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasPreviousPage: page > 1,
        hasNextPage: page * limit < total,
      },
      filters: {
        actionType: actionType || null,
        adminId: adminId || null,
        search: search || null,
      },
    });
  } catch (error) {
    console.error("UNHANDLED GET /api/admin/activity ERROR:", error);

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
