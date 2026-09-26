import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { load, order } from "./topup-test-helpers.mjs";

const configModule = load("worker/telegram-config.ts");
const dryModule = load("worker/dry-run-telegram-transport.ts", { "node:crypto": crypto, "./telegram-transport": {} });
const realModule = load("worker/real-telegram-transport.ts", {
  "node:crypto": crypto,
  "./telegram-transport": {},
  "./mtproto-gateway": {},
  "./telegram-config": configModule,
});
const factoryModule = load("worker/telegram-transport-factory.ts", {
  "./dry-run-telegram-transport": dryModule,
  "./real-telegram-transport": realModule,
  "./mtproto-gateway": {},
  "./telegram-config": {},
  "./telegram-transport": {},
});
const connectivityModule = load("worker/telegram-connectivity.ts", { "./mtproto-gateway": {} });
const runnerModule = load("worker/runner.ts", {
  "node:crypto": crypto,
  "./telegram-transport": {},
});

const operation = {
  operationId: order.id,
  uid: order.uid,
  productCode: "weekly",
  quantity: 1,
  commandHash: "a".repeat(64),
};
const realEnvironment = {
  TELEGRAM_TRANSPORT_MODE: "real",
  TELEGRAM_API_ID: "12345",
  TELEGRAM_API_HASH: "fake-api-hash-for-tests",
  TELEGRAM_SESSION_FILE: ".telegram/test.session",
  TELEGRAM_SUPPLIER_USERNAME: "@fixed_supplier",
  TELEGRAM_SUPPLIER_ENTITY_ID: "99",
  TELEGRAM_REAL_SEND_ENABLED: "true",
};

test("Node 24 can load the connectivity CLI module graph without configuration or network", () => {
  const result = spawnSync(process.execPath, [
    "--experimental-transform-types",
    "worker/telegram-connectivity-cli.ts",
    "--check-module-load",
  ], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^TELEGRAM_CONNECTIVITY_CLI_MODULES_OK\s*$/);
  assert.ok(!result.stderr.includes("ERR_MODULE_NOT_FOUND"));
});

test("dry-run remains the configuration and transport default", () => {
  const config = configModule.loadTelegramConfig({});
  assert.deepEqual(config, { mode: "dry-run", realSendEnabled: false });
  assert.ok(factoryModule.createTelegramTransport(config) instanceof dryModule.DryRunTelegramTransport);
});

test("real transport requires explicit mode, complete secrets, opt-in, and gateway", () => {
  for (const missing of ["TELEGRAM_API_ID", "TELEGRAM_API_HASH", "TELEGRAM_SESSION_FILE", "TELEGRAM_SUPPLIER_USERNAME", "TELEGRAM_SUPPLIER_ENTITY_ID"]) {
    const env = { ...realEnvironment };
    delete env[missing];
    assert.throws(() => configModule.loadTelegramConfig(env), new RegExp(missing));
  }
  const disabled = configModule.loadTelegramConfig({ ...realEnvironment, TELEGRAM_REAL_SEND_ENABLED: "false" });
  assert.throws(() => new realModule.RealTelegramTransport(disabled, {}), /disabled/);
  assert.throws(() => factoryModule.createTelegramTransport(configModule.loadTelegramConfig(realEnvironment)), /gateway/);
  for (const supplierEntityId of ["", "0", "-10099", "99.0", "99x", "9".repeat(21)]) {
    assert.throws(
      () => configModule.loadTelegramConfig({ ...realEnvironment, TELEGRAM_SUPPLIER_ENTITY_ID: supplierEntityId }),
      /TELEGRAM_SUPPLIER_ENTITY_ID/,
    );
  }
});

test("supplier target is pinned and quantity is always present in the derived command", async () => {
  const calls = [];
  const gateway = {
    connect: async () => calls.push(["connect"]),
    resolve: async (target) => (calls.push(["resolve", target]), { id: "99", username: "fixed_supplier", type: "bot" }),
    sendText: async (target, text) => (calls.push(["send", target, text]), { messageId: "42", sentAt: new Date("2026-09-25T00:00:00Z") }),
    disconnect: async () => calls.push(["disconnect"]),
  };
  const transport = new realModule.RealTelegramTransport(configModule.loadTelegramConfig(realEnvironment), gateway);
  const result = await transport.sendOperation({ ...operation, supplierUsername: "attacker", message: "arbitrary" });
  assert.equal(result.kind, "uncertain");
  assert.equal(result.dryRun, false);
  assert.deepEqual(calls[1], ["resolve", "fixed_supplier"]);
  assert.deepEqual(calls[2], ["send", "fixed_supplier", `Ktp ${order.uid} weekly 1`]);

  const quantityCalls = [];
  const quantityGateway = {
    connect: async () => undefined,
    resolve: async () => ({ id: "99", username: "fixed_supplier", type: "bot" }),
    sendText: async (_target, text) => (quantityCalls.push(text), { messageId: "43", sentAt: new Date("2026-09-25T00:00:00Z") }),
    disconnect: async () => undefined,
  };
  await new realModule.RealTelegramTransport(configModule.loadTelegramConfig(realEnvironment), quantityGateway)
    .sendOperation({ ...operation, operationId: "33333333-3333-4333-8333-333333333333", quantity: 2 });
  assert.deepEqual(quantityCalls, [`Ktp ${order.uid} weekly 2`]);
});

for (const [label, entity] of [
  ["username", { id: "99", username: "lookalike_supplier", type: "bot" }],
  ["entity ID", { id: "100", username: "fixed_supplier", type: "bot" }],
]) {
  test(`supplier ${label} mismatch aborts before sendText`, async () => {
    let sends = 0;
    const gateway = {
      connect: async () => undefined,
      resolve: async () => entity,
      sendText: async () => { sends += 1; throw new Error("must not send"); },
      disconnect: async () => undefined,
    };
    const transport = new realModule.RealTelegramTransport(configModule.loadTelegramConfig(realEnvironment), gateway);
    await assert.rejects(transport.sendOperation(operation), /identity did not match/);
    assert.equal(sends, 0);
  });
}

test("connectivity check resolves identity, disconnects, sends zero messages, and has no Supabase boundary", async () => {
  let sends = 0;
  const calls = [];
  const gateway = {
    connect: async () => calls.push("connect"),
    resolve: async () => ({ id: "99", username: "fixed_supplier", type: "bot" }),
    sendText: async () => { sends += 1; throw new Error("must not send"); },
    disconnect: async () => calls.push("disconnect"),
  };
  assert.deepEqual(await connectivityModule.checkTelegramConnectivity(gateway, "fixed_supplier", "99"), {
    id: "99", username: "fixed_supplier", type: "bot",
  });
  assert.equal(sends, 0);
  assert.deepEqual(calls, ["connect", "disconnect"]);
  assert.ok(!readFileSync(new URL("../worker/telegram-connectivity.ts", import.meta.url), "utf8").includes("supabase"));
});

for (const [label, entity] of [
  ["username", { id: "99", username: "lookalike_supplier", type: "bot" }],
  ["entity ID", { id: "100", username: "fixed_supplier", type: "bot" }],
]) test(`connectivity check rejects supplier ${label} confusion`, async () => {
  let sends = 0;
  const gateway = {
    connect: async () => {},
    resolve: async () => entity,
    sendText: async () => { sends += 1; throw new Error("must not send"); },
    disconnect: async () => {},
  };
  await assert.rejects(connectivityModule.checkTelegramConnectivity(gateway, "fixed_supplier", "99"), /did not match/);
  assert.equal(sends, 0);
});

test("an uncertain send is never blindly retried on the same transport", async () => {
  let sends = 0;
  const gateway = {
    connect: async () => {},
    resolve: async () => ({ id: "99", username: "fixed_supplier", type: "bot" }),
    sendText: async () => { sends += 1; throw new Error("timeout after send"); },
    disconnect: async () => {},
  };
  const transport = new realModule.RealTelegramTransport(configModule.loadTelegramConfig(realEnvironment), gateway);
  await assert.rejects(transport.sendOperation(operation), /timeout after send/);
  await assert.rejects(transport.sendOperation(operation), /already attempted/);
  assert.equal(sends, 1);
});

test("credential-like values and phone numbers are redacted from transport errors", async () => {
  const gateway = {
    connect: async () => { throw new Error("fake-api-hash-for-tests api_hash=another-secret phone=+8801712345678"); },
    resolve: async () => { throw new Error("unreachable"); },
    sendText: async () => { throw new Error("unreachable"); },
    disconnect: async () => {},
  };
  const transport = new realModule.RealTelegramTransport(configModule.loadTelegramConfig(realEnvironment), gateway);
  await assert.rejects(transport.sendOperation(operation), (error) => {
    assert.ok(!error.message.includes("fake-api-hash-for-tests"));
    assert.ok(!error.message.includes("another-secret"));
    assert.ok(!error.message.includes("8801712345678"));
    assert.match(error.message, /\[REDACTED\]/);
    return true;
  });
});

test("invalid customer-controlled operation fragments fail before MTProto connection", async () => {
  let connects = 0;
  const gateway = { connect: async () => { connects += 1; }, resolve: async () => ({}), sendText: async () => ({}), disconnect: async () => {} };
  for (const forged of [
    { ...operation, uid: "12345 Ktp 99999" },
    { ...operation, productCode: "weekly\nKtp" },
    { ...operation, quantity: 99 },
  ]) {
    const transport = new realModule.RealTelegramTransport(configModule.loadTelegramConfig(realEnvironment), gateway);
    await assert.rejects(transport.sendOperation(forged), /invalid/);
  }
  assert.equal(connects, 0);
});

test("post-intent ECONNRESET is finalized as uncertain manual review without retry", async () => {
  const calls = [];
  let attempts = 0;
  const dispatchId = "44444444-4444-4444-8444-444444444444";
  const queue = {
    claim: async () => ({
      operation_id: operation.operationId,
      dispatch_id: dispatchId,
      sequence_no: 1,
      product_code: operation.productCode,
      quantity: operation.quantity,
      uid_snapshot: operation.uid,
      command_hash: operation.commandHash,
    }),
    startSendIntent: async (...args) => calls.push(["intent", ...args]),
    finish: async (...args) => calls.push(["finish", ...args]),
  };
  const transport = {
    sendOperation: async () => {
      attempts += 1;
      const error = new Error("socket reset");
      error.code = "ECONNRESET";
      throw error;
    },
  };
  const result = await runnerModule.runOneDryRun(queue, transport, "worker-1", dispatchId);
  assert.equal(attempts, 1);
  assert.equal(result.kind, "uncertain");
  assert.equal(result.summary, "MANUAL_REVIEW");
  assert.equal(calls[0][0], "intent");
  assert.equal(calls[1][0], "finish");
  assert.equal(calls[1][4], "uncertain");
  assert.match(calls[1][6], /manual review/i);
});
