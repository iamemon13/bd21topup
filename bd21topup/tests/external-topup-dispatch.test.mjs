import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { z } from "zod";
import {
  load,
  generator,
  mappings,
  actor,
  order,
  externalOrder,
  pkg,
  debit,
} from "./topup-test-helpers.mjs";

const domain = load("lib/topup-dispatch.ts", {
  "node:crypto": crypto,
  "@/lib/topup-preview": generator,
  "@/lib/topup-mappings": mappings,
});

const dispatchId = "55555555-5555-4555-8555-555555555555";
const operationId = "66666666-6666-4666-8666-666666666666";

function setupVerifyRoute({
  currentOrder = { ...externalOrder },
  currentCatalog = [pkg],
  role = "admin",
  permissions = ["manage_orders"],
  invalidAuth = false,
  createError = null,
  updateError = null,
  env = { AUTO_EXTERNAL_TOPUP_DISPATCH_ENABLED: "true" },
  existingDispatch = null,
} = {}) {
  const calls = [];
  let orderState = { ...currentOrder };

  const admin = {
    auth: {
      getUser: async () =>
        invalidAuth
          ? { data: { user: null }, error: { message: "Invalid session" } }
          : { data: { user: { id: actor } }, error: null },
    },
    from(table) {
      calls.push(["from", table]);
      const data = {
        admin_roles: { role, permissions },
        orders: orderState,
        packages: currentCatalog,
        topup_dispatches: existingDispatch || {
          id: dispatchId,
          order_id: orderState.id,
          status: "queued",
          dry_run: true,
          mapping_version: "bd21-kaium-v1",
          uid_snapshot: orderState.uid,
          package_name_snapshot: pkg.name,
          amount_snapshot: orderState.amount,
          manual_review_reason: null,
        },
        topup_dispatch_operations: [
          {
            id: operationId,
            sequence_no: 1,
            product_code: "weekly",
            quantity: 1,
            command_hash: "a".repeat(64),
            status: "queued",
            failure_reason: null,
            send_intent_id: null,
          },
        ],
        admin_audit_logs: [
          {
            action_type: "TOPUP_DISPATCH_CREATED",
            created_at: "2026-09-27T00:00:00Z",
          },
        ],
      }[table];

      const result = { data, error: null };
      const query = {
        select() {
          return query;
        },
        eq(col, val) {
          calls.push(["eq", table, col, val]);
          return query;
        },
        limit() {
          return query;
        },
        order() {
          return query;
        },
        maybeSingle: async () => result,
        single: async () => result,
        then(resolve, reject) {
          return Promise.resolve(result).then(resolve, reject);
        },
        update(values) {
          calls.push(["update", table, values]);
          orderState = { ...orderState, ...values };
          return {
            eq(col, val) {
              calls.push(["eq_update", table, col, val]);
              return Promise.resolve({ error: updateError });
            },
          };
        },
        insert(values) {
          calls.push(["insert", table, values]);
          return Promise.resolve({ error: null });
        },
      };
      return query;
    },
    async rpc(name, args) {
      calls.push(["rpc", name, args]);
      if (name === "admin_verify_external_order_payment") {
        if (updateError) {
          return { data: null, error: updateError };
        }
        orderState = {
          ...orderState,
          payment_verified_at: "2026-09-27T02:00:00Z",
          payment_verified_by: actor,
          payment_verification_source: args.p_source,
        };
        return {
          data: [{ verified: true, order_id: args.p_order_id, verified_at: "2026-09-27T02:00:00Z" }],
          error: null,
        };
      }
      if (createError) {
        return { data: null, error: createError };
      }
      return {
        data: [{ dispatch_id: dispatchId, created: !existingDispatch }],
        error: null,
      };
    },
  };

  const auth = load("lib/admin-auth.ts", {
    "@/lib/supabase-admin": { supabaseAdmin: admin },
  });

  const route = load("app/api/admin/orders/verify-payment/route.ts", {
    "next/server": {
      NextResponse: { json: (b, o) => Response.json(b, o) },
    },
    "@/lib/admin-auth": auth,
    "@/lib/supabase-admin": { supabaseAdmin: admin },
    "@/lib/topup-dispatch": {
      ...domain,
      autoExternalTopupDispatchEnabled: () =>
        env.AUTO_EXTERNAL_TOPUP_DISPATCH_ENABLED === "true",
      createOrReuseTopupDispatchForExternalOrder: (supabase, id, opts) =>
        domain.createOrReuseTopupDispatchForExternalOrder(supabase, id, {
          ...opts,
          env,
        }),
    },
    "@/lib/topup-mappings": mappings,
    "@/lib/topup-preview": generator,
  });

  return {
    calls,
    getOrderState: () => orderState,
    run: (body = { orderId: currentOrder.id }, token = "Bearer test") =>
      route.POST(
        new Request("https://example.test/api/admin/orders/verify-payment", {
          method: "POST",
          headers: token ? { authorization: token } : {},
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
      ),
  };
}

// ============================================================================
// A. Customer external order submit creates order only, zero dispatch, unverified
// ============================================================================
test("A. customer external order submit creates zero dispatch and is unverified", async () => {
  const calls = [];
  const fakeAdmin = {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: externalOrder.user_id,
            email: "user@example.test",
            user_metadata: { full_name: "Customer" },
          },
        },
        error: null,
      }),
    },
    from(table) {
      calls.push(["from", table]);
      const data = {
        packages: { name: "Weekly", price: "158.00" },
        orders: {
          id: externalOrder.id,
          user_id: externalOrder.user_id,
          uid: externalOrder.uid,
          status: "pending",
          payment_method: "bkash",
          transaction_id: "TRX12345678",
          payment_verified_at: null,
        },
      }[table];
      const result = { data, error: null };
      const q = {
        select: () => q,
        eq: (col, val) => {
          calls.push(["eq", table, col, val]);
          return q;
        },
        maybeSingle: async () => result,
        insert: (row) => {
          calls.push(["insert", table, row]);
          return {
            select: () => ({
              single: async () => ({
                data: { ...row, id: externalOrder.id },
                error: null,
              }),
            }),
          };
        },
      };
      return q;
    },
    rpc: async (name, args) => {
      calls.push(["rpc", name, args]);
      return { data: null, error: null };
    },
  };

  const ordersRoute = load("app/api/orders/route.ts", {
    "next/server": { NextResponse: { json: (b, o) => Response.json(b, o) } },
    zod: { z },
    "@/lib/supabase-admin": { supabaseAdmin: fakeAdmin },
    "@/lib/payment-config": {
      paymentConfig: {
        bkash: { number: "01700000000" },
        nagad: { number: "01800000000" },
        rocket: { number: "01900000000" },
        upay: { number: "01600000000" },
      },
    },
    "@/lib/financial-rate-limit": {
      checkFinancialRateLimit: async () => null,
    },
  });

  const response = await ordersRoute.POST(
    new Request("https://example.test/api/orders", {
      method: "POST",
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        uid: "123456789",
        packageName: "Weekly",
        paymentMethod: "bkash",
        transactionId: "TRX12345678",
      }),
    }),
  );

  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.success, true);
  // Zero dispatch calls
  assert.ok(
    !calls.some(
      ([act, table]) => act === "from" && table === "topup_dispatches",
    ),
  );
  assert.ok(!calls.some(([act]) => act === "rpc"));
  // Order inserted with status pending and no verified evidence
  const insertCall = calls.find(
    ([act, table]) => act === "insert" && table === "orders",
  );
  assert.ok(insertCall);
  assert.equal(insertCall[2].status, "pending");
  assert.equal(insertCall[2].payment_verified_at, undefined);
});

// ============================================================================
// B. Unverified external payment creates zero dispatch
// ============================================================================
test("B. unverified external payment creates zero dispatch", async () => {
  const calls = [];
  const mockSupabase = {
    from: (table) => {
      calls.push(["from", table]);
      const data = {
        orders: { ...externalOrder, payment_verified_at: null },
        packages: [pkg],
      }[table];
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data, error: null }),
            limit: () => ({ data, error: null }),
          }),
        }),
      };
    },
    rpc: async (name) => {
      calls.push(["rpc", name]);
      return { data: null, error: null };
    },
  };

  const result = await domain.createOrReuseTopupDispatchForExternalOrder(
    mockSupabase,
    externalOrder.id,
    { adminId: actor, env: { AUTO_EXTERNAL_TOPUP_DISPATCH_ENABLED: "true" } },
  );

  assert.equal(result.attempted, false);
  assert.equal(result.reason, "not_eligible");
  assert.ok(!calls.some(([act]) => act === "rpc"));
});

// ============================================================================
// C. Admin verifies eligible mapped external order
// ============================================================================
test("C. admin verifies eligible mapped external order and creates dispatch", async () => {
  const s = setupVerifyRoute();
  const response = await s.run();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.verified, true);
  assert.ok(body.order.paymentVerifiedAt);
  assert.equal(body.order.paymentVerifiedBy, actor);
  assert.equal(body.order.paymentVerificationSource, "admin");
  assert.equal(body.dispatch.id, dispatchId);

  // Ensure no direct updates or inserts for verification
  assert.ok(!s.calls.some((c) => c[0] === "update" && c[1] === "orders"));
  assert.ok(!s.calls.some((c) => c[0] === "insert" && c[1] === "admin_audit_logs"));

  // Check RPC calls: one for verification, one for dispatch
  const rpcCalls = s.calls.filter((c) => c[0] === "rpc");
  assert.equal(rpcCalls.length, 2);

  assert.equal(rpcCalls[0][1], "admin_verify_external_order_payment");
  assert.equal(rpcCalls[0][2].p_admin_id, actor);
  assert.equal(rpcCalls[0][2].p_source, "admin");

  assert.equal(rpcCalls[1][1], "admin_create_topup_dispatch_dry_run");
  assert.equal(rpcCalls[1][2].p_admin_id, actor);
});

// ============================================================================
// D. Repeated verification is idempotent
// ============================================================================
test("D. repeated verification does not duplicate verification or dispatch", async () => {
  const verifiedTime = "2026-09-27T01:00:00Z";
  const s = setupVerifyRoute({
    currentOrder: {
      ...externalOrder,
      payment_verified_at: verifiedTime,
      payment_verified_by: actor,
      payment_verification_source: "admin",
    },
    existingDispatch: {
      id: dispatchId,
      order_id: externalOrder.id,
      status: "queued",
      dry_run: true,
      mapping_version: "bd21-kaium-v1",
      uid_snapshot: externalOrder.uid,
      package_name_snapshot: pkg.name,
      amount_snapshot: externalOrder.amount,
      manual_review_reason: null,
    },
  });

  const response = await s.run();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.verified, true);
  // Did not update orders table with new timestamp
  assert.ok(!s.calls.some((c) => c[0] === "update" && c[1] === "orders"));
  // Did not insert new audit log
  assert.ok(
    !s.calls.some((c) => c[0] === "insert" && c[1] === "admin_audit_logs"),
  );
});

// ============================================================================
// E. Verified order with existing dispatch reuses dispatch
// ============================================================================
test("E. verified order with existing dispatch reuses existing dispatch", async () => {
  const s = setupVerifyRoute({
    currentOrder: {
      ...externalOrder,
      payment_verified_at: "2026-09-27T01:00:00Z",
      payment_verified_by: actor,
      payment_verification_source: "admin",
    },
    existingDispatch: {
      id: dispatchId,
      order_id: externalOrder.id,
      status: "queued",
      dry_run: true,
      mapping_version: "bd21-kaium-v1",
      uid_snapshot: externalOrder.uid,
      package_name_snapshot: pkg.name,
      amount_snapshot: externalOrder.amount,
      manual_review_reason: null,
    },
  });

  const response = await s.run();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.dispatch.id, dispatchId);
  assert.equal(body.dispatch.created, false);
});

// ============================================================================
// F. Dispatch creation failure keeps verification recorded and returns recoverable state
// ============================================================================
test("F. dispatch creation failure keeps verification recorded and returns recoverable response", async () => {
  const s = setupVerifyRoute({
    createError: { code: "55000", message: "Temporary failure" },
  });

  const response = await s.run();
  assert.equal(response.status, 200);
  const body = await response.json();
  // Payment remains verified!
  assert.equal(body.verified, true);
  assert.ok(body.order.paymentVerifiedAt);
  // Dispatch is null but dispatchError is reported
  assert.equal(body.dispatch, null);
  assert.equal(body.dispatchError, "55000");
  // Order verify RPC was executed
  assert.ok(s.calls.some((c) => c[0] === "rpc" && c[1] === "admin_verify_external_order_payment"));
});

// ============================================================================
// G. Invalid cases do not dispatch
// ============================================================================
test("G. cancelled order rejects verification and creates no dispatch", async () => {
  const s = setupVerifyRoute({
    currentOrder: { ...externalOrder, cancelled_at: "2026-09-27T00:00:00Z" },
  });
  const res = await s.run();
  assert.equal(res.status, 409);
  assert.ok(!s.calls.some((c) => c[0] === "rpc"));
});

test("G. completed order rejects verification and creates no dispatch", async () => {
  const s = setupVerifyRoute({
    currentOrder: { ...externalOrder, status: "completed" },
  });
  const res = await s.run();
  assert.equal(res.status, 409);
  assert.ok(!s.calls.some((c) => c[0] === "rpc"));
});

test("G. unmapped package rejects verification and creates no dispatch", async () => {
  const s = setupVerifyRoute({
    currentCatalog: [{ id: "unknown", name: "Weekly", category: "unknown" }],
  });
  const res = await s.run();
  assert.equal(res.status, 409);
  assert.ok(!s.calls.some((c) => c[0] === "rpc"));
});

test("G. missing transaction_id rejects verification and creates no dispatch", async () => {
  const s = setupVerifyRoute({
    currentOrder: { ...externalOrder, transaction_id: "" },
  });
  const res = await s.run();
  assert.equal(res.status, 400);
  assert.ok(!s.calls.some((c) => c[0] === "rpc"));
});

test("G. missing user rejects verification and creates no dispatch", async () => {
  const s = setupVerifyRoute({
    currentOrder: { ...externalOrder, user_id: null },
  });
  const res = await s.run();
  assert.equal(res.status, 409);
  assert.ok(!s.calls.some((c) => c[0] === "rpc"));
});

test("G. invalid payment method rejects verification and creates no dispatch", async () => {
  const s = setupVerifyRoute({
    currentOrder: { ...externalOrder, payment_method: "crypto" },
  });
  const res = await s.run();
  assert.equal(res.status, 400);
  assert.ok(!s.calls.some((c) => c[0] === "rpc"));
});

// ============================================================================
// H. Financial mutation safety: zero wallet debit/refund/rpc
// ============================================================================
test("H. external payment flow performs zero financial mutations", async () => {
  const s = setupVerifyRoute();
  await s.run();

  const forbiddenCalls = s.calls.filter(
    ([act, table]) =>
      (act === "from" &&
        (table === "wallet_transactions" || table === "profiles")) ||
      (act === "rpc" &&
        /wallet|refund|process_wallet_payment/i.test(String(table))),
  );
  assert.equal(forbiddenCalls.length, 0);
});

// ============================================================================
// I. Telegram safety: route never invokes Telegram
// ============================================================================
test("I. route never touches telegram modules or transports", async () => {
  const s = setupVerifyRoute();
  await s.run();
  assert.ok(
    !s.calls.some(
      ([, name]) =>
        typeof name === "string" && name.toLowerCase().includes("telegram"),
    ),
  );
});

// ============================================================================
// J. Wallet regression: existing wallet auto-topup passes
// ============================================================================
test("J. existing wallet auto-topup dispatch remains unchanged", async () => {
  const calls = [];
  const mockSupabase = {
    from: (table) => {
      calls.push(["from", table]);
      const data = {
        orders: order,
        packages: [pkg],
        wallet_transactions: [debit],
      }[table];
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data, error: null }),
            limit: () => ({ data, error: null }),
          }),
        }),
      };
    },
    rpc: async (name, args) => {
      calls.push(["rpc", name, args]);
      return {
        data: [{ dispatch_id: dispatchId, created: true }],
        error: null,
      };
    },
  };

  const result = await domain.createOrReuseAutoTopupDispatchForWalletOrder(
    mockSupabase,
    order.id,
    { adminId: actor, env: { AUTO_TOPUP_DISPATCH_ENABLED: "true" } },
  );

  assert.equal(result.attempted, true);
  assert.equal(result.dispatchId, dispatchId);
  assert.equal(result.created, true);
});

// ============================================================================
// K. Feature gate controls external auto-dispatch
// ============================================================================
test("K. feature gate false records verification but does not create dispatch", async () => {
  const s = setupVerifyRoute({
    env: { AUTO_EXTERNAL_TOPUP_DISPATCH_ENABLED: "false" },
  });
  const res = await s.run();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.verified, true);
  assert.equal(body.dispatch, null);
  // Zero dispatch RPC calls
  assert.ok(!s.calls.some((c) => c[0] === "rpc" && c[1] === "admin_create_topup_dispatch_dry_run"));
  // Verification RPC was called
  assert.ok(s.calls.some((c) => c[0] === "rpc" && c[1] === "admin_verify_external_order_payment"));
});

test("K. feature gate true creates dispatch for admin verified order", async () => {
  const s = setupVerifyRoute({
    env: { AUTO_EXTERNAL_TOPUP_DISPATCH_ENABLED: "true" },
  });
  const res = await s.run();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.verified, true);
  assert.ok(body.dispatch);
  assert.equal(body.dispatch.id, dispatchId);
});

// ============================================================================
// UI. TopUpPreviewActions UI modes for external payment flow
// ============================================================================
test("UI modes for external payment orders", async () => {
  const ui = load("components/TopUpPreviewActions.tsx", {
    react: {
      useEffect: () => {},
      useRef: () => ({ current: false }),
      useState: (init) => [init, () => {}],
    },
    "react/jsx-runtime": { jsx() {}, jsxs() {}, Fragment: Symbol("Fragment") },
    "@/lib/supabase": {
      supabase: {
        auth: { getSession: async () => ({ data: { session: null } }) },
      },
    },
    "@/components/TopUpPreviewDialog": () => null,
  });

  const verifiedOrder = {
    ...externalOrder,
    payment_verified_at: "2026-09-27T01:00:00Z",
    payment_verified_by: actor,
    payment_verification_source: "admin",
  };

  // 1. Unverified external order
  assert.equal(
    ui.getTopupDispatchUiMode(externalOrder, false, null, false, false),
    "external-unverified",
  );

  // 2. Verified external order loading dispatch
  assert.equal(
    ui.getTopupDispatchUiMode(verifiedOrder, false, null, false, true),
    "external-loading",
  );

  // 3. Verified external order with no dispatch found (fallback)
  assert.equal(
    ui.getTopupDispatchUiMode(verifiedOrder, false, null, true, true),
    "external-fallback",
  );

  // 4. Verified external order with dispatch loaded
  assert.equal(
    ui.getTopupDispatchUiMode(
      verifiedOrder,
      false,
      { id: dispatchId, status: "queued", operations: [] },
      true,
      true,
    ),
    "external-loaded",
  );

  // 5. Unmapped external order shows unmapped
  assert.equal(
    ui.getTopupDispatchUiMode(
      { ...externalOrder, topupMappingState: "unmapped" },
      false,
      null,
      false,
      true,
    ),
    "unmapped",
  );

  // 6. Completed external order shows none
  assert.equal(
    ui.getTopupDispatchUiMode(
      { ...externalOrder, status: "completed" },
      false,
      null,
      false,
      true,
    ),
    "none",
  );

  // 7. Cancelled external order shows none
  assert.equal(
    ui.getTopupDispatchUiMode(
      { ...externalOrder, cancelled_at: "2026-09-27T00:00:00Z" },
      false,
      null,
      false,
      true,
    ),
    "none",
  );
});

test("UI verifyExternalPayment client helper posts to correct endpoint", async () => {
  const ui = load("components/TopUpPreviewActions.tsx", {
    react: {
      useEffect: () => {},
      useRef: () => ({ current: false }),
      useState: (init) => [init, () => {}],
    },
    "react/jsx-runtime": { jsx() {}, jsxs() {}, Fragment: Symbol("Fragment") },
    "@/lib/supabase": {
      supabase: {
        auth: { getSession: async () => ({ data: { session: null } }) },
      },
    },
    "@/components/TopUpPreviewDialog": () => null,
  });

  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      json: async () => ({
        success: true,
        verified: true,
        order: {
          id: externalOrder.id,
          paymentVerifiedAt: "2026-09-27T01:00:00Z",
        },
        dispatch: { id: dispatchId },
      }),
    };
  };

  const result = await ui.verifyExternalPayment(
    "token-123",
    externalOrder.id,
    fakeFetch,
  );
  assert.equal(result.success, true);
  assert.equal(result.verified, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/admin/orders/verify-payment");
  assert.equal(calls[0].opts.headers.Authorization, "Bearer token-123");
  assert.equal(JSON.parse(calls[0].opts.body).orderId, externalOrder.id);
});
