import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  load,
  generator,
  mappings,
  actor,
  order,
  pkg,
  debit,
} from "./topup-test-helpers.mjs";

function setup(options = {}) {
  const calls = [];
  const admin = {
    auth: {
      getUser: async () =>
        options.invalid
          ? { data: { user: null }, error: {} }
          : { data: { user: { id: actor } }, error: null },
    },
    from(table) {
      calls.push(["read", table]);
      const rows = {
        admin_roles:
          options.role === null
            ? null
            : {
                role: options.role || "admin",
                permissions: options.permissions || ["manage_orders"],
              },
        orders: options.order === null ? null : { ...order, ...options.order },
        packages: options.packages || [pkg],
        wallet_transactions: options.ledger || [debit],
      };
      assert.ok(table in rows, "Unexpected table access " + table);
      const result = {
        data: rows[table],
        error:
          options.readError && table !== "admin_roles"
            ? { message: "SECRET_INTERNAL" }
            : null,
      };
      const query = {
        select() {
          return query;
        },
        eq(key, value) {
          calls.push(["filter", table, key, value]);
          return query;
        },
        maybeSingle: async () => result,
        limit: async () => result,
      };
      return query;
    },
    async rpc(name, args) {
      calls.push(["rpc", name, args]);
      assert.equal(name, "admin_audit_topup_preview");
      return {
        data: options.auditNull ? null : "2026-09-25T00:00:00Z",
        error: options.auditError || null,
      };
    },
  };
  const auth = load("lib/admin-auth.ts", {
    "@/lib/supabase-admin": { supabaseAdmin: admin },
  });
  const route = load("app/api/admin/orders/topup-preview/route.ts", {
    "node:crypto": crypto,
    "next/server": { NextResponse: { json: (b, o) => Response.json(b, o) } },
    "@/lib/admin-auth": auth,
    "@/lib/supabase-admin": { supabaseAdmin: admin },
    "@/lib/topup-preview": generator,
  });
  return {
    calls,
    run: (body = { orderId: order.id }, token = "Bearer test") =>
      route.POST(
        new Request("https://example.test/api/admin/orders/topup-preview", {
          method: "POST",
          headers: token ? { authorization: token } : {},
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
      ),
  };
}
for (const [name, opts, token, status] of [
  ["missing auth", {}, null, 401],
  ["invalid auth", { invalid: true }, "Bearer expired", 401],
  ["customer", { role: null }, "Bearer test", 403],
  ["user role", { role: "user" }, "Bearer test", 403],
  ["missing permission", { permissions: [] }, "Bearer test", 403],
  ["editor", { role: "editor" }, "Bearer test", 200],
  ["admin", {}, "Bearer test", 200],
  ["super admin", { role: "super_admin", permissions: [] }, "Bearer test", 200],
])
  test("authorization: " + name, async () => {
    const s = setup(opts);
    const response = await s.run(undefined, token);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    if (status !== 200)
      assert.equal(s.calls.filter((c) => c[0] === "rpc").length, 0);
  });
for (const body of [
  {},
  { orderId: "bad" },
  null,
  [],
  { orderId: order.id + "\n" },
  { orderId: order.id, uid: "12345" },
  { orderId: order.id, packageId: pkg.id },
  { orderId: order.id, packageName: "Monthly" },
  { orderId: order.id, commands: ["injected"] },
  { orderId: order.id, adminId: actor },
  "{",
])
  test("strict input " + JSON.stringify(body), async () => {
    const s = setup();
    assert.equal((await s.run(body)).status, 400);
    assert.ok(!s.calls.some((c) => c[1] === "orders"));
  });
for (const [name, opts, status, code] of [
  ["missing order", { order: null }, 404, "ORDER_NOT_FOUND"],
  ["completed", { order: { status: "completed" } }, 409, "ORDER_NOT_PENDING"],
  [
    "external",
    { order: { payment_method: "bkash" } },
    409,
    "PAYMENT_UNVERIFIED",
  ],
  ["no evidence", { ledger: [] }, 409, "DEBIT_MISSING"],
  ["catalog error", { readError: true }, 503, "READ_FAILED"],
  [
    "revoked permission",
    { auditError: { code: "42501" } },
    403,
    "PERMISSION_CHANGED",
  ],
  [
    "concurrent cancellation",
    { auditError: { code: "55000" } },
    409,
    "ELIGIBILITY_CHANGED",
  ],
  [
    "audit failure",
    { auditError: { code: "XX000", message: "SECRET_INTERNAL" } },
    503,
    "AUDIT_UNAVAILABLE",
  ],
  [
    "migration absent",
    { auditError: { code: "PGRST202" } },
    503,
    "AUDIT_UNAVAILABLE",
  ],
  ["invalid audit result", { auditNull: true }, 503, "AUDIT_UNAVAILABLE"],
])
  test(name, async () => {
    const s = setup(opts);
    const response = await s.run();
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.code, code);
    assert.equal(body.success, false);
    assert.ok(!("operations" in body));
    assert.ok(!JSON.stringify(body).includes("SECRET"));
  });
test("success releases only sanitized preview after audit with session actor and hashes", async () => {
  const s = setup();
  const r = await s.run();
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(
    Object.keys(body).sort(),
    [
      "success",
      "orderId",
      "uid",
      "packageId",
      "packageName",
      "category",
      "mappingVersion",
      "operations",
      "generatedAt",
    ].sort(),
  );
  const rpc = s.calls.find((c) => c[0] === "rpc");
  assert.equal(rpc[2].p_admin_id, actor);
  assert.deepEqual(Object.keys(rpc[2]).sort(), [
    "p_admin_id",
    "p_command_hashes",
    "p_debit_id",
    "p_expected_amount",
    "p_expected_category",
    "p_expected_package_name",
    "p_expected_uid",
    "p_expected_user_id",
    "p_ip",
    "p_mapping_version",
    "p_order_id",
    "p_package_id",
  ].sort());
  assert.deepEqual(rpc[2].p_command_hashes, [
    crypto.createHash("sha256").update("Ktp 123456789 weekly").digest("hex"),
  ]);
  assert.ok(!JSON.stringify(rpc[2]).includes("Ktp "));
  assert.ok(
    s.calls.some(
      (c) =>
        c[0] === "filter" &&
        c[1] === "wallet_transactions" &&
        c[2] === "reference_id" &&
        c[3] === order.id,
    ),
  );
  // The adapter deliberately exposes no insert/update/delete or financial RPC:
  // any added side effect makes this test fail instead of silently succeeding.
  assert.equal(s.calls.filter((c) => c[0] === "rpc").length, 1);
});

for (const [name, catalog, error, expected] of [
  ["approved binding", [pkg], null, "mapped"],
  ["unknown UUID", [{ ...pkg, id: order.id }], null, "unmapped"],
  ["excluded category", [{ ...pkg, category: "ff_likes" }], null, "unmapped"],
  ["ambiguous catalog", [pkg, pkg], null, "unmapped"],
  ["catalog unavailable", null, {}, "unavailable"],
])
  test("admin list returns only a mapping hint: " + name, async () => {
    const admin = {
      from(table) {
        if (table === "orders")
          return {
            select: () => ({
              order: async () => ({ data: [order], error: null }),
            }),
          };
        assert.equal(table, "packages");
        return { select: async () => ({ data: catalog, error }) };
      },
    };
    const route = load("app/api/admin/orders/route.ts", {
      "next/server": {
        NextResponse: { json: (body, options) => Response.json(body, options) },
      },
      "@/lib/admin-auth": {
        checkUserRole: async () => ({ user: { id: actor } }),
      },
      "@/lib/supabase-admin": { supabaseAdmin: admin },
      "@/lib/topup-mappings": mappings,
      "@/lib/financial-audit": {
        financialAction: () => {
          throw Error("Unexpected financial action");
        },
      },
    });
    const response = await route.GET(new Request("https://example.test"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.orders[0].topupMappingState, expected);
    assert.ok(!JSON.stringify(body).includes("Ktp"));
  });
