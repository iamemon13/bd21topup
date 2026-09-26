import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { z } from "zod";
import { load, generator, mappings, actor, order, pkg, debit } from "./topup-test-helpers.mjs";

const domain = load("lib/topup-dispatch.ts", {
  "node:crypto": crypto,
  "@/lib/topup-preview": generator,
  "@/lib/topup-mappings": mappings,
});

const dispatchId = "55555555-5555-4555-8555-555555555555";

function queryResult(calls, table, data, error = null) {
  const result = { data, error };
  const query = {
    select(columns) { calls.push(["select", table, columns]); return query; },
    eq(column, value) { calls.push(["eq", table, column, value]); return query; },
    limit(value) { calls.push(["limit", table, value]); return query; },
    maybeSingle: async () => result,
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return query;
}

function autoSupabase({
  orderRow = order,
  packageRows = [pkg],
  ledgerRows = [debit],
  createData = [{ dispatch_id: dispatchId, created: true }],
  createError = null,
} = {}) {
  const calls = [];
  return {
    calls,
    client: {
      from(table) {
        calls.push(["from", table]);
        const data = { orders: orderRow, packages: packageRows, wallet_transactions: ledgerRows }[table];
        return queryResult(calls, table, data);
      },
      async rpc(name, args) {
        calls.push(["rpc", name, args]);
        return { data: createError ? null : createData, error: createError };
      },
    },
  };
}

test("auto dispatch is disabled by default and performs zero reads or writes", async () => {
  const s = autoSupabase();
  const result = await domain.createOrReuseAutoTopupDispatchForWalletOrder(s.client, order.id, { adminId: actor });
  assert.deepEqual(result, { attempted: false, reason: "disabled" });
  assert.deepEqual(s.calls, []);
});

test("eligible wallet order creates dispatch from server-derived evidence", async () => {
  const s = autoSupabase();
  const result = await domain.createOrReuseAutoTopupDispatchForWalletOrder(s.client, order.id, {
    adminId: actor,
    env: { AUTO_TOPUP_DISPATCH_ENABLED: "true" },
  });
  assert.deepEqual(result, { attempted: true, dispatchId, created: true });
  const rpc = s.calls.find((call) => call[0] === "rpc");
  assert.equal(rpc[1], "admin_create_topup_dispatch_dry_run");
  assert.equal(rpc[2].p_admin_id, actor);
  assert.equal(rpc[2].p_order_id, order.id);
  assert.equal(rpc[2].p_package_id, pkg.id);
  assert.deepEqual(rpc[2].p_operations.map((op) => [op.productCode, op.quantity]), [["weekly", 1]]);
  assert.ok(!JSON.stringify(rpc[2]).includes("Ktp "));
});

test("duplicate existing dispatch is reused without treating it as a failure", async () => {
  const s = autoSupabase({ createData: [{ dispatch_id: dispatchId, created: false }] });
  const result = await domain.createOrReuseAutoTopupDispatchForWalletOrder(s.client, order.id, {
    adminId: actor,
    env: { AUTO_TOPUP_DISPATCH_ENABLED: "true" },
  });
  assert.deepEqual(result, { attempted: true, dispatchId, created: false });
});

test("unmapped package is not dispatched", async () => {
  const s = autoSupabase({ packageRows: [{ ...pkg, id: "99999999-9999-4999-8999-999999999999" }] });
  const result = await domain.createOrReuseAutoTopupDispatchForWalletOrder(s.client, order.id, {
    adminId: actor,
    env: { AUTO_TOPUP_DISPATCH_ENABLED: "true" },
  });
  assert.deepEqual(result, { attempted: false, reason: "not_eligible" });
  assert.ok(!s.calls.some((call) => call[0] === "rpc"));
});

test("dispatch creation failure is reported without financial mutations", async () => {
  const s = autoSupabase({ createError: { code: "55000", message: "not eligible" } });
  const result = await domain.createOrReuseAutoTopupDispatchForWalletOrder(s.client, order.id, {
    adminId: actor,
    env: { AUTO_TOPUP_DISPATCH_ENABLED: "true" },
  });
  assert.deepEqual(result, { attempted: true, error: "55000" });
  assert.ok(!s.calls.some((call) => call[0] === "from" && ["profiles", "payments", "refunds"].includes(call[1])));
  assert.ok(!s.calls.some((call) => call[0] === "rpc" && call[1] !== "admin_create_topup_dispatch_dry_run"));
});

function walletRoute({ dispatchResult, env = { AUTO_TOPUP_DISPATCH_ENABLED: "true" } } = {}) {
  const calls = [];
  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: order.user_id, email: "user@example.test", user_metadata: {} } }, error: null }) },
    async rpc(name, args) {
      calls.push(["rpc", name, args]);
      return { data: { success: true, order_id: order.id, balance_after: 1000, amount_deducted: 158 }, error: null };
    },
  };
  const route = load("app/api/wallet-pay/route.ts", {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    zod: { z },
    crypto: { default: crypto, ...crypto },
    "@/lib/supabase-admin": { supabaseAdmin: admin },
    "@/lib/financial-rate-limit": { checkFinancialRateLimit: async () => null },
    "@/lib/topup-dispatch": {
      createOrReuseAutoTopupDispatchForWalletOrder: async (client, orderId) => {
        calls.push(["auto-dispatch", client === admin, orderId]);
        assert.equal(env.AUTO_TOPUP_DISPATCH_ENABLED, "true");
        return dispatchResult ?? { attempted: true, dispatchId, created: true };
      },
    },
  });
  return { calls, route };
}

test("wallet route isolates auto dispatch failure after successful payment", async () => {
  const s = walletRoute({ dispatchResult: { attempted: true, error: "dispatch_create_failed" } });
  const response = await s.route.POST(new Request("https://example.test/api/wallet-pay", {
    method: "POST",
    headers: { authorization: "Bearer test" },
    body: JSON.stringify({ uid: order.uid, packageName: order.package_name }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.order_id, order.id);
  assert.deepEqual(s.calls.map((call) => call[0]), ["rpc", "auto-dispatch"]);
  assert.equal(s.calls[0][1], "process_wallet_payment");
});
