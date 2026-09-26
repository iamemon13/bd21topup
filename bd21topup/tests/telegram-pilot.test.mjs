import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { load } from "./topup-test-helpers.mjs";

const configModule = load("worker/telegram-config.ts");
const runnerModule = load("worker/runner.ts", {
  "node:crypto": crypto,
  "./telegram-transport": {},
});
const pilotModule = load("worker/telegram-pilot.ts", {
  "./telegram-transport": {},
  "./runner": {},
  "./runner.ts": runnerModule,
  "./telegram-config.ts": configModule,
});
const realModule = load("worker/real-telegram-transport.ts", {
  "node:crypto": crypto,
  "./telegram-transport": {},
  "./mtproto-gateway": {},
  "./telegram-config.ts": configModule,
});

const dispatchId = "55555555-5555-4555-8555-555555555555";
const operationId = "66666666-6666-4666-8666-666666666666";
const env = {
  TELEGRAM_TRANSPORT_MODE: "real",
  TELEGRAM_API_ID: "12345",
  TELEGRAM_API_HASH: "pilot-api-hash-secret",
  TELEGRAM_SESSION_FILE: ".telegram/pilot.session",
  TELEGRAM_SUPPLIER_USERNAME: "fixed_supplier",
  TELEGRAM_SUPPLIER_ENTITY_ID: "99",
  TELEGRAM_REAL_SEND_ENABLED: "true",
  TELEGRAM_PILOT_ACKNOWLEDGED: "true",
};
const preflightEnv = {
  ...env,
  TELEGRAM_REAL_SEND_ENABLED: "false",
  TELEGRAM_PILOT_ACKNOWLEDGED: "false",
};
const snapshot = {
  dispatch: { id: dispatchId, status: "queued", dry_run: true, uid_snapshot: "123456789" },
  operations: [{
    id: operationId,
    sequence_no: 1,
    product_code: "lite",
    quantity: 1,
    command_hash: "a".repeat(64),
    status: "queued",
  }],
};

function harness(overrides = {}) {
  const calls = [];
  let transports = 0;
  const queue = {
    claim: async (...args) => {
      calls.push(["claim", ...args]);
      return {
        operation_id: operationId,
        dispatch_id: dispatchId,
        sequence_no: 1,
        product_code: "lite",
        quantity: 1,
        uid_snapshot: "123456789",
        command_hash: "a".repeat(64),
      };
    },
    startSendIntent: async (...args) => calls.push(["intent", ...args]),
    finish: async (...args) => calls.push(["finish", ...args]),
  };
  const options = {
    args: ["--dispatch", dispatchId],
    env,
    workerId: "pilot-worker",
    queue,
    inspectDispatch: async (id) => {
      calls.push(["inspect", id]);
      return snapshot;
    },
    createTransport: async () => {
      transports += 1;
      return { sendOperation: async () => ({ kind: "uncertain", dryRun: false, resultHash: "b".repeat(64), summary: "MANUAL_REVIEW" }) };
    },
    showPreflight: (summary) => calls.push(["preflight", summary]),
    ...overrides,
  };
  return { calls, options, transports: () => transports };
}

test("pilot CLI module graph loads without configuration, auth, or network", () => {
  const result = spawnSync(process.execPath, [
    "--experimental-transform-types",
    "worker/telegram-pilot-cli.ts",
    "--check-module-load",
  ], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^TELEGRAM_PILOT_CLI_MODULES_OK\s*$/);
});

test("pilot CLI rejects missing dispatch before reading credentials or initializing clients", () => {
  const result = spawnSync(process.execPath, [
    "--experimental-transform-types",
    "worker/telegram-pilot-cli.ts",
  ], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exactly --dispatch/);
  assert.ok(!result.stderr.includes("SUPABASE_SECRET_KEY"));
});

test("pilot requires one explicit dispatch ID before any preflight or transport", async () => {
  for (const args of [[], ["--dispatch"], ["--dispatch", "bad"], ["--dispatch", dispatchId, "extra"]]) {
    const h = harness({ args });
    await assert.rejects(pilotModule.runControlledTelegramPilot(h.options), /exactly --dispatch/);
    assert.deepEqual(h.calls, []);
    assert.equal(h.transports(), 0);
  }
});

test("read-only preflight requires one explicit dispatch and never claims or initializes Telegram", async () => {
  const calls = [];
  const options = {
    args: ["--preflight", "--dispatch", dispatchId],
    env: preflightEnv,
    preflightDispatch: async (id) => {
      calls.push(["read", id]);
      return snapshot;
    },
    showPreflight: (summary) => calls.push(["show", summary]),
  };
  const result = await pilotModule.runControlledTelegramPreflight(options);
  assert.equal(result.dispatchId, dispatchId);
  assert.deepEqual(calls.map((call) => call[0]), ["read", "show"]);
  for (const args of [[], ["--preflight"], ["--preflight", "--dispatch", "bad"], ["--dispatch", dispatchId]]) {
    await assert.rejects(
      pilotModule.runControlledTelegramPreflight({ ...options, args }),
      /preflight requires exactly/,
    );
  }
});

test("read-only preflight refuses active send controls before database inspection", async () => {
  for (const changedEnv of [
    { ...preflightEnv, TELEGRAM_REAL_SEND_ENABLED: "true" },
    { ...preflightEnv, TELEGRAM_PILOT_ACKNOWLEDGED: "true" },
  ]) {
    let reads = 0;
    await assert.rejects(pilotModule.runControlledTelegramPreflight({
      args: ["--preflight", "--dispatch", dispatchId],
      env: changedEnv,
      preflightDispatch: async () => { reads += 1; return snapshot; },
      showPreflight: () => undefined,
    }), /remain false or unset/);
    assert.equal(reads, 0);
  }
});

for (const [label, changedEnv, pattern] of [
  ["dry-run mode", { ...env, TELEGRAM_TRANSPORT_MODE: "dry-run" }, /disabled/],
  ["real send disabled", { ...env, TELEGRAM_REAL_SEND_ENABLED: "false" }, /disabled/],
  ["missing entity ID", { ...env, TELEGRAM_SUPPLIER_ENTITY_ID: "" }, /ENTITY_ID/],
]) test(`pilot refuses ${label} before inspection or transport`, async () => {
  const h = harness({ env: changedEnv });
  await assert.rejects(pilotModule.runControlledTelegramPilot(h.options), pattern);
  assert.deepEqual(h.calls, []);
  assert.equal(h.transports(), 0);
});

for (const [label, acknowledgement] of [
  ["an omitted acknowledgement", undefined],
  ["an empty acknowledgement", ""],
  ["false", "false"],
  ["uppercase false", "FALSE"],
  ["title-case true", "True"],
  ["uppercase true", "TRUE"],
  ["numeric truthy text", "1"],
  ["yes", "yes"],
  ["on", "on"],
  ["arbitrary approval text", "approved"],
]) test(`pilot refuses ${label} before inspection, claim, transport, or network`, async () => {
  const changedEnv = { ...env };
  if (acknowledgement === undefined) delete changedEnv.TELEGRAM_PILOT_ACKNOWLEDGED;
  else changedEnv.TELEGRAM_PILOT_ACKNOWLEDGED = acknowledgement;
  const h = harness({ env: changedEnv });
  await assert.rejects(pilotModule.runControlledTelegramPilot(h.options), /ACKNOWLEDGED/);
  assert.deepEqual(h.calls, []);
  assert.equal(h.transports(), 0);
});

test("pilot accepts the exact lowercase acknowledgement true", () => {
  const config = pilotModule.loadPilotTelegramConfig(env);
  assert.equal(config.mode, "real");
  assert.equal(config.realSendEnabled, true);
});

test("ineligible preflight does not initialize Telegram transport", async () => {
  const h = harness({
    inspectDispatch: async () => ({ ...snapshot, dispatch: { ...snapshot.dispatch, status: "manual_review" } }),
  });
  await assert.rejects(pilotModule.runControlledTelegramPilot(h.options), /not eligible/);
  assert.equal(h.transports(), 0);
  assert.ok(!h.calls.some((call) => call[0] === "claim"));
});

test("missing or corrupt session fails before claim or transport execution", async () => {
  for (const message of ["Telegram authentication session is missing", "Invalid session encoding"]) {
    const h = harness({ createTransport: async () => { throw new Error(message); } });
    await assert.rejects(pilotModule.runControlledTelegramPilot(h.options), new RegExp(message));
    assert.ok(h.calls.some((call) => call[0] === "inspect"));
    assert.ok(!h.calls.some((call) => call[0] === "claim"));
    assert.ok(!h.calls.some((call) => call[0] === "intent"));
  }
});

test("pilot prints only safe preflight fields and claims only the explicit dispatch", async () => {
  const h = harness();
  const result = await pilotModule.runControlledTelegramPilot(h.options);
  assert.equal(result.kind, "uncertain");
  assert.deepEqual(h.calls.find((call) => call[0] === "claim").slice(1), ["pilot-worker", dispatchId]);
  const serialized = JSON.stringify(h.calls.find((call) => call[0] === "preflight")[1]);
  assert.match(serialized, /fixed_supplier/);
  assert.match(serialized, /"supplierEntityId":"99"/);
  assert.match(serialized, /"productCode":"lite"/);
  assert.match(serialized, /"quantity":1/);
  assert.match(serialized, /123456789/);
  for (const secret of [env.TELEGRAM_API_HASH, env.TELEGRAM_SESSION_FILE, "SUPABASE_SECRET_KEY", "session"]) {
    assert.ok(!serialized.includes(secret));
  }
});

for (const [label, entity] of [
  ["username", { id: "99", username: "lookalike_supplier", type: "bot" }],
  ["entity ID", { id: "100", username: "fixed_supplier", type: "bot" }],
]) test(`pilot supplier ${label} mismatch sends nothing and stays manual review`, async () => {
  let sends = 0;
  const gateway = {
    connect: async () => undefined,
    resolve: async () => entity,
    sendText: async () => { sends += 1; throw new Error("must not send"); },
    disconnect: async () => undefined,
  };
  const h = harness({
    createTransport: async (config) => new realModule.RealTelegramTransport(config, gateway),
  });
  const result = await pilotModule.runControlledTelegramPilot(h.options);
  assert.equal(result.kind, "uncertain");
  assert.equal(sends, 0);
  assert.equal(h.calls.find((call) => call[0] === "finish")[4], "uncertain");
});

for (const message of ["timeout", "ECONNRESET", "unexpected Telegram error"]) {
  test(`${message} after send intent stays manual review with one attempt`, async () => {
    let attempts = 0;
    const h = harness({
      createTransport: async () => ({
        sendOperation: async () => {
          attempts += 1;
          throw new Error(message);
        },
      }),
    });
    const result = await pilotModule.runControlledTelegramPilot(h.options);
    assert.equal(attempts, 1);
    assert.equal(result.kind, "uncertain");
    assert.equal(h.calls.filter((call) => call[0] === "claim").length, 1);
    assert.equal(h.calls.find((call) => call[0] === "finish")[4], "uncertain");
  });
}
