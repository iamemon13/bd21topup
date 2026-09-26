import { createHash } from "node:crypto";
import type { DeliveryOperation, DeliveryResult, TelegramTransport } from "./telegram-transport";
import type { MtprotoGateway } from "./mtproto-gateway";
import { redactTelegramError, requireRealSend, type TelegramConfig } from "./telegram-config.ts";
import { correlateSupplierReply } from "./supplier-correlation.ts";

function buildSupplierCommand(operation: DeliveryOperation) {
  if (!/^[0-9]{5,15}$/.test(operation.uid)) throw new Error("Validated operation UID is invalid.");
  if (!/^[a-z0-9]+$/i.test(operation.productCode)) throw new Error("Validated product code is invalid.");
  if (!Number.isInteger(operation.quantity) || operation.quantity < 1 || operation.quantity > 5) {
    throw new Error("Validated operation quantity is invalid.");
  }
  return `Ktp ${operation.uid} ${operation.productCode} ${operation.quantity}`;
}

export class RealTelegramTransport implements TelegramTransport {
  private readonly attempted = new Set<string>();
  private readonly config: ReturnType<typeof requireRealSend>;

  constructor(config: TelegramConfig, private readonly gateway: MtprotoGateway) {
    this.config = requireRealSend(config);
  }

  async sendOperation(operation: DeliveryOperation): Promise<DeliveryResult> {
    if (this.attempted.has(operation.operationId)) {
      throw new Error("Telegram operation already attempted; manual review required.");
    }
    this.attempted.add(operation.operationId);
    const command = buildSupplierCommand(operation);
    try {
      await this.gateway.connect();
      const target = await this.gateway.resolve(this.config.supplierUsername);
      if (
        target.username.toLowerCase() !== this.config.supplierUsername ||
        target.id !== this.config.supplierEntityId
      ) {
        throw new Error("Configured Telegram supplier identity did not match.");
      }
      const sent = await this.gateway.sendText(this.config.supplierUsername, command);
      const correlationTarget = { supplierEntityId: this.config.supplierEntityId,
        sentMessageId: sent.messageId, uid: operation.uid };
      const reply = this.gateway.waitForReply
        ? await this.gateway.waitForReply(this.config.supplierUsername, this.config.supplierEntityId, sent.messageId, 30_000,
          (candidate) => correlateSupplierReply(candidate, correlationTarget).state === "confirmed")
        : null;
      if (!reply) {
        const resultHash = createHash("sha256").update(`telegram-send-v1|${operation.operationId}|${sent.messageId}|${sent.sentAt.toISOString()}`).digest("hex");
        return { kind: "uncertain", dryRun: false, resultHash, summary: "SUPPLIER_REPLY_TIMEOUT", supplierMessageId: sent.messageId };
      }
      const correlation = correlateSupplierReply(reply, correlationTarget);
      const resultHash = createHash("sha256").update(`telegram-reply-v1|${reply.senderEntityId}|${reply.messageId}|${reply.replyToMessageId ?? ""}|${reply.text}`).digest("hex");
      if (correlation.state !== "confirmed") {
        return { kind: "uncertain", dryRun: false, resultHash, summary: correlation.reason, supplierMessageId: sent.messageId,
          supplierResponse: { supplierEntityId: reply.senderEntityId, sentMessageId: sent.messageId,
            replyMessageId: reply.messageId, replyToMessageId: reply.replyToMessageId ?? "",
            uid: operation.uid, productCode: operation.productCode, quantity: operation.quantity } };
      }
      return { kind: "verified_success", dryRun: false, resultHash, summary: "SUPPLIER_VERIFIED_SUCCESS", supplierResponse: {
        supplierEntityId: reply.senderEntityId, sentMessageId: sent.messageId, replyMessageId: reply.messageId,
        replyToMessageId: reply.replyToMessageId!, uid: operation.uid,
        productCode: operation.productCode, quantity: operation.quantity,
      } };
    } catch (error) {
      throw redactTelegramError(error, [this.config.apiHash]);
    } finally {
      await this.gateway.disconnect().catch(() => undefined);
    }
  }
}
