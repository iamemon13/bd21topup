import { NextResponse } from "next/server";
import { checkUserRole } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isSupportTableMissing, publicSupportCase } from "@/lib/support-cases";
import { supportPermission } from "@/lib/support";

const CASE_PERMISSIONS = {
  ORD: "manage_orders",
  ADD: "manage_add_money",
  WDR: "manage_withdrawals",
} as const;

type CaseType = keyof typeof CASE_PERMISSIONS;

type SupportCaseRow = {
  id: string;
  user_id: string;
  case_type: CaseType;
  support_id: string;
  status: "open" | "resolved" | "closed";
  reason: string;
  created_at: string;
  order_id: string | null;
  add_money_request_id: string | null;
  withdrawal_id: string | null;
  resolution_note?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
};

type ResolverProfile = {
  full_name: string | null;
  email: string | null;
};

function canReadCaseType(
  role: string,
  permissions: string[],
  caseType: CaseType,
) {
  return role === "super_admin" || permissions.includes(CASE_PERMISSIONS[caseType]);
}

// Apply to successes and errors, including negative lookups for private cases.
function respond(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
  });
}

async function loadResolverProfile(resolvedBy: string | null | undefined) {
  if (!resolvedBy) return null;
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("full_name, email")
    .eq("id", resolvedBy)
    .maybeSingle();
  if (error) throw new Error("Support resolver lookup failed");
  const profile = data as ResolverProfile | null;
  return profile
    ? { fullName: profile.full_name || null, email: profile.email || null }
    : null;
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const supportIdParam = searchParams.get("supportId");
    const supportId = supportIdParam ?? "";
    if (supportIdParam === null) {
      const auth = await checkUserRole(request, ["super_admin", "admin", "editor"]);
      if ("error" in auth) return respond({ error: auth.error }, auth.status);

      const readableTypes = (Object.keys(CASE_PERMISSIONS) as CaseType[])
        .filter((caseType) => canReadCaseType(auth.role, auth.permissions, caseType));

      if (readableTypes.length === 0) {
        return respond({ success: true, cases: [] });
      }

      const { data, error } = await supabaseAdmin.from("support_cases")
        .select("id, user_id, case_type, support_id, status, reason, created_at, order_id, add_money_request_id, withdrawal_id")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error && isSupportTableMissing(error)) {
        return respond({ error: "Support Case এখনো চালু হয়নি। Database migration প্রয়োজন।" }, 503);
      }
      if (error) throw new Error("Support case list failed");

      const cases = (data as SupportCaseRow[] | null ?? [])
        .filter((row) => readableTypes.includes(row.case_type))
        .map((row) => ({ row, operationId: row.order_id ?? row.add_money_request_id ?? row.withdrawal_id }));
      const userIds = [...new Set(cases.map(({ row }) => row.user_id))];
      const orderIds = cases.flatMap(({ row }) => row.order_id ? [row.order_id] : []);
      const addMoneyIds = cases.flatMap(({ row }) => row.add_money_request_id ? [row.add_money_request_id] : []);
      const withdrawalIds = cases.flatMap(({ row }) => row.withdrawal_id ? [row.withdrawal_id] : []);

      const [profilesResult, ordersResult, addMoneyResult, withdrawalsResult] = await Promise.all([
        userIds.length ? supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds) : Promise.resolve({ data: [], error: null }),
        orderIds.length ? supabaseAdmin.from("orders").select("id, status, amount, package_name").in("id", orderIds) : Promise.resolve({ data: [], error: null }),
        addMoneyIds.length ? supabaseAdmin.from("add_money_requests").select("id, status, amount, payment_method").in("id", addMoneyIds) : Promise.resolve({ data: [], error: null }),
        withdrawalIds.length ? supabaseAdmin.from("withdrawals").select("id, status, amount, method").in("id", withdrawalIds) : Promise.resolve({ data: [], error: null }),
      ]);

      if (profilesResult.error || ordersResult.error || addMoneyResult.error || withdrawalsResult.error) {
        throw new Error("Support case source lookup failed");
      }

      const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
      const orders = new Map((ordersResult.data ?? []).map((order) => [order.id, order]));
      const addMoneyRequests = new Map((addMoneyResult.data ?? []).map((request) => [request.id, request]));
      const withdrawals = new Map((withdrawalsResult.data ?? []).map((withdrawal) => [withdrawal.id, withdrawal]));

      return respond({
        success: true,
        cases: cases.map(({ row, operationId }) => {
          const source = row.case_type === "ORD"
            ? orders.get(operationId)
            : row.case_type === "ADD"
              ? addMoneyRequests.get(operationId)
              : withdrawals.get(operationId);
          const profile = profiles.get(row.user_id);
          return {
            support: publicSupportCase(row),
            caseType: row.case_type,
            currentStatus: source?.status ?? (row.case_type === "ORD" ? "cancelled" : "rejected"),
            operationId,
            createdAt: row.created_at,
            customer: {
              fullName: profile?.full_name || "BD21 User",
              email: profile?.email || "",
            },
            amount: source?.amount == null ? null : Number(source.amount),
            packageName: row.case_type === "ORD" ? orders.get(operationId)?.package_name ?? null : null,
            method: row.case_type === "ADD"
              ? addMoneyRequests.get(operationId)?.payment_method ?? null
              : row.case_type === "WDR"
                ? withdrawals.get(operationId)?.method ?? null
                : null,
          };
        }),
      });
    }

    const permission = supportPermission(supportId);
    if (!permission) return respond({ error: "সঠিক Support ID দিন।" }, 400);
    // Permission is checked before lookup; knowing the reference grants no access.
    const auth = await checkUserRole(request, ["super_admin", "admin", "editor"], permission);
    if ("error" in auth) return respond({ error: auth.error }, auth.status);
    const { data, error } = await supabaseAdmin.from("support_cases")
      .select("id, support_id, case_type, status, reason, created_at, updated_at, order_id, add_money_request_id, withdrawal_id, resolution_note, resolved_at, resolved_by")
      .eq("support_id", supportId).maybeSingle();
    if (error && isSupportTableMissing(error)) {
      return respond({ error: "Support Case এখনো চালু হয়নি। Database migration প্রয়োজন।" }, 503);
    }
    if (error) throw new Error("Support lookup failed");
    if (!data) return respond({ error: "Support Case পাওয়া যায়নি।" }, 404);
    const resolver = await loadResolverProfile(data.resolved_by);
    return respond({
      support: publicSupportCase(data), caseType: data.case_type,
      createdAt: data.created_at, updatedAt: data.updated_at,
      resolutionNote: data.resolution_note ?? null,
      resolvedAt: data.resolved_at ?? null,
      resolvedBy: resolver,
      // The related ID is useful only to authorized staff inspecting the existing admin record.
      operationId: data.order_id ?? data.add_money_request_id ?? data.withdrawal_id,
    });
  } catch {
    return respond({ error: "Support Case লোড করা যায়নি।" }, 500);
  }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return respond({ error: "সঠিক resolution note দিন।" }, 400);
    }

    const supportId = typeof body === "object" && body !== null && "supportId" in body &&
      typeof body.supportId === "string"
      ? body.supportId.trim().toUpperCase()
      : "";
    const resolutionNote = typeof body === "object" && body !== null && "resolutionNote" in body &&
      typeof body.resolutionNote === "string"
      ? body.resolutionNote.trim()
      : "";
    const permission = supportPermission(supportId);
    if (!permission) return respond({ error: "সঠিক Support ID দিন।" }, 400);
    if (!resolutionNote || resolutionNote.length > 500) {
      return respond({ error: "Resolution Note আবশ্যক এবং ৫০০ অক্ষরের মধ্যে হতে হবে।" }, 400);
    }

    const auth = await checkUserRole(request, ["super_admin", "admin", "editor"], permission);
    if ("error" in auth) return respond({ error: auth.error }, auth.status);

    const { data: caseRow, error: lookupError } = await supabaseAdmin
      .from("support_cases")
      .select("id, support_id, case_type, status, reason, created_at, updated_at, order_id, add_money_request_id, withdrawal_id")
      .eq("support_id", supportId)
      .maybeSingle();
    if (lookupError && isSupportTableMissing(lookupError)) {
      return respond({ error: "Support Case এখনো চালু হয়নি। Database migration প্রয়োজন।" }, 503);
    }
    if (lookupError) throw new Error("Support case resolution lookup failed");
    if (!caseRow) return respond({ error: "Support Case পাওয়া যায়নি।" }, 404);

    const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip")?.trim() || "unknown";
    const { data: resolvedRows, error: resolveError } = await supabaseAdmin.rpc(
      "admin_resolve_support_case",
      {
        p_admin_id: auth.user.id,
        p_support_case_id: caseRow.id,
        p_resolution_note: resolutionNote,
        p_ip: ipAddress,
      },
    );
    if (resolveError) {
      if (resolveError.code === "42501") return respond({ error: "এই Support Case resolve করার permission নেই।" }, 403);
      if (resolveError.code === "22023") return respond({ error: "Resolution Note সঠিক নয়।" }, 400);
      if (resolveError.code === "P0002") return respond({ error: "Support Case পাওয়া যায়নি।" }, 404);
      if (resolveError.code === "55000") return respond({ error: "Support Case ইতোমধ্যে resolve বা close করা হয়েছে।" }, 409);
      console.error("SUPPORT CASE RESOLUTION ERROR:", resolveError);
      return respond({ error: "Support Case resolve করা যায়নি।" }, 500);
    }

    const resolved = Array.isArray(resolvedRows) ? resolvedRows[0] : null;
    if (!resolved) return respond({ error: "Support Case resolve করা যায়নি।" }, 500);
    const resolver = await loadResolverProfile(resolved.resolved_by);
    return respond({
      success: true,
      support: publicSupportCase(resolved),
      caseType: resolved.case_type,
      createdAt: caseRow.created_at,
      updatedAt: resolved.updated_at,
      resolutionNote: resolved.resolution_note,
      resolvedAt: resolved.resolved_at,
      resolvedBy: resolver,
      operationId: caseRow.order_id ?? caseRow.add_money_request_id ?? caseRow.withdrawal_id,
    });
  } catch {
    return respond({ error: "Support Case resolve করা যায়নি।" }, 500);
  }
}
