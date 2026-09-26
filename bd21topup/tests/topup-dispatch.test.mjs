import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { load, generator, mappings, order, debit, fixtures } from "./topup-test-helpers.mjs";

const dispatch = load("lib/topup-dispatch.ts", {
  "node:crypto": crypto,
  "@/lib/topup-preview": generator,
  "@/lib/topup-mappings": mappings,
});
const pkg = (name) => { const f = fixtures.find((row) => row.name === name); return { id: f.id, name: f.name, category: f.category }; };
const create = (name, uid = order.uid) => dispatch.buildDryRunDispatch({ ...order, uid, package_name: name }, [pkg(name)], [debit]);

for (const [name, expected] of [
  ["355 Diamond", [["240",1],["115",1]]],
  ["505 Diamond", [["240",2],["25",1]]],
  ["850 Diamond", [["610",1],["240",1]]],
  ["1090 Diamond", [["610",1],["240",2]]],
  ["2090 Diamond", [["1240",1],["610",1],["240",1]]],
  ["3x Weekly Lite", [["lite",3]]],
]) test(`structured bundle order: ${name}`, () => {
  assert.deepEqual(create(name).operations.map((x) => [x.productCode,x.quantity]), expected);
});

test("client-derived values are absent and commands become hashes", () => {
  const value = create("355 Diamond", "1234567");
  assert.deepEqual(Object.keys(value.operations[0]).sort(), ["commandHash","productCode","quantity"]);
  assert.match(value.operations[0].commandHash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(value.operations).includes("Ktp "));
});

test("all 37 mappings produce one to three structured operations", () => {
  for (const fixture of fixtures) {
    const value = create(fixture.name);
    assert.ok(value.operations.length >= 1 && value.operations.length <= 3);
  }
});

test("external, invalid UID, missing/duplicate/refund/wrong amount/wrong user evidence are rejected", () => {
  const basePkg = [pkg("Weekly")];
  const attempts = [
    [{ ...order, payment_method: "bkash" }, basePkg, [debit]],
    [{ ...order, uid: "12x" }, basePkg, [debit]],
    [order, basePkg, []], [order, basePkg, [debit, debit]],
    [order, basePkg, [debit, { ...debit, id: order.id, type: "refund", direction: "credit" }]],
    [order, basePkg, [{ ...debit, amount: 999 }]],
    [order, basePkg, [{ ...debit, user_id: order.id }]],
    [{ ...order, status: "completed" }, basePkg, [debit]],
    [{ ...order, cancelled_at: new Date().toISOString() }, basePkg, [debit]],
  ];
  for (const args of attempts) assert.throws(() => dispatch.buildDryRunDispatch(...args));
});

test("unmapped, FF Likes, Indonesia, and UUID/category mismatch are rejected", () => {
  for (const candidate of [
    { id: order.id, name: "Weekly", category: "uid_bd" },
    { id: order.id, name: "FF Likes", category: "ff_likes" },
    { id: order.id, name: "Indonesia", category: "indo_server" },
    { ...pkg("Weekly"), category: "weekly_lite" },
  ]) assert.throws(() => dispatch.buildDryRunDispatch({ ...order, package_name: candidate.name }, [candidate], [debit]));
});

test("dry-run transport is deterministic and needs no credentials or network globals", async () => {
  const transportModule = load("worker/dry-run-telegram-transport.ts", { "node:crypto": crypto, "./telegram-transport": {} });
  const transport = new transportModule.DryRunTelegramTransport();
  const operation = { operationId: order.id, uid: order.uid, productCode: "weekly", quantity: 1, commandHash: "a".repeat(64) };
  assert.deepEqual(await transport.sendOperation(operation), await transport.sendOperation(operation));
  assert.equal((await transport.sendOperation(operation)).dryRun, true);
});
test("dry-run transport trips no network trap", async () => { const originalFetch=globalThis.fetch; let calls=0; globalThis.fetch=async()=>{calls++;throw Error("network forbidden")}; try { const transportModule=load("worker/dry-run-telegram-transport.ts",{"node:crypto":crypto,"./telegram-transport":{}}); await new transportModule.DryRunTelegramTransport().sendOperation({operationId:order.id,uid:order.uid,productCode:"weekly",quantity:1,commandHash:"a".repeat(64)}); assert.equal(calls,0); } finally { globalThis.fetch=originalFetch; } });

test("worker marks timeout and connection-reset sends for manual review without retry", async () => {
  const runner = load("worker/runner.ts", { "node:crypto": crypto });
  for (const message of ["timeout", "ECONNRESET"]) {
    let claims = 0, sends = 0, finish;
    const queue = { claim: async () => (++claims === 1 ? { operation_id: order.id, dispatch_id: debit.id, sequence_no: 1, product_code: "weekly", quantity: 1, uid_snapshot: order.uid, command_hash: "a".repeat(64) } : null), startSendIntent: async () => {}, finish: async (...args) => { finish = args; } };
    const result = await runner.runOneDryRun(queue, { sendOperation: async () => { sends++; throw Error(message); } }, "worker-1");
    assert.equal(result.kind, "uncertain"); assert.equal(sends, 1); assert.equal(finish[3], "uncertain");
    assert.equal(await runner.runOneDryRun(queue, { sendOperation: async () => { sends++; } }, "worker-1"), null);
    assert.equal(sends, 1);
  }
});

test("worker never calls transport when durable send intent is rejected", async () => {
  const runner = load("worker/runner.ts", { "node:crypto": crypto });
  let sends = 0;
  const queue = {
    claim: async () => ({ operation_id: order.id, dispatch_id: debit.id, sequence_no: 1, product_code: "weekly", quantity: 1, uid_snapshot: order.uid, command_hash: "a".repeat(64) }),
    startSendIntent: async () => { throw Error("stale authoritative evidence"); },
    finish: async () => { throw Error("finish must not run"); },
  };
  await assert.rejects(runner.runOneDryRun(queue, { sendOperation: async () => { sends++; } }, "worker-1"), /stale authoritative evidence/);
  assert.equal(sends, 0);
});

test("worker forwards an explicit dispatch scope to the queue", async () => {
  const runner = load("worker/runner.ts", { "node:crypto": crypto });
  const dispatchId = "55555555-5555-4555-8555-555555555555";
  let claimArgs;
  const queue = { claim: async (...args) => { claimArgs=args; return null; }, startSendIntent: async () => {}, finish: async () => {} };
  assert.equal(await runner.runOneDryRun(queue, { sendOperation: async () => { throw Error("must not send"); } }, "scoped-worker", dispatchId), null);
  assert.deepEqual(claimArgs,["scoped-worker",dispatchId]);
});

test("Supabase queue sends nullable dispatch scope to the claim RPC", async () => {
  const queueModule = load("worker/supabase-dispatch-queue.ts", { "@supabase/supabase-js": {}, "./runner": {} });
  const calls=[]; const client={rpc:async (...args)=>{calls.push(args);return {data:[],error:null};}};
  const queue=new queueModule.SupabaseDispatchQueue(client);
  await queue.claim("global-worker");
  await queue.claim("scoped-worker","55555555-5555-4555-8555-555555555555");
  assert.deepEqual(calls,[
    ["claim_topup_dispatch_operation_dry_run",{p_worker_id:"global-worker",p_dispatch_id:null}],
    ["claim_topup_dispatch_operation_dry_run",{p_worker_id:"scoped-worker",p_dispatch_id:"55555555-5555-4555-8555-555555555555"}],
  ]);
});

test("Supabase queue preflight uses only the read-only authoritative RPC", async () => {
  const queueModule = load("worker/supabase-dispatch-queue.ts", { "@supabase/supabase-js": {}, "./runner": {} });
  const calls=[];
  const snapshot={dispatch:{id:"55555555-5555-4555-8555-555555555555",status:"queued",dry_run:true,uid_snapshot:"123456789"},operations:[]};
  const client={rpc:async (...args)=>{calls.push(args);return {data:snapshot,error:null};}};
  const queue=new queueModule.SupabaseDispatchQueue(client);
  assert.equal(await queue.preflightDispatch("55555555-5555-4555-8555-555555555555"),snapshot);
  assert.deepEqual(calls,[["preflight_topup_dispatch_dry_run",{p_dispatch_id:"55555555-5555-4555-8555-555555555555"}]]);
});

test("supplier correlation rejects generic success and ambiguous replies", () => {
  const correlation = load("worker/supplier-correlation.ts");
  const target = { sentMessageId: "42", uid: "123456789", supplierReference: "TX-9" };
  assert.equal(correlation.correlateSupplierReply({ messageId: "43", text: "success" }, target).state, "ignored");
  assert.equal(correlation.correlateSupplierReply({ messageId: "43", replyToMessageId: "42", text: "success 123456789" }, target).state, "manual_review");
  assert.equal(correlation.correlateSupplierReply({ messageId: "43", replyToMessageId: "42", text: "success 123456789 TX-9" }, target).state, "confirmed");
});
