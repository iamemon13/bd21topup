import { supabaseAdmin } from "@/lib/supabase-admin";
import { supportContactUrl, type SupportCase } from "@/lib/support";

type CaseRow = {
  support_id: string;
  status: SupportCase["status"];
  reason: string;
};

type DatabaseError = { code?: string; message?: string };

// Only a missing rollout schema is optional. Permission/network/query failures
// must still fail closed rather than silently hiding security or data problems.
export function isSupportTableMissing(error: DatabaseError) {
  return ["42P01", "PGRST205"].includes(error.code ?? "") &&
    /\bsupport_cases\b/.test(error.message ?? "");
}

export function isSupportNotificationColumnMissing(error: DatabaseError) {
  return ["42703", "PGRST204"].includes(error.code ?? "") &&
    /\bsupport_case_id\b/.test(error.message ?? "") &&
    /\bnotifications\b/.test(error.message ?? "");
}

export function publicSupportCase(row: CaseRow): SupportCase {
  return {
    supportId: row.support_id,
    status: row.status,
    reason: row.reason,
    contactUrl: supportContactUrl(row.support_id,
      process.env.SUPPORT_TELEGRAM_USERNAME || "BD21Support",
      process.env.SUPPORT_TELEGRAM_MODE || "chat"),
  };
}

// Call only with the user returned by auth.getUser(), never a request user ID.
export async function loadUserSupportCases(userId: string) {
  const byOperation = new Map<string, SupportCase>();
  const byId = new Map<string, SupportCase>();
  // PostgREST caps response rows: page explicitly so older history keeps its IDs.
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseAdmin.from("support_cases")
      .select("id, case_type, order_id, add_money_request_id, withdrawal_id, support_id, status, reason")
      .eq("user_id", userId).order("id").range(offset, offset + pageSize - 1);
    if (error) {
      if (isSupportTableMissing(error)) {
        return { byOperation: new Map<string, SupportCase>(), byId: new Map<string, SupportCase>(), available: false };
      }
      throw new Error("Support cases could not be loaded");
    }
    for (const row of data ?? []) {
      const support = publicSupportCase(row);
      byOperation.set(`${row.case_type}:${row.order_id ?? row.add_money_request_id ?? row.withdrawal_id}`, support);
      byId.set(row.id, support);
    }
    if (!data || data.length < pageSize) break;
  }
  return { byOperation, byId, available: true };
}
