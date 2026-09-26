import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimedOperation, DispatchQueue } from "./runner";

export class SupabaseDispatchQueue implements DispatchQueue {
  constructor(private readonly client: SupabaseClient) {}
  async claim(workerId: string, dispatchId?: string): Promise<ClaimedOperation | null> {
    const { data, error } = await this.client.rpc("claim_topup_dispatch_operation_dry_run", {
      p_worker_id: workerId,
      p_dispatch_id: dispatchId ?? null,
    });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) ?? null;
  }
  async inspectDispatch(dispatchId: string) {
    const dispatchResult = await this.client
      .from("topup_dispatches")
      .select("id,status,dry_run,uid_snapshot")
      .eq("id", dispatchId)
      .maybeSingle();
    if (dispatchResult.error) throw dispatchResult.error;
    if (!dispatchResult.data) throw new Error("Pilot dispatch was not found.");

    const operationsResult = await this.client
      .from("topup_dispatch_operations")
      .select("id,sequence_no,product_code,quantity,command_hash,status")
      .eq("dispatch_id", dispatchId)
      .order("sequence_no", { ascending: true });
    if (operationsResult.error) throw operationsResult.error;
    return { dispatch: dispatchResult.data, operations: operationsResult.data ?? [] };
  }
  async preflightDispatch(dispatchId: string) {
    const { data, error } = await this.client.rpc("preflight_topup_dispatch_dry_run", {
      p_dispatch_id: dispatchId,
    });
    if (error) throw error;
    if (!data) throw new Error("Dispatch is not eligible and fresh for a controlled pilot.");
    return data;
  }
  async startSendIntent(operationId: string, workerId: string, sendIntentId: string) {
    const { data, error } = await this.client.rpc("start_topup_dispatch_send_intent_dry_run", {
      p_operation_id: operationId, p_worker_id: workerId, p_send_intent_id: sendIntentId,
    });
    if (error) throw error;
    if (data == null) throw new Error("Authoritative dispatch evidence changed before send intent.");
  }
  async finish(operationId: string, workerId: string, sendIntentId: string, outcome: "dry_run_completed" | "failed" | "uncertain", resultHash: string, reason?: string) {
    const { error } = await this.client.rpc("finish_topup_dispatch_operation_dry_run", {
      p_operation_id: operationId, p_worker_id: workerId, p_send_intent_id: sendIntentId, p_outcome: outcome,
      p_result_hash: resultHash, p_reason: reason ?? null,
    });
    if (error) throw error;
  }
}
