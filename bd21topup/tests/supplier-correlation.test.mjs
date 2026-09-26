import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { load } from "./topup-test-helpers.mjs";

const correlation = load("worker/supplier-correlation.ts");
const target = { sentMessageId: "42", uid: "123456789", supplierReference: "TX-9" };

test("exact reply, UID, and available supplier reference confirm fixture only", () => {
  assert.deepEqual(
    correlation.correlateSupplierReply(
      { messageId: "43", replyToMessageId: "42", text: "completed 123456789 TX-9" },
      target,
    ),
    { state: "confirmed" },
  );
});

test("generic, unmatched, and ambiguous supplier replies never confirm", () => {
  assert.equal(correlation.correlateSupplierReply({ messageId: "43", text: "success" }, target).state, "ignored");
  assert.equal(
    correlation.correlateSupplierReply(
      { messageId: "44", replyToMessageId: "41", text: "success 123456789 TX-9" },
      target,
    ).state,
    "ignored",
  );
  assert.equal(
    correlation.correlateSupplierReply(
      { messageId: "45", replyToMessageId: "42", text: "success 123456789" },
      target,
    ).state,
    "manual_review",
  );
  assert.equal(
    correlation.correlateSupplierReply(
      { messageId: "46", replyToMessageId: "42", text: "success TX-9" },
      target,
    ).state,
    "manual_review",
  );
});

test("supplier reference is optional only when none was recorded", () => {
  const result = correlation.correlateSupplierReply(
    { messageId: "43", replyToMessageId: "42", text: "completed 123456789" },
    { sentMessageId: "42", uid: "123456789" },
  );
  assert.equal(result.state, "confirmed");
});

test("duplicate reply processing is idempotent", () => {
  const tracker = new correlation.SupplierCorrelationTracker();
  const reply = { messageId: "43", replyToMessageId: "42", text: "completed 123456789 TX-9" };
  assert.equal(tracker.process(reply, target).state, "confirmed");
  assert.equal(tracker.process(reply, target).state, "duplicate");
});

test("invalid correlation targets fail closed and module has no business-state boundary", () => {
  assert.throws(
    () => correlation.correlateSupplierReply(
      { messageId: "43", replyToMessageId: "42", text: "success" },
      { ...target, uid: "12345|.*" },
    ),
    /Invalid supplier correlation target/,
  );
  const source = readFileSync(new URL("../worker/supplier-correlation.ts", import.meta.url), "utf8");
  for (const boundary of ["supabase", "orders", "wallet", "refund", "sendMessage"]) {
    assert.ok(!source.toLowerCase().includes(boundary.toLowerCase()));
  }
});
