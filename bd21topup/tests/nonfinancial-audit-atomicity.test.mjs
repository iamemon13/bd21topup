import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const actor = "11111111-1111-4111-8111-111111111111";
const packageId = "22222222-2222-4222-8222-222222222222";
const orderA = "33333333-3333-4333-8333-333333333333";
const orderB = "44444444-4444-4444-8444-444444444444";
const orderC = "55555555-5555-4555-8555-555555555555";
const userId = "66666666-6666-4666-8666-666666666666";

let db;

before(async () => {
  db = await PGlite.create();

  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;

    CREATE TABLE admin_roles (
      user_id uuid PRIMARY KEY,
      role text NOT NULL,
      permissions text[] DEFAULT '{}'::text[]
    );

    CREATE TABLE admin_audit_logs (
      admin_id uuid,
      action_type text NOT NULL,
      target_id text,
      details text,
      ip_address text
    );

    CREATE TABLE packages (
      id uuid PRIMARY KEY,
      name text NOT NULL UNIQUE,
      price numeric NOT NULL CHECK (price > 0),
      category text,
      sort_order integer,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE orders (
      id uuid PRIMARY KEY,
      user_id uuid,
      uid text NOT NULL,
      player_name text NOT NULL,
      product_name text NOT NULL,
      package_name text NOT NULL,
      amount numeric NOT NULL,
      status text NOT NULL,
      admin_note text,
      cancelled_at timestamp
    );

    GRANT SELECT, INSERT, UPDATE ON admin_roles TO service_role;
    GRANT SELECT, INSERT ON admin_audit_logs TO service_role;
    GRANT SELECT, UPDATE ON packages TO service_role;
    GRANT SELECT, UPDATE ON orders TO service_role;

    INSERT INTO admin_roles(user_id, role, permissions)
    VALUES (
      '${actor}',
      'super_admin',
      ARRAY[
        'manage_orders',
        'manage_packages'
      ]
    );

    INSERT INTO packages(id, name, price, category, sort_order)
    VALUES (
      '${packageId}',
      'Original Package',
      10,
      'uid',
      100
    );

    INSERT INTO orders(
      id,
      user_id,
      uid,
      player_name,
      product_name,
      package_name,
      amount,
      status
    )
    VALUES
      (
        '${orderA}',
        '${userId}',
        '1001',
        'Player A',
        'Free Fire UID TopUp',
        'Package A',
        10,
        'pending'
      ),
      (
        '${orderB}',
        '${userId}',
        '1002',
        'Player B',
        'Free Fire UID TopUp',
        'Package B',
        20,
        'approved'
      ),
      (
        '${orderC}',
        '${userId}',
        '1003',
        'Player C',
        'Free Fire UID TopUp',
        'Package C',
        30,
        'rejected'
      );
  `);

  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260924180051_atomic_nonfinancial_admin_audit.sql",
      import.meta.url,
    ),
    "utf8",
  );

  await db.exec(migration);
});

after(async () => {
  await db.close();
});

async function rollback(fn) {
  await db.exec("BEGIN");
  try {
    await fn();
  } finally {
    await db.exec("ROLLBACK");
  }
}

async function scalar(sql) {
  return (await db.query(sql)).rows[0].v;
}

function packageCall(
  adminId = actor,
  id = packageId,
  name = "Updated Package",
  price = 25,
) {
  return db.query(
    "SELECT * FROM admin_update_package_audited($1,$2,$3,$4,$5)",
    [adminId, id, name, price, "127.0.0.1"],
  );
}

function orderCall(
  expected = "pending",
  next = "completed",
  id = orderA,
) {
  return db.query(
    "SELECT * FROM admin_update_order_status_audited($1,$2,$3,$4,$5,$6)",
    [actor, id, expected, next, "done", "127.0.0.1"],
  );
}

function bulkCall(ids = [orderA, orderB, orderC]) {
  return db.query(
    "SELECT admin_bulk_complete_orders_audited($1,$2::uuid[],$3) AS ids",
    [
      actor,
      `{${ids.join(",")}}`,
      "127.0.0.1",
    ],
  );
}

test("package mutation and audit commit together", () =>
  rollback(async () => {
    await db.exec("SET LOCAL ROLE service_role");

    const result = await packageCall();

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].name, "Updated Package");
    assert.equal(Number(result.rows[0].price), 25);

    assert.equal(
      await scalar(
        `SELECT count(*)::int v
         FROM admin_audit_logs
         WHERE action_type='UPDATE_PACKAGE'`,
      ),
      1,
    );
  }));

test("package mutation rolls back when audit insert fails", () =>
  rollback(async () => {
    await db.exec(`
      CREATE FUNCTION fail_nonfinancial_audit()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'audit failure';
      END
      $$;

      CREATE TRIGGER fail_nonfinancial_audit
      BEFORE INSERT ON admin_audit_logs
      FOR EACH ROW
      EXECUTE FUNCTION fail_nonfinancial_audit();

      SET LOCAL ROLE service_role;
      SAVEPOINT attempt;
    `);

    await assert.rejects(packageCall(), /audit failure/);

    await db.exec("ROLLBACK TO SAVEPOINT attempt");

    assert.equal(
      await scalar(
        `SELECT price::numeric v
         FROM packages
         WHERE id='${packageId}'`,
      ),
      "10",
    );
  }));

test("database permission is rechecked inside package RPC", () =>
  rollback(async () => {
    await db.exec(`
      UPDATE admin_roles
      SET role='editor', permissions='{}'::text[]
      WHERE user_id='${actor}';

      SET LOCAL ROLE service_role;
    `);

    await assert.rejects(
      packageCall(),
      /Missing manage_packages permission/,
    );
  }));

test("single order transition and audit are atomic", () =>
  rollback(async () => {
    await db.exec("SET LOCAL ROLE service_role");

    const result = await orderCall("pending", "processing");

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].status, "processing");

    assert.equal(
      await scalar(
        `SELECT count(*)::int v
         FROM admin_audit_logs
         WHERE action_type='PROCESS_ORDER'
           AND target_id='${orderA}'`,
      ),
      1,
    );
  }));

test("stale expected order status causes no mutation or audit", () =>
  rollback(async () => {
    await db.exec(`
      UPDATE orders
      SET status='processing'
      WHERE id='${orderA}';

      SET LOCAL ROLE service_role;
    `);

    const result = await orderCall("pending", "completed");

    assert.equal(result.rows.length, 0);

    assert.equal(
      await scalar(
        `SELECT status v
         FROM orders
         WHERE id='${orderA}'`,
      ),
      "processing",
    );

    assert.equal(
      await scalar(
        `SELECT count(*)::int v
         FROM admin_audit_logs`,
      ),
      0,
    );
  }));

test("single order mutation rolls back when audit fails", () =>
  rollback(async () => {
    await db.exec(`
      CREATE FUNCTION fail_order_audit()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'audit failure';
      END
      $$;

      CREATE TRIGGER fail_order_audit
      BEFORE INSERT ON admin_audit_logs
      FOR EACH ROW
      EXECUTE FUNCTION fail_order_audit();

      SET LOCAL ROLE service_role;
      SAVEPOINT attempt;
    `);

    await assert.rejects(
      orderCall("pending", "completed"),
      /audit failure/,
    );

    await db.exec("ROLLBACK TO SAVEPOINT attempt");

    assert.equal(
      await scalar(
        `SELECT status v
         FROM orders
         WHERE id='${orderA}'`,
      ),
      "pending",
    );
  }));

test("bulk completion changes only eligible states and audits every changed row", () =>
  rollback(async () => {
    await db.exec("SET LOCAL ROLE service_role");

    const result = await bulkCall();
    const ids = result.rows[0].ids;

    assert.deepEqual(
      [...ids].sort(),
      [orderA, orderB].sort(),
    );

    const statuses = await db.query(`
      SELECT id::text, status
      FROM orders
      ORDER BY id
    `);

    assert.deepEqual(
      statuses.rows.map((row) => [row.id, row.status]),
      [
        [orderA, "completed"],
        [orderB, "completed"],
        [orderC, "rejected"],
      ],
    );

    assert.equal(
      await scalar(
        `SELECT count(*)::int v
         FROM admin_audit_logs
         WHERE action_type='BULK_COMPLETE_ORDER'`,
      ),
      2,
    );
  }));

test("bulk completion fully rolls back if audit insertion fails", () =>
  rollback(async () => {
    await db.exec(`
      CREATE FUNCTION fail_bulk_audit()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'audit failure';
      END
      $$;

      CREATE TRIGGER fail_bulk_audit
      BEFORE INSERT ON admin_audit_logs
      FOR EACH ROW
      EXECUTE FUNCTION fail_bulk_audit();

      SET LOCAL ROLE service_role;
      SAVEPOINT attempt;
    `);

    await assert.rejects(
      bulkCall([orderA, orderB]),
      /audit failure/,
    );

    await db.exec("ROLLBACK TO SAVEPOINT attempt");

    const statuses = await db.query(`
      SELECT id::text, status
      FROM orders
      WHERE id IN ('${orderA}', '${orderB}')
      ORDER BY id
    `);

    assert.deepEqual(
      statuses.rows.map((row) => [row.id, row.status]),
      [
        [orderA, "pending"],
        [orderB, "approved"],
      ],
    );
  }));

test("browser roles cannot execute privileged nonfinancial RPC", () =>
  rollback(async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(
        `SET LOCAL ROLE ${role}; SAVEPOINT denied_call;`,
      );

      await assert.rejects(
        packageCall(),
        /permission denied/,
      );

      await db.exec(
        "ROLLBACK TO SAVEPOINT denied_call; RESET ROLE;",
      );
    }
  }));
