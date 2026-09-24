import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const actor = "11111111-1111-4111-8111-111111111111";

function load(path, imports) {
  const source = readFileSync(new URL("../" + path, import.meta.url), "utf8");

  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const loaded = { exports: {} };

  new Function("require", "module", "exports", js)(
    (name) => {
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

function makeSupabase({
  role = "super_admin",
  authUser = { id: actor },
  authError = null,
  logs = [],
  count = logs.length,
} = {}) {
  return {
    auth: {
      getUser: async () => ({
        data: { user: authUser },
        error: authError,
      }),

      admin: {
        getUserById: async () => ({
          data: {
            user: {
              id: actor,
              email: "admin@example.com",
            },
          },
          error: null,
        }),
      },
    },

    from(table) {
      if (table === "admin_roles") {
        return {
          select(columns) {
            if (columns === "role") {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: role ? { role } : null,
                      error: null,
                    }),
                  };
                },
              };
            }

            if (columns === "user_id") {
              return Promise.resolve({
                data: [{ user_id: actor }],
                error: null,
              });
            }

            if (columns === "user_id, role") {
              return {
                in: async () => ({
                  data: [{ user_id: actor, role }],
                  error: null,
                }),
              };
            }

            throw Error("Unexpected admin_roles select: " + columns);
          },
        };
      }

      if (table === "admin_audit_logs") {
        const state = {
          eqCalls: [],
          orCall: null,
          range: null,
        };

        const query = {
          select() {
            return query;
          },

          order() {
            return query;
          },

          range(from, to) {
            state.range = [from, to];
            return query;
          },

          eq(column, value) {
            state.eqCalls.push([column, value]);
            return query;
          },

          or(value) {
            state.orCall = value;
            return query;
          },

          then(resolve) {
            return Promise.resolve({
              data: logs,
              error: null,
              count,
            }).then(resolve);
          },

          _state: state,
        };

        return query;
      }

      throw Error("Unexpected table: " + table);
    },
  };
}

function loadApi(supabaseAdmin) {
  return load("app/api/admin/activity/route.ts", {
    ...next,
    "@/lib/supabase-admin": {
      supabaseAdmin,
    },
  });
}

test("activity API rejects missing bearer token", async () => {
  const api = loadApi(makeSupabase());

  const response = await api.GET(
    new Request("https://example.test/api/admin/activity"),
  );

  assert.equal(response.status, 401);
});

test("activity API rejects invalid session", async () => {
  const api = loadApi(
    makeSupabase({
      authUser: null,
      authError: { message: "invalid" },
    }),
  );

  const response = await api.GET(
    new Request("https://example.test/api/admin/activity", {
      headers: {
        authorization: "Bearer invalid",
      },
    }),
  );

  assert.equal(response.status, 401);
});

for (const role of ["admin", "editor", "user"]) {
  test(`activity API rejects ${role}`, async () => {
    const api = loadApi(makeSupabase({ role }));

    const response = await api.GET(
      new Request("https://example.test/api/admin/activity", {
        headers: {
          authorization: "Bearer fixture",
        },
      }),
    );

    assert.equal(response.status, 403);
  });
}

test("activity API accepts super admin and returns pagination", async () => {
  const api = loadApi(
    makeSupabase({
      logs: [
        {
          id: "log-1",
          admin_id: actor,
          action_type: "order.update",
          target_id: "target-1",
          details: "password=secret-value",
          ip_address: "127.0.0.1",
          created_at: "2026-09-25T00:00:00.000Z",
        },
      ],
      count: 30,
    }),
  );

  const response = await api.GET(
    new Request(
      "https://example.test/api/admin/activity?page=2&limit=25",
      {
        headers: {
          authorization: "Bearer fixture",
        },
      },
    ),
  );

  assert.equal(response.status, 200);

  const body = await response.json();

  assert.equal(body.success, true);
  assert.equal(body.pagination.page, 2);
  assert.equal(body.pagination.limit, 25);
  assert.equal(body.pagination.total, 30);
  assert.equal(body.pagination.totalPages, 2);
  assert.equal(body.pagination.hasPreviousPage, true);
  assert.equal(body.pagination.hasNextPage, false);

  assert.equal(body.items[0].adminEmail, "admin@example.com");
  assert.equal(body.items[0].adminRole, "super_admin");
  assert.equal(body.items[0].details, "password=[REDACTED]");
});

for (const url of [
  "https://example.test/api/admin/activity?page=0",
  "https://example.test/api/admin/activity?page=abc",
  "https://example.test/api/admin/activity?limit=101",
  "https://example.test/api/admin/activity?page=100001",
]) {
  test(`activity API rejects invalid pagination: ${url}`, async () => {
    const api = loadApi(makeSupabase());

    const response = await api.GET(
      new Request(url, {
        headers: {
          authorization: "Bearer fixture",
        },
      }),
    );

    assert.equal(response.status, 400);
  });
}

test("activity API rejects invalid admin id", async () => {
  const api = loadApi(makeSupabase());

  const response = await api.GET(
    new Request(
      "https://example.test/api/admin/activity?admin_id=not-a-uuid",
      {
        headers: {
          authorization: "Bearer fixture",
        },
      },
    ),
  );

  assert.equal(response.status, 400);
});

test("activity API rejects invalid action type", async () => {
  const api = loadApi(makeSupabase());

  const response = await api.GET(
    new Request(
      "https://example.test/api/admin/activity?action_type=%3Cscript%3E",
      {
        headers: {
          authorization: "Bearer fixture",
        },
      },
    ),
  );

  assert.equal(response.status, 400);
});

test("activity API rejects oversized search", async () => {
  const api = loadApi(makeSupabase());

  const search = "a".repeat(101);

  const response = await api.GET(
    new Request(
      `https://example.test/api/admin/activity?search=${search}`,
      {
        headers: {
          authorization: "Bearer fixture",
        },
      },
    ),
  );

  assert.equal(response.status, 400);
});
