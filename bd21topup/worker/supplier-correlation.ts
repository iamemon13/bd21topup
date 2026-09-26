export type SupplierReplyFixture = {
  senderEntityId: string;
  messageId: string;
  replyToMessageId?: string;
  text: string;
};
export type CorrelationTarget = {
  supplierEntityId: string;
  sentMessageId: string;
  uid: string;
  productCode: string;
  quantity: number;
};

function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function extract(text: string, pattern: RegExp) { return text.match(pattern)?.[1] ?? null; }
function validateTarget(target: CorrelationTarget) {
  if (!/^-?[1-9][0-9]*$/.test(target.supplierEntityId) || !/^[1-9][0-9]*$/.test(target.sentMessageId)
    || !/^[0-9]{5,15}$/.test(target.uid) || !/^[a-z0-9]+$/i.test(target.productCode)
    || !Number.isInteger(target.quantity) || target.quantity < 1 || target.quantity > 5) {
    throw new Error("Invalid supplier correlation target.");
  }
}

export function correlateSupplierReply(reply: SupplierReplyFixture, target: CorrelationTarget) {
  validateTarget(target);
  if (reply.senderEntityId !== target.supplierEntityId)
    return { state: "ignored" as const, reason: "Reply was not sent by the pinned supplier." };
  if (!/^[1-9][0-9]*$/.test(reply.messageId))
    return { state: "manual_review" as const, reason: "Supplier reply has invalid identity metadata." };
  if (!reply.replyToMessageId || reply.replyToMessageId !== target.sentMessageId)
    return { state: "manual_review" as const, reason: "Supplier reply is not linked to the exact sent command." };

  const uid = escapeRegex(target.uid), product = escapeRegex(target.productCode), quantity = String(target.quantity);
  const hasQuotedCommand = new RegExp(`\\bKtp\\s+${uid}\\s+${product}\\s+${quantity}(?:\\D|$)`, "i").test(reply.text);
  const hasUid = hasQuotedCommand || new RegExp(`\\bUID\\s*[:#=-]\\s*${uid}(?:\\D|$)`, "i").test(reply.text);
  const hasProduct = new RegExp(`(?:product|diamond(?:s)?|package)\\s*[:#=-]?\\s*${product}(?:\\D|$)`, "i").test(reply.text);
  const hasQuantity = new RegExp(`(?:qty|quantity)\\s*[:#=-]?\\s*${quantity}(?:\\D|$)`, "i").test(reply.text);
  const hasProductQuantity = hasProduct && (hasQuantity
    || new RegExp(`\\(\\s*${product}\\s*[x×]\\s*${quantity}\\s*\\)`, "i").test(reply.text));
  const hasSuccessMarkers = /\bTOPUP\s+DONE\b/i.test(reply.text) && /\bSUCCESS\b/i.test(reply.text);
  const supplierOrderId = extract(reply.text, /\b(?:supplier\s+)?order\s*id\s*[:=-]\s*#?\s*([A-Za-z0-9_-]{3,100})\b/i);
  const supplierReference = extract(reply.text, /\b(UP(?:RID|BD)-[A-Z0-9]+-[A-Z0-9]+-[0-9]{8})\b/i);
  if (!hasUid || !(hasQuotedCommand || hasProductQuantity) || !hasSuccessMarkers || !supplierOrderId || !supplierReference)
    return { state: "manual_review" as const, reason: "Supplier response did not satisfy strict success correlation." };
  return { state: "confirmed" as const, supplierOrderId, supplierReference };
}

export class SupplierCorrelationTracker {
  private readonly processedMessageIds = new Set<string>();
  process(reply: SupplierReplyFixture, target: CorrelationTarget) {
    const key = `${reply.senderEntityId}:${reply.messageId}`;
    if (this.processedMessageIds.has(key)) return { state: "duplicate" as const, reason: "Supplier reply was already processed." };
    const result = correlateSupplierReply(reply, target); this.processedMessageIds.add(key); return result;
  }
}
