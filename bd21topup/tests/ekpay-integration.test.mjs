import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { z } from "zod";
import { load } from "./topup-test-helpers.mjs";

const ekpay = load("lib/ekpay.ts");
const userId = "33333333-3333-4333-8333-333333333333";
const otherUserId = "44444444-4444-4444-8444-444444444444";
const orderId = "77777777-7777-4777-8777-777777777777";
const verificationId = `vr_${"a".repeat(32)}`;
const baseAttempt = {
  order_id: orderId,
  provider: "bkash",
  provider_transaction_id: "TRX12345678",
  amount_minor: 15800,
  status: "prepared",
  ekpay_verification_id: null,
  verify_idempotency_key: "bd21:verify:stable",
  confirm_idempotency_key: "bd21:confirm:stable",
};

const verified = {
  verification_id: verificationId,
  transaction_id: baseAttempt.provider_transaction_id,
  provider: "bkash",
  amount: 15800,
  currency: "BDT",
  provider_timestamp: "2026-09-28T10:00:00.000Z",
  status: "UNUSED",
  expires_at: "2026-09-28T10:05:00.000Z",
};
const consumed = {
  verification_id: verificationId,
  transaction_id: baseAttempt.provider_transaction_id,
  provider: "bkash",
  amount: 15800,
  currency: "BDT",
  status: "CONSUMED",
  consumed_at: "2026-09-28T10:01:00.000Z",
};

function clientResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("server client requires explicit TEST configuration and never sends key in body", async () => {
  for (const env of [
    {},
    { EKPAY_ENABLED: "false", EKPAY_API_BASE_URL: "https://test.example", EKPAY_API_KEY: "ek_test_secret" },
    { EKPAY_ENABLED: "true", EKPAY_API_BASE_URL: "https://test.example", EKPAY_API_KEY: "ek_live_secret" },
  ]) {
    await assert.rejects(
      ekpay.createEkPayClient({ env, fetchImpl: async () => clientResponse(200, {}) }).verify({
        transactionId: "TRX1234", amountMinor: 100, provider: "bkash", idempotencyKey: "stable-key",
      }),
      (error) => error instanceof ekpay.EkPayError,
    );
  }

  let request;
  const client = ekpay.createEkPayClient({
    env: { EKPAY_ENABLED: "true", EKPAY_API_BASE_URL: "https://test.example/", EKPAY_API_KEY: "ek_test_secret" },
    fetchImpl: async (url, init) => { request = { url, init }; return clientResponse(200, { success: true, data: verified }); },
  });
  await client.verify({ transactionId: "TRX12345678", amountMinor: 15800, provider: "bkash", idempotencyKey: "verify-stable" });
  assert.equal(request.url, "https://test.example/v1/trx/verify");
  assert.equal(request.init.headers.Authorization, "Bearer ek_test_secret");
  assert.equal(request.init.headers["Idempotency-Key"], "verify-stable");
  assert.doesNotMatch(request.init.body, /secret|api.?key/i);
});

test("client maps timeout, 4xx, 5xx and malformed upstream responses safely", async () => {
  const env = { EKPAY_ENABLED: "true", EKPAY_API_BASE_URL: "https://test.example", EKPAY_API_KEY: "ek_test_secret" };
  for (const [fetchImpl, code] of [
    [async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))), "timeout"],
    [async () => clientResponse(422, { error: { internal: "hidden" } }), "not_verifiable"],
    [async () => clientResponse(500, { sql: "hidden" }), "unavailable"],
    [async () => clientResponse(200, { success: true, data: { raw_sms: "hidden" } }), "unavailable"],
  ]) {
    const client = ekpay.createEkPayClient({ env, fetchImpl, timeoutMs: 5 });
    await assert.rejects(
      client.verify({ transactionId: "TRX1234", amountMinor: 100, provider: "bkash", idempotencyKey: "stable-key" }),
      (error) => error instanceof ekpay.EkPayError && error.code === code,
    );
  }
});

function routeSetup({ attempt = { ...baseAttempt }, authUser = userId, prepareError = null, verifyError = null, confirmError = null, finalizeError = null } = {}) {
  const calls = [];
  const admin = {
    auth: { getUser: async () => authUser ? { data: { user: { id: authUser } }, error: null } : { data: { user: null }, error: {} } },
    rpc: async (name, args) => {
      calls.push(["rpc", name, args]);
      if (name === "prepare_ekpay_order_verification") return { data: prepareError ? null : [attempt], error: prepareError };
      if (name === "record_ekpay_order_reservation") return { data: null, error: null };
      if (name === "finalize_ekpay_order_verification") return { data: finalizeError ? null : [{ verified: true }], error: finalizeError };
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  const client = {
    verify: async (input) => { calls.push(["verify", input]); if (verifyError) throw verifyError; return { ...verified, provider: attempt.provider, transaction_id: attempt.provider_transaction_id, amount: Number(attempt.amount_minor) }; },
    confirm: async (input) => { calls.push(["confirm", input]); if (confirmError) throw confirmError; return { ...consumed, provider: attempt.provider, transaction_id: attempt.provider_transaction_id, amount: Number(attempt.amount_minor), verification_id: attempt.ekpay_verification_id ?? verificationId }; },
  };
  const route = load("app/api/orders/verify-ekpay/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    zod: { z },
    "@/lib/financial-rate-limit": { checkFinancialRateLimit: async () => null },
    "@/lib/ekpay": { EkPayError: ekpay.EkPayError, ekPayClient: client },
    "@/lib/supabase-admin": { supabaseAdmin: admin },
  });
  return {
    calls,
    post: (body = { orderId, transactionId: "TRX12345678" }, token = "Bearer valid") => route.POST(new Request("https://app.test/api/orders/verify-ekpay", {
      method: "POST", headers: token ? { authorization: token, "content-type": "application/json" } : {}, body: JSON.stringify(body),
    })),
  };
}

for (const provider of ["bkash", "nagad"]) {
  test(`valid ${provider} TEST payment verifies, confirms and finalizes without dispatch`, async () => {
    const s = routeSetup({ attempt: { ...baseAttempt, provider } });
    const response = await s.post();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, verified: true, orderId });
    assert.deepEqual(s.calls.map((c) => c[0]), ["rpc", "verify", "rpc", "confirm", "rpc"]);
    assert.deepEqual(s.calls.filter((c) => c[0] === "rpc").map((c) => c[1]), [
      "prepare_ekpay_order_verification",
      "record_ekpay_order_reservation",
      "finalize_ekpay_order_verification",
    ]);
    assert.ok(!s.calls.some((call) => /dispatch|supplier|telegram/i.test(JSON.stringify(call))));
  });
}

test("route trusts database amount/provider and never accepts client amount or ownership fields", async () => {
  const s = routeSetup();
  const response = await s.post({ orderId, transactionId: "TRX12345678", amount: 1, userId: otherUserId });
  assert.equal(response.status, 400);
  assert.equal(s.calls.length, 0);
});

test("authentication, malformed transaction IDs, foreign orders, paid and cancelled orders fail safely", async () => {
  assert.equal((await routeSetup({ authUser: null }).post()).status, 401);
  assert.equal((await routeSetup().post({ orderId, transactionId: "bad id" })).status, 400);
  for (const code of ["P0002", "EKP03", "55000"]) {
    const response = await routeSetup({ prepareError: { code, message: "sensitive sql detail" } }).post();
    assert.ok([409, 422].includes(response.status));
    assert.doesNotMatch(JSON.stringify(await response.json()), /sensitive|sql/i);
  }
});

test("Rocket and Upay are rejected before any EkPay call", async () => {
  for (const provider of ["rocket", "upay"]) {
    const s = routeSetup({ prepareError: { code: "EKP04", message: provider } });
    const response = await s.post();
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error, "Provider not supported.");
    assert.ok(!s.calls.some((call) => call[0] === "verify" || call[0] === "confirm"));
  }
});

test("wrong, unknown and consumed transaction failures remain generic", async () => {
  for (const code of ["not_verifiable", "conflict"]) {
    const response = await routeSetup({ verifyError: new ekpay.EkPayError(code, false) }).post();
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { success: false, error: "Transaction could not be verified." });
  }
});

test("network timeout and upstream 5xx map to temporary unavailable without leakage", async () => {
  for (const code of ["timeout", "unavailable"]) {
    const response = await routeSetup({ verifyError: new ekpay.EkPayError(code, true) }).post();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { success: false, error: "Temporarily unavailable." });
  }
});

test("reserved retry skips verify and reuses stable confirm identity", async () => {
  const attempt = { ...baseAttempt, status: "reserved", ekpay_verification_id: verificationId };
  const s = routeSetup({ attempt });
  assert.equal((await s.post()).status, 200);
  assert.ok(!s.calls.some((call) => call[0] === "verify"));
  const confirm = s.calls.find((call) => call[0] === "confirm");
  assert.equal(confirm[1].idempotencyKey, baseAttempt.confirm_idempotency_key);
});

test("confirm success followed by local failure recovers on retry without a second verify", async () => {
  const first = routeSetup({ finalizeError: { code: "temporary", message: "private" } });
  assert.equal((await first.post()).status, 503);
  assert.ok(first.calls.some((call) => call[0] === "confirm"));

  const retry = routeSetup({ attempt: { ...baseAttempt, status: "reserved", ekpay_verification_id: verificationId } });
  assert.equal((await retry.post()).status, 200);
  assert.ok(!retry.calls.some((call) => call[0] === "verify"));
  assert.equal(retry.calls.find((call) => call[0] === "confirm")[1].idempotencyKey, baseAttempt.confirm_idempotency_key);
});

test("already-consumed local attempt returns idempotent success without upstream or dispatch", async () => {
  const s = routeSetup({ attempt: { ...baseAttempt, status: "consumed", ekpay_verification_id: verificationId } });
  assert.equal((await s.post()).status, 200);
  assert.ok(!s.calls.some((call) => call[0] === "verify" || call[0] === "confirm"));
});

let db;
before(async () => {
  db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.orders(
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id), amount numeric NOT NULL,
      payment_method text NOT NULL, transaction_id text NOT NULL, status text NOT NULL,
      cancelled_at timestamptz, payment_verified_at timestamptz, payment_verified_by uuid,
      payment_verification_source text
    );
    INSERT INTO auth.users VALUES ('${userId}'), ('${otherUserId}');
    INSERT INTO public.orders VALUES
      ('${orderId}','${userId}',158.00,'bkash','OLDTRX','pending',NULL,NULL,NULL,NULL),
      ('88888888-8888-4888-8888-888888888888','${otherUserId}',158.00,'bkash','OTHERTRX','pending',NULL,NULL,NULL,NULL),
      ('99999999-9999-4999-8999-999999999999','${userId}',158.001,'nagad','NAGADTRX','pending',NULL,NULL,NULL,NULL),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${userId}',158.00,'rocket','ROCKETTRX','pending',NULL,NULL,NULL,NULL);
  `);
  const migration = await readFile(new URL("../supabase/migrations/20260928155122_add_ekpay_test_order_verification.sql", import.meta.url), "utf8");
  await db.exec(migration);
});
after(async () => { await db?.close(); });

test("database derives exact minor units, enforces ownership/provider policy and persists recovery state", async () => {
  const prepared = await db.query(`SELECT * FROM public.prepare_ekpay_order_verification('${userId}','${orderId}','BKASH_DB_1')`);
  assert.equal(Number(prepared.rows[0].amount_minor), 15800);
  assert.equal(prepared.rows[0].provider, "bkash");
  await assert.rejects(db.query(`SELECT * FROM public.prepare_ekpay_order_verification('${userId}','88888888-8888-4888-8888-888888888888','FOREIGN_1')`));
  await assert.rejects(db.query(`SELECT * FROM public.prepare_ekpay_order_verification('${otherUserId}','88888888-8888-4888-8888-888888888888','bkash_db_1')`));
  await assert.rejects(db.query(`SELECT * FROM public.prepare_ekpay_order_verification('${userId}','99999999-9999-4999-8999-999999999999','NAGAD_DB_1')`));
  await assert.rejects(db.query(`SELECT * FROM public.prepare_ekpay_order_verification('${userId}','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ROCKET_DB_1')`));

  await db.query(`SELECT public.record_ekpay_order_reservation('${userId}','${orderId}','${verificationId}','bkash','BKASH_DB_1',15800,'2026-09-28T10:00:00Z')`);
  await db.query(`SELECT * FROM public.finalize_ekpay_order_verification('${userId}','${orderId}','${verificationId}','bkash','BKASH_DB_1',15800,'2026-09-28T10:01:00Z')`);
  const state = await db.query(`SELECT e.status,e.amount_minor,o.payment_verification_source,o.payment_verified_at IS NOT NULL AS verified FROM public.ekpay_payment_verifications e JOIN public.orders o ON o.id=e.order_id WHERE e.order_id='${orderId}'`);
  assert.deepEqual({ ...state.rows[0], amount_minor: Number(state.rows[0].amount_minor) }, { status: "consumed", amount_minor: 15800, payment_verification_source: "gateway_api", verified: true });
  await db.query(`SELECT * FROM public.finalize_ekpay_order_verification('${userId}','${orderId}','${verificationId}','bkash','BKASH_DB_1',15800,'2026-09-28T10:01:00Z')`);
});

test("database ACL denies browser RPC execution and direct attempt mutation", async () => {
  const acl = await db.query(`SELECT
    has_function_privilege('anon','public.prepare_ekpay_order_verification(uuid,uuid,text)','EXECUTE') AS anon_rpc,
    has_function_privilege('authenticated','public.prepare_ekpay_order_verification(uuid,uuid,text)','EXECUTE') AS authenticated_rpc,
    has_function_privilege('service_role','public.prepare_ekpay_order_verification(uuid,uuid,text)','EXECUTE') AS service_rpc,
    has_table_privilege('anon','public.ekpay_payment_verifications','INSERT,UPDATE,DELETE') AS anon_write,
    has_table_privilege('authenticated','public.ekpay_payment_verifications','INSERT,UPDATE,DELETE') AS authenticated_write,
    has_table_privilege('service_role','public.ekpay_payment_verifications','INSERT,UPDATE,DELETE') AS service_write`);
  assert.deepEqual(acl.rows[0], { anon_rpc: false, authenticated_rpc: false, service_rpc: true, anon_write: false, authenticated_write: false, service_write: false });
});
