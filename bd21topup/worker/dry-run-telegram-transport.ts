import { createHash } from "node:crypto";
import type { DeliveryOperation, DeliveryResult, TelegramTransport } from "./telegram-transport";

// Pure deterministic adapter: no socket, HTTP, MTProto, Bot API, credentials, or timers.
export class DryRunTelegramTransport implements TelegramTransport {
  async sendOperation(operation: DeliveryOperation): Promise<DeliveryResult> {
    const resultHash = createHash("sha256").update(`dry-run:${operation.operationId}:${operation.commandHash}`).digest("hex");
    return { kind: "dry_run_completed", dryRun: true, resultHash, summary: "DRY_RUN_NO_NETWORK" };
  }
}
