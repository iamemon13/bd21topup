import { supabaseAdmin } from "@/lib/supabase-admin";

type FinancialAction = {
  adminId: string;
  operation: "wallet" | "withdrawal" | "cancel_order" | "add_money" | "undo_add_money";
  targetId: string;
  action?: string;
  amount?: number;
  note?: string | null;
  bulk?: boolean;
  ip?: string;
};

// Actor comes from checkUserRole/getUser, never the submitted request body.
export function financialAction(input: FinancialAction) {
  return supabaseAdmin.rpc("admin_financial_action", {
    p_admin_id: input.adminId,
    p_operation: input.operation,
    p_target_id: input.targetId,
    p_action: input.action ?? null,
    p_amount: input.amount ?? null,
    p_note: input.note ?? null,
    p_bulk: input.bulk ?? false,
    p_ip: input.ip?.slice(0, 100) || "unknown",
  });
}
