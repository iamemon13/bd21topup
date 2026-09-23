import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../supabase/migrations/20260923190652_reconcile_proven_legacy_wallet_order_history.sql', import.meta.url), 'utf8');
const verification = (await readFile(new URL('../scripts/verify-legacy-wallet-repair.sql', import.meta.url), 'utf8'))
 .replace('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;', '')
 .replace('COMMIT;', '');
// Minimal production-shaped fixture, with observed financial fields only; no credentials/PII.
// This is not a full Supabase clone and cannot test concurrent connections.
const orders = [
  {
    "id": "cd414bb2-9772-4d41-9f07-0a7ac299c46d",
    "user_id": "b5ffb675-4a9a-4bc6-8161-17eae9ddabfd",
    "amount": 158,
    "created_at": "2026-09-18 05:17:18.853448+00",
    "balance_after": 1842
  },
  {
    "id": "4f4e29b6-d7e7-4d9d-bc54-19e902bfad19",
    "user_id": "b5ffb675-4a9a-4bc6-8161-17eae9ddabfd",
    "amount": 84,
    "created_at": "2026-09-18 05:47:34.110729+00",
    "balance_after": 1758
  },
  {
    "id": "16db2c94-1d7e-44f2-bcd4-11ef3ebeabc1",
    "user_id": "b5ffb675-4a9a-4bc6-8161-17eae9ddabfd",
    "amount": 105,
    "created_at": "2026-09-18 05:47:50.860296+00",
    "balance_after": 1653
  },
  {
    "id": "8ca251bc-cbc6-4d6e-9ced-2bea63f5566c",
    "user_id": "b5ffb675-4a9a-4bc6-8161-17eae9ddabfd",
    "amount": 130,
    "created_at": "2026-09-18 05:48:07.633871+00",
    "balance_after": 1523
  },
  {
    "id": "3e105037-6c3f-49eb-a7e3-9268d82b4806",
    "user_id": "b5ffb675-4a9a-4bc6-8161-17eae9ddabfd",
    "amount": 316,
    "created_at": "2026-09-18 08:43:26.664097+00",
    "balance_after": 1207
  },
  {
    "id": "8f4589ff-45ef-467d-9f38-6a9142d2e757",
    "user_id": "b5ffb675-4a9a-4bc6-8161-17eae9ddabfd",
    "amount": 316,
    "created_at": "2026-09-18 08:43:27.437366+00",
    "balance_after": 891
  },
  {
    "id": "4935d2f2-b333-4f2a-b9d3-bc6361b81359",
    "user_id": "c72627d1-e00a-49f2-bd3f-ab4aad852b0a",
    "amount": 400,
    "created_at": "2026-09-18 10:18:50.344382+00",
    "balance_after": 610
  }
];
const users = [orders[0].user_id, orders[6].user_id];
const anchors = [
 ['c9e63f4e-f172-4cd7-bdd2-f4514a665529',users[0],2000,2000,'e1b6e637-4408-41c7-bfc9-d6f03dca3c7b','2026-09-18 05:16:55.640923+00'],
 ['0d318659-6e79-4d4e-a581-1c70e6629094',users[1],1000,1010,'8a13a522-ef5e-43ae-a9d1-714d7fdaafc4','2026-09-18 10:18:26.996768+00'],
];
async function setup() {
 const db = await PGlite.create();
 await db.exec(`
 CREATE TABLE profiles(id uuid PRIMARY KEY, wallet_balance numeric CHECK(wallet_balance >= 0));
 CREATE TABLE orders(id uuid PRIMARY KEY, user_id uuid, amount numeric CHECK(amount>0), created_at timestamptz, payment_method text, status text, cancelled_at timestamp);
 CREATE TABLE withdrawals(id uuid PRIMARY KEY, user_id uuid);
 CREATE TABLE wallet_transactions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES profiles(id),
 type text NOT NULL CHECK(type IN ('add_money','order_payment','refund','adjustment','add_money_reversal','withdrawal','withdrawal_reversal')),
 direction text NOT NULL CHECK(direction IN ('credit','debit')),
 amount numeric NOT NULL CHECK(amount>0), balance_after numeric NOT NULL CHECK(balance_after>=0),
 reference_id uuid, description text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
 `);
 await db.query('INSERT INTO profiles VALUES ($1,891),($2,610)',users);
 for (const o of orders) await db.query('INSERT INTO orders VALUES ($1,$2,$3,$4,\'wallet\',\'completed\',NULL)',[o.id,o.user_id,o.amount,o.created_at]);
 for (const a of anchors) await db.query("INSERT INTO wallet_transactions(id,user_id,amount,balance_after,reference_id,created_at,type,direction,description) VALUES ($1,$2,$3,$4,$5,$6,'add_money','credit','Add Money approved')",a);
 // Unrelated complex account and ledger must survive byte-for-byte.
 await db.exec("INSERT INTO profiles VALUES ('ff05ca06-1160-4b59-bc22-32805a11dac6',9944); INSERT INTO wallet_transactions(user_id,type,direction,amount,balance_after) VALUES ('ff05ca06-1160-4b59-bc22-32805a11dac6','adjustment','credit',10,9944)");
 return db;
}
async function snapshot(db) {
 const {rows} = await db.query(`SELECT
 (SELECT jsonb_agg(p ORDER BY id) FROM profiles p) profiles,
 (SELECT jsonb_agg(o ORDER BY id) FROM orders o) orders,
 (SELECT jsonb_agg(t ORDER BY id) FROM wallet_transactions t) ledger`);
 return rows[0];
}
test('repair inserts exactly seven historical debits; preserves all existing rows; rollback removes repair', async () => {
 const db=await setup();
 try {
 const before=await snapshot(db);
 const preflight=(await db.query(verification)).rows[0].jsonb_build_object;
 assert.equal(preflight.preflight_targets_empty,true);
 assert.equal(preflight.expected_profiles_match,true);
 await db.exec('BEGIN');
 await db.exec(migration);
 const postflight=(await db.query(verification)).rows[0].jsonb_build_object;
 assert.equal(postflight.postflight_targets_exact,true);
 assert.equal(postflight.expected_profiles_match,true);
 assert.equal(postflight.affected_user_ledger_count,9);
 const after=await snapshot(db);
 assert.deepEqual(after.profiles,before.profiles);
 assert.deepEqual(after.orders,before.orders);
 for (const row of before.ledger) assert.deepEqual(after.ledger.find(x=>x.id===row.id),row);
 const added=after.ledger.filter(x=>!before.ledger.some(y=>y.id===x.id));
 assert.equal(added.length,7);
 assert.equal(added.reduce((s,x)=>s+Number(x.amount),0),1509);
 for(const o of orders) {
 const t=added.find(x=>x.reference_id===o.id);
 assert.equal(t.type,'order_payment'); assert.equal(t.direction,'debit');
 assert.equal(t.user_id,o.user_id); assert.equal(Number(t.amount),o.amount);
 assert.equal(Number(t.balance_after),o.balance_after);
 assert.equal(new Date(t.created_at).getTime(),new Date(o.created_at).getTime());
 assert.match(t.description,/reconstructed/);
 }
 await db.exec('ROLLBACK');
 assert.deepEqual(await snapshot(db),before);
 } finally {await db.close();}
});
test('a second application fails safely without adding duplicates',async()=>{
 const db=await setup();
 try {await db.exec(migration);const before=await snapshot(db);await assert.rejects(db.exec(migration),/history changed/);assert.deepEqual(await snapshot(db),before);}
 finally {await db.close();}
});
const changes=[
 ['wallet drift', "UPDATE profiles SET wallet_balance=892 WHERE wallet_balance=891", /checkpoints changed/],
 ['last order changed; earlier inserts rolled back', "UPDATE orders SET amount=401 WHERE id='4935d2f2-b333-4f2a-b9d3-bc6361b81359'", /Target order changed/],
 ['cancelled order', "UPDATE orders SET status='cancelled' WHERE id='4935d2f2-b333-4f2a-b9d3-bc6361b81359'", /Target order changed/],
 ['wrong owner', "UPDATE orders SET user_id='b5ffb675-4a9a-4bc6-8161-17eae9ddabfd' WHERE id='4935d2f2-b333-4f2a-b9d3-bc6361b81359'", /Target order changed/],
 ['missing target', "DELETE FROM orders WHERE id='4935d2f2-b333-4f2a-b9d3-bc6361b81359'", /history changed/],
 ['changed anchor', "UPDATE wallet_transactions SET balance_after=1009 WHERE id='0d318659-6e79-4d4e-a581-1c70e6629094'", /funding checkpoints changed/],
 ['new withdrawal', "INSERT INTO withdrawals VALUES(gen_random_uuid(),'c72627d1-e00a-49f2-bd3f-ab4aad852b0a')", /history changed/],
 ['linked refund under a different user', "INSERT INTO wallet_transactions(user_id,type,direction,amount,balance_after,reference_id) VALUES('ff05ca06-1160-4b59-bc22-32805a11dac6','refund','credit',400,9944,'4935d2f2-b333-4f2a-b9d3-bc6361b81359')", /Existing linked ledger/],
 ['unexpected ledger trigger', "CREATE FUNCTION test_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER test_trigger BEFORE INSERT ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION test_trigger()", /Unreviewed ledger trigger/],
];
for(const [name,change,expected] of changes) test(name,async()=>{
 const db=await setup();
 try {await db.exec(change);const before=await snapshot(db);await assert.rejects(db.exec(migration),expected);assert.deepEqual(await snapshot(db),before);}
 finally {await db.close();}
});
