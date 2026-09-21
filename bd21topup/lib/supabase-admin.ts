import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY!;

export const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

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
