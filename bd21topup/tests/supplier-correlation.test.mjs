import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { load } from "./topup-test-helpers.mjs";

const correlation = load("worker/supplier-correlation.ts");
const target = { supplierEntityId: "99", sentMessageId: "42", uid: "12976955986", productCode: "25", quantity: 1 };
const valid = { senderEntityId: "99", messageId: "43", replyToMessageId: "42",
  text: "TOPUP DONE\nKtp 12976955986 25 1\nStatus: Success\nOrder ID: ORD-123\nUPRID: UPR-456" };

test("valid pinned supplier success is exactly correlated", () => {
  assert.deepEqual(correlation.correlateSupplierReply(valid, target), {
    state: "confirmed", supplierOrderId: "ORD-123", supplierReference: "UPR-456",
  });
});

test("wrong UID and wrong product or quantity stay manual review", () => {
  for (const text of [valid.text.replace(target.uid, "12976955987"), valid.text.replace(" 25 1", " 50 1"), valid.text.replace(" 25 1", " 25 2")])
    assert.equal(correlation.correlateSupplierReply({ ...valid, text }, target).state, "manual_review");
});

test("missing reply linkage, generic success, and ambiguous reply never confirm", () => {
  assert.equal(correlation.correlateSupplierReply({ ...valid, replyToMessageId: undefined }, target).state, "manual_review");
  assert.equal(correlation.correlateSupplierReply({ ...valid, text: "done success" }, target).state, "manual_review");
  assert.equal(correlation.correlateSupplierReply({ ...valid, text: "TOPUP DONE Success 12976955986 25 1" }, target).state, "manual_review");
});

test("only the pinned supplier is consumed", () => {
  assert.equal(correlation.correlateSupplierReply({ ...valid, senderEntityId: "100" }, target).state, "ignored");
});

test("duplicate reply processing is idempotent", () => {
  const tracker = new correlation.SupplierCorrelationTracker();
  assert.equal(tracker.process(valid, target).state, "confirmed");
  assert.equal(tracker.process(valid, target).state, "duplicate");
});

test("invalid targets fail closed and correlation has no business-state boundary", () => {
  assert.throws(() => correlation.correlateSupplierReply(valid, { ...target, uid: "12345|.*" }), /Invalid/);
  const source = readFileSync(new URL("../worker/supplier-correlation.ts", import.meta.url), "utf8").toLowerCase();
  for (const boundary of ["supabase", "orders", "wallet", "refund", "sendmessage"]) assert.ok(!source.includes(boundary));
});
