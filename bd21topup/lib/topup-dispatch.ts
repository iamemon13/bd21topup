import "server-only";
import { createHash } from "node:crypto";
import { generateTopupPreview, PreviewError, type PreviewDebit, type PreviewOrder, type PreviewPackage } from "@/lib/topup-preview";
import { resolveTopupMapping } from "@/lib/topup-mappings";

export type DispatchOperationInput = {
  productCode: string;
  quantity: number;
  commandHash: string;
};

type TopupDispatchQueryResult<T> = { data: T | null; error: { code?: string; message?: string } | null };
type TopupDispatchQuery<T> = {
  eq(column: string, value: string): TopupDispatchQuery<T>;
  limit(value: number): TopupDispatchQuery<T>;
  maybeSingle(): PromiseLike<TopupDispatchQueryResult<T>>;
  then<TResult1 = TopupDispatchQueryResult<T>, TResult2 = never>(
    onfulfilled?: ((value: TopupDispatchQueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
};

export type TopupDispatchSupabaseClient = {
  from(table: string): { select(columns: string): unknown };
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

export type AutoTopupDispatchResult =
  | { attempted: false; reason: "disabled" | "missing_admin_id" | "not_eligible" }
  | { attempted: true; dispatchId: string; created: boolean }
  | { attempted: true; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}(?![\s\S])/i;
type AutoTopupDispatchEnv = Record<string, string | undefined>;

export function autoTopupDispatchEnabled(env: AutoTopupDispatchEnv = process.env) {
  return env.AUTO_TOPUP_DISPATCH_ENABLED === "true";
}

export function loadAutoTopupDispatchAdminId(
  env: AutoTopupDispatchEnv = process.env,
) {
  const value = env.AUTO_TOPUP_DISPATCH_ADMIN_ID?.trim();
  return value && UUID.test(value) ? value : null;
}

export function buildDryRunDispatch(
  order: PreviewOrder,
  packages: PreviewPackage[],
  evidence: PreviewDebit[],
) {
  const preview = generateTopupPreview(order, packages, evidence);
  const mapping = resolveTopupMapping(packages[0]);
  if (!mapping) throw new Error("Validated mapping disappeared.");
  const operations: DispatchOperationInput[] = mapping.operations.map((operation, index) => ({
    productCode: operation.item,
    quantity: operation.quantity ?? 1,
    commandHash: createHash("sha256").update(
      `bd21-topup-op-v1|${preview.mappingVersion}|${preview.uid}|${index + 1}|${operation.item}|${operation.quantity ?? 1}`,
    ).digest("hex"),
  }));
  return { preview, operations };
}

export async function createOrReuseAutoTopupDispatchForWalletOrder(
  supabase: TopupDispatchSupabaseClient,
  orderId: string,
  options: {
    adminId?: string | null;
    env?: AutoTopupDispatchEnv;
    ip?: string;
  } = {},
): Promise<AutoTopupDispatchResult> {
  if (!autoTopupDispatchEnabled(options.env)) return { attempted: false, reason: "disabled" };
  const adminId = options.adminId ?? loadAutoTopupDispatchAdminId(options.env);
  if (!adminId) return { attempted: false, reason: "missing_admin_id" };

  try {
    const orderQuery = supabase.from("orders")
      .select("id,user_id,uid,package_name,amount,payment_method,status,cancelled_at") as TopupDispatchQuery<PreviewOrder>;
    const { data: order, error: orderError } = await orderQuery.eq("id", orderId).maybeSingle();
    if (orderError) return { attempted: true, error: "order_read_failed" };
    if (!order) throw new PreviewError("ORDER_NOT_FOUND", "Order not found.", 404);

    const [catalog, ledger] = await Promise.all([
      (supabase.from("packages").select("id,name,category") as TopupDispatchQuery<PreviewPackage[]>).eq("name", order.package_name).limit(2),
      (supabase.from("wallet_transactions").select("id,reference_id,user_id,amount,type,direction") as TopupDispatchQuery<PreviewDebit[]>).eq("reference_id", orderId).limit(2),
    ]);
    if (catalog.error || ledger.error || !catalog.data || !ledger.data)
      return { attempted: true, error: "evidence_read_failed" };

    const candidate = buildDryRunDispatch(
      order,
      catalog.data,
      ledger.data,
    );
    const { data: result, error: createError } = await supabase.rpc("admin_create_topup_dispatch_dry_run", {
      p_admin_id: adminId,
      p_order_id: candidate.preview.orderId,
      p_package_id: candidate.preview.packageId,
      p_mapping_version: candidate.preview.mappingVersion,
      p_operations: candidate.operations,
      p_ip: (options.ip || "wallet-order-auto").slice(0, 100),
    });
    if (createError) return { attempted: true, error: createError.code || "dispatch_create_failed" };
    const row = Array.isArray(result) ? result[0] : result;
    if (!row || typeof row !== "object" || !("dispatch_id" in row) || typeof row.dispatch_id !== "string")
      return { attempted: true, error: "dispatch_create_unconfirmed" };
    return { attempted: true, dispatchId: row.dispatch_id, created: Boolean("created" in row && row.created) };
  } catch (error) {
    if (error instanceof PreviewError) return { attempted: false, reason: "not_eligible" };
    return { attempted: true, error: "dispatch_create_unavailable" };
  }
}
