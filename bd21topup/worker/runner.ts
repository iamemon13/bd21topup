import { randomUUID } from "node:crypto";
import type { TelegramTransport } from "./telegram-transport";

export type ClaimedOperation = { operation_id: string; dispatch_id: string; sequence_no: number; product_code: string; quantity: number; uid_snapshot: string; command_hash: string };
export interface DispatchQueue {
  claim(workerId: string, dispatchId?: string): Promise<ClaimedOperation | null>;
  startSendIntent(operationId: string, workerId: string, sendIntentId: string): Promise<void>;
  finish(operationId: string, workerId: string, sendIntentId: string, outcome: "dry_run_completed" | "failed" | "uncertain", resultHash: string, reason?: string): Promise<void>;
}

export async function runOneDryRun(queue: DispatchQueue, transport: TelegramTransport, workerId: string, dispatchId?: string) {
  const operation = await queue.claim(workerId, dispatchId);
  if (!operation) return null;
  const sendIntentId = randomUUID();
  await queue.startSendIntent(operation.operation_id, workerId, sendIntentId);
  // Intent is durable before transport. Any thrown/unknown result is uncertain.
  try {
    const result = await transport.sendOperation({ operationId: operation.operation_id, uid: operation.uid_snapshot,
      productCode: operation.product_code, quantity: operation.quantity, commandHash: operation.command_hash });
    await queue.finish(operation.operation_id, workerId, sendIntentId, result.kind, result.resultHash,
      result.kind === "uncertain" ? result.summary : undefined);
    return result;
  } catch {
    const fallbackHash = "0".repeat(64);
    await queue.finish(operation.operation_id, workerId, sendIntentId, "uncertain", fallbackHash, "Transport outcome unknown; manual review required.");
    return { kind: "uncertain" as const, dryRun: true as const, resultHash: fallbackHash, summary: "MANUAL_REVIEW" };
  }
}
