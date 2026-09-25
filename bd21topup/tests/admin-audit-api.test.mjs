import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { mappings } from "./topup-test-helpers.mjs";

const actor = "11111111-1111-4111-8111-111111111111";
const target = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

function load(path, imports) {
  const source = readFileSync(
    new URL("../" + path, import.meta.url),
    "utf8",
  );

  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const loaded = { exports: {} };

  new Function(
    "require",
    "module",
    "exports",
    js,
  )(
    (name) => {
      if (name === "@/lib/topup-mappings") return mappings;
      if (!(name in imports)) {
        throw Error("Unexpected import " + name);
      }

      return imports[name];
    },
    loaded,
    loaded.exports,
  );

  return loaded.exports;
}

const next = {
  "next/server": {
    NextResponse: {
      json: (body, options) => Response.json(body, options),
    },
  },
};

test("role API derives actor from verified token and uses only the atomic RPC", async () => {
  const calls = [];

  const admin = {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: actor,
          },
        },
      }),
    },

    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              role: "super_admin",
            },
          }),
        }),
      }),
    }),

    rpc: async (name, args) => {
      calls.push({ name, args });
      return { error: null };
    },
  };

  const api = load(
    "app/api/admin/role/route.ts",
    {
      ...next,
      "@/lib/supabase-admin": {
        supabaseAdmin: admin,
      },
    },
  );

  const response = await api.PATCH(
    new Request(
      "https://example.test",
      {
        method: "PATCH",
        headers: {
          authorization: "Bearer fixture",
        },
        body: JSON.stringify({
          userId: target,
          adminId: target,
          role: "editor",
          permissions: ["manage_orders"],
        }),
      },
    ),
  );

  assert.equal(response.status, 200);

  assert.deepEqual(
    calls,
    [
      {
        name: "admin_update_role",
        args: {
          p_admin_id: actor,
          p_user_id: target,
          p_role: "editor",
          p_permissions: ["manage_orders"],
        },
      },
    ],
  );
});

for (const role of ["admin", "editor", "user"]) {
  test(role + " rejected before role mutation", async () => {
    const admin = {
      auth: {
        getUser: async () => ({
          data: {
            user: {
              id: actor,
            },
          },
        }),
      },

      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                role,
              },
            }),
          }),
        }),
      }),

      rpc: () => {
        throw Error("Unexpected write");
      },
    };

    const api = load(
      "app/api/admin/role/route.ts",
      {
        ...next,
        "@/lib/supabase-admin": {
          supabaseAdmin: admin,
        },
      },
    );

    const response = await api.PATCH(
      new Request(
        "https://example.test",
        {
          method: "PATCH",
          headers: {
            authorization: "Bearer fixture",
          },
          body: "{}",
        },
      ),
    );

    assert.equal(response.status, 403);
  });
}

test("package update uses atomic audited RPC", async () => {
  const calls = [];

  const admin = {
    rpc: async (name, args) => {
      calls.push({ name, args });

      return {
        data: [
          {
            id: target,
            name: "Package X",
            price: 25,
            category: "uid",
            sort_order: 100,
            updated_at: "2026-09-24T00:00:00.000Z",
          },
        ],
        error: null,
      };
    },
  };

  const api = load(
    "app/api/admin/packages/route.ts",
    {
      ...next,

      "@/lib/supabase-admin": {
        supabaseAdmin: admin,
      },

      "@/lib/admin-auth": {
        checkUserRole: async () => ({
          user: {
            id: actor,
          },
          role: "super_admin",
        }),
      },
    },
  );

  const response = await api.PUT(
    new Request(
      "https://example.test",
      {
        method: "PUT",
        body: JSON.stringify({
          id: target,
          name: "Package X",
          price: 25,
        }),
      },
    ),
  );

  assert.equal(response.status, 200);

  assert.deepEqual(
    calls,
    [
      {
        name: "admin_update_package_audited",
        args: {
          p_admin_id: actor,
          p_package_id: target,
          p_name: "Package X",
          p_price: 25,
          p_ip: "unknown",
        },
      },
    ],
  );
});

test("single Add Money rejection requires a trimmed reason before the financial action", async () => {
  const calls = [];
  const requestId = target;
  const admin = {
    from: (table) => {
      if (table === "notifications") {
        return { insert: async () => ({ error: null }) };
      }
      if (table !== "add_money_requests") throw Error("Unexpected table " + table);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: requestId, user_id: userId, amount: 25 },
              error: null,
            }),
          }),
        }),
      };
    },
  };

  const api = load("app/api/admin/add-money/route.ts", {
    ...next,
    "@/lib/supabase-admin": { supabaseAdmin: admin },
    "@/lib/admin-auth": {
      checkUserRole: async () => ({ user: { id: actor }, role: "super_admin" }),
    },
    "@/lib/financial-audit": {
      financialAction: (input) => {
        calls.push(input);
        throw Error("Unexpected financial write");
      },
    },
  });

  const response = await api.PATCH(new Request("https://example.test", {
    method: "PATCH",
    body: JSON.stringify({ requestId, action: "rejected", adminNote: "  " }),
  }));

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Reject করার কারণ দেওয়া বাধ্যতামূলক।");
  assert.deepEqual(calls, []);
});

test("single Add Money rejection forwards the trimmed reason to the audited action", async () => {
  const calls = [];
  const requestId = target;
  const admin = {
    from: (table) => {
      if (table === "notifications") {
        return { insert: async () => ({ error: null }) };
      }
      if (table !== "add_money_requests") throw Error("Unexpected table " + table);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: requestId, user_id: userId, amount: 25 },
              error: null,
            }),
          }),
        }),
      };
    },
  };

  const api = load("app/api/admin/add-money/route.ts", {
    ...next,
    "@/lib/supabase-admin": { supabaseAdmin: admin },
    "@/lib/admin-auth": {
      checkUserRole: async () => ({ user: { id: actor }, role: "super_admin" }),
    },
    "@/lib/financial-audit": {
      financialAction: async (input) => {
        calls.push(input);
        return { data: { success: true }, error: null };
      },
    },
  });

  const response = await api.PATCH(new Request("https://example.test", {
    method: "PATCH",
    body: JSON.stringify({ requestId, action: "rejected", adminNote: "  কারণ  " }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{
    adminId: actor,
    operation: "add_money",
    targetId: requestId,
    action: "rejected",
    note: "কারণ",
  }]);
});

test("withdrawal rejection requires a trimmed reason before the financial action", async () => {
  const calls = [];
  const api = load("app/api/admin/withdrawals/route.ts", {
    ...next,
    "@/lib/supabase-admin": { supabaseAdmin: {} },
    "@/lib/admin-auth": {
      checkUserRole: async () => ({ user: { id: actor }, role: "super_admin" }),
    },
    "@/lib/financial-audit": {
      financialAction: (input) => {
        calls.push(input);
        throw Error("Unexpected financial write");
      },
    },
  });

  const response = await api.PATCH(new Request("https://example.test", {
    method: "PATCH",
    body: JSON.stringify({
      withdrawalId: target,
      status: "rejected",
      reason: "  ",
    }),
  }));

  assert.equal(response.status, 400);
  assert.equal(
    (await response.json()).error,
    "বাতিল করার সঠিক কারণ (Reason) উল্লেখ করা বাধ্যতামূলক।",
  );
  assert.deepEqual(calls, []);
});

test("withdrawal rejection forwards the trimmed reason to the audited action", async () => {
  const calls = [];
  const api = load("app/api/admin/withdrawals/route.ts", {
    ...next,
    "@/lib/supabase-admin": { supabaseAdmin: {} },
    "@/lib/admin-auth": {
      checkUserRole: async () => ({ user: { id: actor }, role: "super_admin" }),
    },
    "@/lib/financial-audit": {
      financialAction: async (input) => {
        calls.push(input);
        return { data: { success: true }, error: null };
      },
    },
  });

  const response = await api.PATCH(new Request("https://example.test", {
    method: "PATCH",
    body: JSON.stringify({
      withdrawalId: target,
      status: "rejected",
      reason: "  কারণ  ",
    }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{
    adminId: actor,
    operation: "withdrawal",
    targetId: target,
    action: "rejected",
    note: "কারণ",
  }]);
});

test("single nonfinancial order transition uses atomic audited RPC", async () => {
  const calls = [];

  const currentOrder = {
    id: target,
    user_id: userId,
    uid: "1001",
    player_name: "Player",
    product_name: "Free Fire UID TopUp",
    package_name: "Package X",
    amount: 25,
    status: "pending",
  };

  const admin = {
    from: (table) => {
      if (table === "orders") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: currentOrder,
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "notifications") {
        return {
          insert: async () => ({
            error: null,
          }),
        };
      }

      throw Error("Unexpected table " + table);
    },

    rpc: async (name, args) => {
      calls.push({ name, args });

      return {
        data: [
          {
            ...currentOrder,
            status: "completed",
          },
        ],
        error: null,
      };
    },
  };

  const api = load(
    "app/api/admin/orders/route.ts",
    {
      ...next,

      "@/lib/supabase-admin": {
        supabaseAdmin: admin,
      },

      "@/lib/admin-auth": {
        checkUserRole: async () => ({
          user: {
            id: actor,
          },
          role: "super_admin",
        }),
      },

      "@/lib/financial-audit": {
        financialAction: () => {
          throw Error("Unexpected financial write");
        },
      },
    },
  );

  const response = await api.PATCH(
    new Request(
      "https://example.test",
      {
        method: "PATCH",
        body: JSON.stringify({
          orderId: target,
          status: "completed",
          note: "done",
        }),
      },
    ),
  );

  assert.equal(response.status, 200);

  assert.deepEqual(
    calls,
    [
      {
        name: "admin_update_order_status_audited",
        args: {
          p_admin_id: actor,
          p_order_id: target,
          p_expected_status: "pending",
          p_next_status: "completed",
          p_admin_note: "done",
          p_ip: "unknown",
        },
      },
    ],
  );
});

test("bulk complete uses one atomic audited RPC", async () => {
  const calls = [];

  const admin = {
    rpc: async (name, args) => {
      calls.push({ name, args });

      return {
        data: [target],
        error: null,
      };
    },
  };

  const api = load(
    "app/api/admin/orders/bulk/route.ts",
    {
      ...next,

      "@/lib/supabase-admin": {
        supabaseAdmin: admin,
      },

      "@/lib/admin-auth": {
        checkUserRole: async () => ({
          user: {
            id: actor,
          },
          role: "super_admin",
        }),
      },

      "@/lib/financial-audit": {
        financialAction: () => {
          throw Error("Unexpected financial write");
        },
      },
    },
  );

  const response = await api.POST(
    new Request(
      "https://example.test",
      {
        method: "POST",
        body: JSON.stringify({
          orderIds: [target],
          action: "completed",
        }),
      },
    ),
  );

  assert.equal(response.status, 200);

  assert.deepEqual(
    calls,
    [
      {
        name: "admin_bulk_complete_orders_audited",
        args: {
          p_admin_id: actor,
          p_order_ids: [target],
          p_ip: "unknown",
        },
      },
    ],
  );
});
