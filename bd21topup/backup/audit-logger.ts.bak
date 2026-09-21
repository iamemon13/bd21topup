import { supabaseAdmin } from "@/lib/supabase-admin";

interface AuditLogParams {
  adminId: string;
  actionType: string;
  targetId?: string;
  details?: string;
  ipAddress?: string;
}

export async function logAdminAction({
  adminId,
  actionType,
  targetId,
  details,
  ipAddress = "unknown",
}: AuditLogParams) {
  try {
    const { error } = await supabaseAdmin.from("admin_audit_logs").insert({
      admin_id: adminId,
      action_type: actionType,
      target_id: targetId,
      details: details,
      ip_address: ipAddress,
    });

    if (error) {
      console.error("❌ AUDIT LOG ERROR:", error.message);
    } else {
      console.log(`✅ AUDIT LOGGED: ${actionType} on ${targetId}`);
    }
  } catch (err) {
    console.error("❌ AUDIT LOG EXCEPTION:", err);
  }
}
