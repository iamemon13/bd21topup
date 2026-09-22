import { NextResponse } from "next/server";
import { checkUserRole } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isSupportTableMissing, publicSupportCase } from "@/lib/support-cases";
import { supportPermission } from "@/lib/support";

// Apply to successes and errors, including negative lookups for private cases.
function respond(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
  });
}

export async function GET(request: Request) {
  try {
    const supportId = new URL(request.url).searchParams.get("supportId") ?? "";
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
