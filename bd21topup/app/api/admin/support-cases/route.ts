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
      .select("support_id, case_type, status, reason, created_at, updated_at, order_id, add_money_request_id, withdrawal_id")
      .eq("support_id", supportId).maybeSingle();
    if (error && isSupportTableMissing(error)) {
      return respond({ error: "Support Case এখনো চালু হয়নি। Database migration প্রয়োজন।" }, 503);
    }
    if (error) throw new Error("Support lookup failed");
    if (!data) return respond({ error: "Support Case পাওয়া যায়নি।" }, 404);
    return respond({
      support: publicSupportCase(data), caseType: data.case_type,
      createdAt: data.created_at, updatedAt: data.updated_at,
      // The related ID is useful only to authorized staff inspecting the existing admin record.
      operationId: data.order_id ?? data.add_money_request_id ?? data.withdrawal_id,
    });
  } catch {
    return respond({ error: "Support Case লোড করা যায়নি।" }, 500);
  }
}
