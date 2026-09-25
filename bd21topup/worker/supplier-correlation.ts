export type SupplierReplyFixture = { messageId: string; replyToMessageId?: string; text: string };
export type CorrelationTarget = { sentMessageId: string; uid: string; supplierReference?: string };

// Generic success text is deliberately insufficient. Until real response fixtures
// prove stronger rules, only an exact reply link plus UID and known reference can confirm.
export function correlateSupplierReply(reply: SupplierReplyFixture, target: CorrelationTarget) {
  const exactReply = reply.replyToMessageId === target.sentMessageId;
  const hasUid = new RegExp(`(?:^|\\D)${target.uid}(?:\\D|$)`).test(reply.text);
  const hasReference = Boolean(target.supplierReference && reply.text.includes(target.supplierReference));
  if (exactReply && hasUid && hasReference) return { state: "confirmed" as const };
  return { state: "manual_review" as const, reason: "Supplier response could not be uniquely correlated." };
}
