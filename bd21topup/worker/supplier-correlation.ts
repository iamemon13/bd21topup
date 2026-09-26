export type SupplierReplyFixture = { messageId: string; replyToMessageId?: string; text: string };
export type CorrelationTarget = { sentMessageId: string; uid: string; supplierReference?: string };

function validateTarget(target: CorrelationTarget) {
  if (
    !/^[1-9][0-9]*$/.test(target.sentMessageId) ||
    !/^[0-9]{5,15}$/.test(target.uid) ||
    (target.supplierReference !== undefined &&
      !/^[A-Za-z0-9_-]{1,100}$/.test(target.supplierReference))
  ) {
    throw new Error("Invalid supplier correlation target.");
  }
}

// Generic success text is deliberately insufficient. Until real response fixtures
// prove stronger rules, only an exact reply link plus UID and known reference can confirm.
export function correlateSupplierReply(reply: SupplierReplyFixture, target: CorrelationTarget) {
  validateTarget(target);
  if (!/^[1-9][0-9]*$/.test(reply.messageId)) {
    return { state: "manual_review" as const, reason: "Supplier reply has invalid identity metadata." };
  }
  const exactReply = reply.replyToMessageId === target.sentMessageId;
  const hasUid = new RegExp(`(?:^|\\D)${target.uid}(?:\\D|$)`).test(reply.text);
  const hasReference = Boolean(target.supplierReference && reply.text.includes(target.supplierReference));
  if (!exactReply) {
    return { state: "ignored" as const, reason: "Message is not an exact reply to the sent command." };
  }
  if (hasUid && (target.supplierReference === undefined || hasReference)) {
    return { state: "confirmed" as const };
  }
  return { state: "manual_review" as const, reason: "Supplier response could not be uniquely correlated." };
}

export class SupplierCorrelationTracker {
  private readonly processedMessageIds = new Set<string>();

  process(reply: SupplierReplyFixture, target: CorrelationTarget) {
    if (this.processedMessageIds.has(reply.messageId)) {
      return { state: "duplicate" as const, reason: "Supplier reply was already processed." };
    }
    const result = correlateSupplierReply(reply, target);
    this.processedMessageIds.add(reply.messageId);
    return result;
  }
}
