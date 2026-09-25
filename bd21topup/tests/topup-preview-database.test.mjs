import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  actor,
  order,
  pkg,
  debit,
  fixtures,
} from "./topup-test-helpers.mjs";
let db;
const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260925062427_add_topup_preview_audit.sql",
    import.meta.url,
  ),
  "utf8",
);
before(async () => {
  db = await PGlite.create();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE admin_roles(user_id uuid,role text,permissions text[]);
    CREATE TABLE orders(id uuid PRIMARY KEY,user_id uuid,uid text,package_name text,amount numeric(10,2),payment_method text,status text,cancelled_at timestamp);
    CREATE TABLE packages(id uuid PRIMARY KEY,name text UNIQUE,category text);
    CREATE TABLE wallet_transactions(id uuid PRIMARY KEY,reference_id uuid,user_id uuid,amount numeric,type text,direction text);
    CREATE TABLE admin_audit_logs(id uuid DEFAULT gen_random_uuid(),admin_id uuid,action_type text,target_id text,details text,ip_address text);
    CREATE TABLE profiles(id uuid,wallet_balance numeric);
    CREATE TABLE payment_claims(id integer); CREATE TABLE support_cases(id integer); CREATE TABLE notifications(id integer);
    GRANT SELECT ON admin_roles,orders,packages,wallet_transactions TO service_role;
    GRANT UPDATE ON admin_roles,orders,packages TO service_role;
    GRANT SELECT,INSERT ON admin_audit_logs TO service_role;
    INSERT INTO profiles VALUES ('${order.user_id}',1000);
    INSERT INTO payment_claims VALUES(1); INSERT INTO support_cases VALUES(1); INSERT INTO notifications VALUES(1);`);
  await db.query("INSERT INTO admin_roles VALUES($1,$2,$3)", [
    actor,
    "admin",
    ["manage_orders"],
  ]);
  await db.query("INSERT INTO orders VALUES($1,$2,$3,$4,$5,$6,$7,NULL)", [
    order.id,
    order.user_id,
    order.uid,
    order.package_name,
    order.amount,
    "wallet",
    "pending",
  ]);
  await db.query("INSERT INTO packages VALUES($1,$2,$3)", [
    pkg.id,
    pkg.name,
    pkg.category,
  ]);
  await db.query("INSERT INTO wallet_transactions VALUES($1,$2,$3,$4,$5,$6)", [
    debit.id,
    order.id,
    order.user_id,
    158,
    "order_payment",
    "debit",
  ]);
  await db.exec(migration);
});
after(async () => db?.close());
const args = () => [
  actor,
  order.id,
  pkg.id,
  order.uid,
  order.user_id,
  158,
  pkg.name,
  pkg.category,
  debit.id,
  "bd21-kaium-v1",
  ["a".repeat(64)],
  "unknown",
];
const argsFor = (packageRow, uid = order.uid) => [
  actor,
  order.id,
  packageRow.id,
  uid,
  order.user_id,
  158,
  packageRow.name,
  packageRow.category,
  debit.id,
  "bd21-kaium-v1",
  ["a".repeat(64)],
  "unknown",
];
const call = (values = args()) =>
  db.query(
    "SELECT admin_audit_topup_preview($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    values,
  );
async function rollback(fn) {
  await db.exec("BEGIN");
  try {
    await fn();
  } finally {
    await db.exec("ROLLBACK");
  }
}
async function snapshot() {
  return (
    await db.query(
      `SELECT jsonb_build_object('orders',(SELECT jsonb_agg(t) FROM orders t),'wallet',(SELECT jsonb_agg(t) FROM profiles t),'ledger',(SELECT jsonb_agg(t) FROM wallet_transactions t),'claims',(SELECT jsonb_agg(t) FROM payment_claims t),'support',(SELECT jsonb_agg(t) FROM support_cases t),'notifications',(SELECT jsonb_agg(t) FROM notifications t)) AS state`,
    )
  ).rows[0].state;
}
test("audit is only write; source state unchanged; service invoker works", () =>
  rollback(async () => {
    const before = await snapshot();
    await db.exec("SET LOCAL ROLE service_role");
    await call();
    await db.exec("RESET ROLE");
    assert.deepEqual(await snapshot(), before);
    const log = (await db.query("SELECT * FROM admin_audit_logs")).rows[0];
    assert.equal(log.action_type, "TOPUP_PREVIEW");
    assert.equal(log.admin_id, actor);
    const details = JSON.parse(log.details);
    assert.equal(details.operation_count, 1);
    assert.equal(details.payment_evidence_id, debit.id);
    assert.ok(!log.details.includes("Ktp"));
    assert.ok(!log.details.includes(order.uid));
  }));
for (const role of ["anon", "authenticated"])
  test(role + " cannot invoke RPC", () =>
    rollback(async () => {
      await db.exec("SET LOCAL ROLE " + role);
      await assert.rejects(call(), /permission denied/);
    }),
  );
for (const [label, sql] of [
  ["revoked permission", "UPDATE admin_roles SET permissions='{}'"],
  ["wrong role", "UPDATE admin_roles SET role='user'"],
  ...["completed", "cancelled", "rejected", "processing", "approved"].map(
    (s) => [s, `UPDATE orders SET status='${s}'`],
  ),
  ["no owner", "UPDATE orders SET user_id=NULL"],
  ["cancelled timestamp", "UPDATE orders SET cancelled_at=now()"],
  ["external", "UPDATE orders SET payment_method='bkash'"],
  ["UID changed", "UPDATE orders SET uid='98765'"],
  ["UID newline", "UPDATE orders SET uid=E'12345\\n'"],
  ["amount changed", "UPDATE orders SET amount=159"],
  ["renamed package", "UPDATE packages SET name='Changed'"],
  ["category changed", "UPDATE packages SET category='ff_likes'"],
  ["missing debit", "DELETE FROM wallet_transactions"],
  ["wrong debit user", `UPDATE wallet_transactions SET user_id='${actor}'`],
  ["wrong amount", "UPDATE wallet_transactions SET amount=159"],
  ["credit", "UPDATE wallet_transactions SET direction='credit'"],
  ["wrong type", "UPDATE wallet_transactions SET type='adjustment'"],
  [
    "refund",
    "INSERT INTO wallet_transactions SELECT gen_random_uuid(),reference_id,user_id,amount,'refund','credit' FROM wallet_transactions",
  ],
  [
    "duplicate",
    "INSERT INTO wallet_transactions SELECT gen_random_uuid(),reference_id,user_id,amount,type,direction FROM wallet_transactions",
  ],
])
  test("database blocks " + label, () =>
    rollback(async () => {
      await db.exec(sql);
      await db.exec("SAVEPOINT attempt");
      await assert.rejects(call());
      await db.exec("ROLLBACK TO SAVEPOINT attempt");
      assert.equal(
        (await db.query("SELECT count(*)::int AS n FROM admin_audit_logs"))
          .rows[0].n,
        0,
      );
    }),
  );
test("audit failure aborts successful RPC and preserves all source state", () =>
  rollback(async () => {
    const before = await snapshot();
    await db.exec(`CREATE FUNCTION fail_preview_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END $$;
    CREATE TRIGGER fail_preview_audit BEFORE INSERT ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION fail_preview_audit(); SAVEPOINT attempt;`);
    await assert.rejects(call(), /audit failure/);
    await db.exec("ROLLBACK TO SAVEPOINT attempt");
    assert.deepEqual(await snapshot(), before);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM admin_audit_logs"))
        .rows[0].n,
      0,
    );
  }));
for (const [label, uid] of [
  ["NULL", null],
  ["empty", ""],
  ["whitespace", " 12345"],
  ["newline", "12345\n"],
  ["unicode digits", "１２３４５"],
  ["punctuation", "1234-5"],
  ["letters", "1234a"],
  ["too short", "1234"],
  ["too long", "1234567890123456"],
])
  test("database rejects invalid UID: " + label, () =>
    rollback(async () => {
      const values = args();
      await db.query("UPDATE orders SET uid=$1", [uid]);
      values[3] = uid;
      await db.exec("SAVEPOINT attempt");
      await assert.rejects(call(values));
      await db.exec("ROLLBACK TO SAVEPOINT attempt");
      assert.equal(
        (await db.query("SELECT count(*)::int AS n FROM admin_audit_logs"))
          .rows[0].n,
        0,
      );
    }));
test("all 37 approved package UUIDs pass the database allowlist", () =>
  rollback(async () => {
    for (const packageRow of fixtures) {
      await db.exec("SAVEPOINT attempt");
      await db.query("UPDATE packages SET id=$1,name=$2,category=$3", [
        packageRow.id,
        packageRow.name,
        packageRow.category,
      ]);
      await db.query("UPDATE orders SET package_name=$1", [packageRow.name]);
      await call(argsFor(packageRow));
      await db.exec("ROLLBACK TO SAVEPOINT attempt");
    }
  }));
for (const [label, packageId, category] of [
  ["random UUID", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "uid_bd"],
  ["FF Likes UUID", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "ff_likes"],
  [
    "Indonesia UUID",
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    "indo_server",
  ],
])
  test("database rejects " + label, () =>
    rollback(async () => {
      await db.query("UPDATE packages SET id=$1,name='Weekly',category=$2", [
        packageId,
        category,
      ]);
      await db.exec("SAVEPOINT attempt");
      await assert.rejects(call());
      await db.exec("ROLLBACK TO SAVEPOINT attempt");
    }));
for (const [label, index, value] of [
  ["bad hashes", 10, ["bad"]],
  ["missing hashes", 10, null],
  ["wrong version", 9, "other"],
  ["stale debit", 8, actor],
])
  test(label, () =>
    rollback(async () => {
      const values = args();
      values[index] = value;
      await assert.rejects(call(values));
    }),
  );
test("migration has no data backfill or financial mutation statements", () => {
  assert.ok(!/\b(?:UPDATE|DELETE\s+FROM|TRUNCATE)\s+public\./i.test(migration));
  assert.deepEqual(
    [...migration.matchAll(/INSERT INTO\s+([\w.]+)/g)].map((m) => m[1]),
    ["public.admin_audit_logs"],
  );
  assert.ok(!/SECURITY DEFINER/.test(migration));
});
