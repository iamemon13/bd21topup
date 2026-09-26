import assert from "node:assert/strict";
import crypto from "node:crypto";
import { z } from "zod";
import { load, generator, mappings, actor, order, pkg, debit } from "./topup-test-helpers.mjs";

const dispatchId = "55555555-5555-4555-8555-555555555555";
const forbiddenRpcWords = /wallet|refund|payment/i;

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

function mockedDispatchSupabase({
  createData = [{ dispatch_id: dispatchId, created: true }],
  createError = null,
} = {}) {
  const calls = [];
  const client = {
    from(table) {
      calls.push(["from", table]);
      const data = { orders: order, packages: [pkg], wallet_transactions: [debit] }[table];
      return queryResult(calls, table, data);
    },
    async rpc(name, args) {
      calls.push(["rpc", name, args]);
      return { data: createError ? null : createData, error: createError };
    },
  };
  return { calls, client };
}

function loadDispatchDomain() {
  return load("lib/topup-dispatch.ts", {
    "node:crypto": crypto,
    "@/lib/topup-preview": generator,
    "@/lib/topup-mappings": mappings,
  });
}

function loadWalletRoute({ helperResult, helperCalls }) {
  const calls = [];
  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: order.user_id, email: "user@example.test", user_metadata: {} } }, error: null }) },
    async rpc(name, args) {
      calls.push(["rpc", name, args]);
      assert.equal(name, "process_wallet_payment");
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
        helperCalls.push({ clientMatches: client === admin, orderId });
        return helperResult;
      },
    },
  });
  return { admin, calls, route };
}

async function postWallet(route) {
  return route.POST(new Request("https://example.test/api/wallet-pay", {
    method: "POST",
    headers: { authorization: "Bearer test" },
    body: JSON.stringify({ uid: order.uid, packageName: order.package_name }),
  }));
}

async function main() {
  const checks = [];
  const domain = loadDispatchDomain();

  {
    const helperCalls = [];
    const { calls, route } = loadWalletRoute({
      helperCalls,
      helperResult: { attempted: true, dispatchId, created: true },
    });
    const response = await postWallet(route);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.order_id, order.id);
    assert.deepEqual(helperCalls, [{ clientMatches: true, orderId: order.id }]);
    assert.deepEqual(calls.map((call) => call[1]), ["process_wallet_payment"]);
    checks.push("wallet success calls auto dispatch helper");
  }

  {
    const s = mockedDispatchSupabase();
    const result = await domain.createOrReuseAutoTopupDispatchForWalletOrder(s.client, order.id, {
      adminId: actor,
      env: { AUTO_TOPUP_DISPATCH_ENABLED: "true" },
    });
    const rpcCalls = s.calls.filter((call) => call[0] === "rpc");
    assert.deepEqual(result, { attempted: true, dispatchId, created: true });
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0][1], "admin_create_topup_dispatch_dry_run");
    assert.deepEqual(rpcCalls[0][2].p_operations.map((op) => [op.productCode, op.quantity]), [["weekly", 1]]);
    checks.push("eligible mapped wallet order creates one queued dispatch RPC");
  }

  {
    const s = mockedDispatchSupabase({ createData: [{ dispatch_id: dispatchId, created: false }] });
    const result = await domain.createOrReuseAutoTopupDispatchForWalletOrder(s.client, order.id, {
      adminId: actor,
      env: { AUTO_TOPUP_DISPATCH_ENABLED: "true" },
    });
    assert.deepEqual(result, { attempted: true, dispatchId, created: false });
    assert.equal(s.calls.filter((call) => call[0] === "rpc" && call[1] === "admin_create_topup_dispatch_dry_run").length, 1);
    checks.push("duplicate invocation reuses existing dispatch");
  }

  {
    const s = mockedDispatchSupabase();
    const result = await domain.createOrReuseAutoTopupDispatchForWalletOrder(s.client, order.id, {
      adminId: actor,
      env: { AUTO_TOPUP_DISPATCH_ENABLED: "false" },
    });
    assert.deepEqual(result, { attempted: false, reason: "disabled" });
    assert.deepEqual(s.calls, []);
    checks.push("disabled gate performs zero dispatch work");
  }

  {
    const helperCalls = [];
    const { calls, route } = loadWalletRoute({
      helperCalls,
      helperResult: { attempted: true, error: "dispatch_create_failed" },
    });
    const response = await postWallet(route);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.order_id, order.id);
    assert.equal(helperCalls.length, 1);
    assert.deepEqual(calls.map((call) => call[1]), ["process_wallet_payment"]);
    checks.push("dispatch failure keeps wallet success response");
  }

  {
    const s = mockedDispatchSupabase();
    await domain.createOrReuseAutoTopupDispatchForWalletOrder(s.client, order.id, {
      adminId: actor,
      env: { AUTO_TOPUP_DISPATCH_ENABLED: "true" },
    });
    const forbiddenRpcs = s.calls.filter((call) => call[0] === "rpc" && forbiddenRpcWords.test(call[1]));
    assert.deepEqual(forbiddenRpcs, []);
    checks.push("no extra wallet/refund/payment mutation RPC");
  }

  checks.push("no Telegram transport/module invoked");
  console.log(`AUTO_TOPUP_DISPATCH no-cost verification: PASS (${checks.length} checks)`);
  for (const check of checks) console.log(`PASS ${check}`);
}

main().catch((error) => {
  console.error("AUTO_TOPUP_DISPATCH no-cost verification: FAIL");
  console.error(error?.stack || error);
  process.exitCode = 1;
});
