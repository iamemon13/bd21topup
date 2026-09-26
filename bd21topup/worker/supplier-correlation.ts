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
};

function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function validateTarget(target: CorrelationTarget) {
  if (!/^-?[1-9][0-9]*$/.test(target.supplierEntityId) || !/^[1-9][0-9]*$/.test(target.sentMessageId)
    || !/^[0-9]{5,15}$/.test(target.uid)) {
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

  const uid = escapeRegex(target.uid);
  const hasUid = new RegExp(`(?:^|\\D)${uid}(?:\\D|$)`).test(reply.text);
  const hasSuccessMarkers = /\bTOPUP\s+DONE\b/i.test(reply.text) && /\bSUCCESS\b/i.test(reply.text);
  if (!hasUid || !hasSuccessMarkers)
    return { state: "manual_review" as const, reason: "Supplier response did not satisfy strict success correlation." };
  return { state: "confirmed" as const };
}

export class SupplierCorrelationTracker {
  private readonly processedMessageIds = new Set<string>();
  process(reply: SupplierReplyFixture, target: CorrelationTarget) {
    const key = `${reply.senderEntityId}:${reply.messageId}`;
    if (this.processedMessageIds.has(key)) return { state: "duplicate" as const, reason: "Supplier reply was already processed." };
    const result = correlateSupplierReply(reply, target); this.processedMessageIds.add(key); return result;
  }
}
