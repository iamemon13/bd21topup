import { supabaseAdmin } from "@/lib/supabase-admin";
import { supportContactUrl, type SupportCase } from "@/lib/support";

type CaseRow = {
  support_id: string;
  status: SupportCase["status"];
  reason: string;
};

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
    if (error) throw new Error("Support cases could not be loaded");
    for (const row of data ?? []) {
      const support = publicSupportCase(row);
      byOperation.set(`${row.case_type}:${row.order_id ?? row.add_money_request_id ?? row.withdrawal_id}`, support);
      byId.set(row.id, support);
    }
    if (!data || data.length < pageSize) break;
  }
  return { byOperation, byId };
}
