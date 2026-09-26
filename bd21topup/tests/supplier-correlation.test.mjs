import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { load } from "./topup-test-helpers.mjs";

const correlation = load("worker/supplier-correlation.ts");
const target = { supplierEntityId:"99",sentMessageId:"42",uid:"561844746" };
const success = { senderEntityId:"99",messageId:"43",replyToMessageId:"42",
  text:"TOPUP DONE\nUID : 561844746\nSuccess" };

test("valid success needs no order, reference, product, or quantity", () => {
  assert.deepEqual(correlation.correlateSupplierReply(success,target),{state:"confirmed"});
});

test("wrong UID, sender, or reply linkage fails closed", () => {
  assert.equal(correlation.correlateSupplierReply({...success,text:success.text.replace(target.uid,"561844747")},target).state,"manual_review");
  assert.equal(correlation.correlateSupplierReply({...success,senderEntityId:"100"},target).state,"ignored");
  assert.equal(correlation.correlateSupplierReply({...success,replyToMessageId:"41"},target).state,"manual_review");
});

test("TOPUP DONE and Success are independently mandatory", () => {
  assert.equal(correlation.correlateSupplierReply({...success,text:"UID : 561844746\nSuccess"},target).state,"manual_review");
  assert.equal(correlation.correlateSupplierReply({...success,text:"TOPUP DONE\nUID : 561844746"},target).state,"manual_review");
  assert.equal(correlation.correlateSupplierReply({...success,text:"done success 561844746"},target).state,"manual_review");
});

test("duplicate reply processing remains idempotent", () => {
  const tracker=new correlation.SupplierCorrelationTracker();
  assert.equal(tracker.process(success,target).state,"confirmed");
  assert.equal(tracker.process(success,target).state,"duplicate");
});

test("invalid targets fail closed and correlation has no business-state boundary", () => {
  assert.throws(()=>correlation.correlateSupplierReply(success,{...target,uid:"12345|.*"}),/Invalid/);
  const source=readFileSync(new URL("../worker/supplier-correlation.ts",import.meta.url),"utf8").toLowerCase();
  for(const boundary of ["supabase","orders","wallet","refund","sendmessage"]) assert.ok(!source.includes(boundary));
});
