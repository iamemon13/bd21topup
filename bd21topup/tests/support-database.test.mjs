import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
let db;
const sqlFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
before(async () => {
  db = await PGlite.create();
  await db.exec(await sqlFile('tests/fixtures/support-schema.sql'));
  await db.exec(await sqlFile('tests/fixtures/financial-rpcs.sql'));
  await db.exec(await sqlFile('supabase/migrations/20260921201839_harden_admin_cancel_order_refund.sql'));
  await db.exec(await sqlFile('supabase/migrations/20260922135323_secure_support_cases.sql'));
});
after(async () => { await db?.close(); });
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
async function rolledBack(fn) {
  await db.exec('BEGIN');
  try { await fn(); } finally { await db.exec('ROLLBACK'); }
}

test('backfill creates one case and linked notification per eligible owned source without moving money', async () => {
  assert.equal(await scalar('SELECT count(*)::int FROM support_cases'), 3);
  assert.equal(await scalar('SELECT count(*)::int FROM notifications WHERE support_case_id IS NOT NULL'), 3);
  assert.equal(await scalar('SELECT sum(wallet_balance)::int FROM profiles'), 2000);
  const { rows } = await db.query('SELECT support_id, case_type, reason FROM support_cases');
  for (const row of rows) {
    assert.match(row.support_id, new RegExp(`^BD21-${row.case_type}-[A-F0-9]{12}$`));
    assert.ok(row.reason.length);
  }
});

test('RLS isolates owners; anonymous reads and client insert/update/delete are denied', async () => {
  await rolledBack(async () => {
    await db.exec(`SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${user}'`);
    assert.equal(await scalar('SELECT count(*)::int FROM support_cases'), 2);
    assert.equal(await scalar('SELECT count(*)::int FROM support_cases WHERE user_id = $1', [other]), 0);
  });
  for (const [role, query] of [
    ['anon', 'SELECT * FROM support_cases'],
    ['authenticated', "INSERT INTO support_cases(user_id) VALUES (gen_random_uuid())"],
    ['authenticated', "UPDATE support_cases SET status='resolved'"],
    ['authenticated', 'DELETE FROM support_cases'],
    ['authenticated', "SELECT support_private.create_case('ORD',gen_random_uuid(),gen_random_uuid())"],
    ['service_role', "UPDATE support_cases SET status='resolved'"],
  ]) {
    await rolledBack(async () => {
      await db.exec(`SET LOCAL ROLE ${role}`);
      await assert.rejects(db.exec(query), /permission denied/);
    });
  }
});

test('client cannot manufacture a case using the existing withdrawal INSERT privilege', async () => {
  await rolledBack(async () => {
    await db.exec(`SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${user}'`);
    await assert.rejects(db.query("INSERT INTO withdrawals(user_id,status) VALUES ($1,'rejected')", [user]), /permission denied/);
  });
});

test('pending withdrawal inserts still work only for their authenticated owner', async () => {
  await rolledBack(async () => {
    await db.exec(`SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${user}'`);
    const id = await scalar("INSERT INTO withdrawals(user_id,status) VALUES ($1,'pending') RETURNING id", [user]);
    assert.ok(id);
    assert.equal(await scalar('SELECT count(*)::int FROM support_cases'),2);
    await assert.rejects(db.query("INSERT INTO withdrawals(user_id,status) VALUES ($1,'pending')",[other]),/row-level security/);
  });
  await rolledBack(async () => {
    await db.exec("SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = ''");
    assert.equal(await scalar('SELECT count(*)::int FROM support_cases'),0);
  });
});

test('all rejection/cancellation paths are idempotent, including multi-row updates', async () => {
  await rolledBack(async () => {
    await db.exec('SET LOCAL ROLE service_role');
    for (const [table, status, type] of [['orders','cancelled','ORD'], ['orders','rejected','ORD'], ['add_money_requests','rejected','ADD'], ['withdrawals','rejected','WDR']]) {
      const { rows } = await db.query(`INSERT INTO ${table}(user_id) VALUES ($1),($1) RETURNING id`, [user]);
      const ids = rows.map((r) => r.id);
      await db.query(`UPDATE ${table} SET status=$1,admin_note='সঠিক কারণ' WHERE id=ANY($2::uuid[])`, [status,ids]);
      for (const id of ids) await db.query('SELECT support_private.create_case($1,$2,$3)', [type,id,user]);
      await db.query(`UPDATE ${table} SET status=$1 WHERE id=ANY($2::uuid[])`, [status,ids]);
      assert.equal(await scalar(`SELECT count(*)::int FROM support_cases WHERE coalesce(order_id,add_money_request_id,withdrawal_id)=ANY($1::uuid[])`, [ids]), 2);
    }
    assert.equal(await scalar('SELECT count(*)::int FROM support_cases'), 11);
    assert.equal(await scalar('SELECT count(*)::int FROM notifications WHERE support_case_id IS NOT NULL'), 11);
  });
});

test('forged ownership, ineligible source, mismatched type and duplicate source are rejected', async () => {
  for (const variant of ['owner','pending','type','duplicate']) {
    await rolledBack(async () => {
      const id = await scalar("INSERT INTO orders(user_id,status) VALUES ($1,$2) RETURNING id", [user,variant === 'pending' ? 'pending' : 'cancelled']);
      const caseType = variant === 'type' ? 'ADD' : 'ORD';
      await assert.rejects(db.query(`INSERT INTO support_cases(user_id,case_type,order_id,support_id,reason)
        VALUES ($1,$2,$3,$4,'forged')`, [variant === 'owner' ? other : user,caseType,id,`BD21-${caseType}-AAAAAAAAAAAA`]), /Invalid support case|duplicate key|check constraint/);
    });
  }
});

test('case identity/evidence cannot be rewritten even by a trusted update', async () => {
  await rolledBack(async () => {
    await assert.rejects(db.exec("UPDATE support_cases SET reason='changed'"), /immutable/);
  });
});

test('existing financial RPCs retain single refunds and approval behavior', async () => {
  await rolledBack(async () => {
    const order = await scalar("INSERT INTO orders(user_id,payment_method) VALUES ($1,'wallet') RETURNING id", [user]);
    await db.query("INSERT INTO wallet_transactions(user_id,type,direction,amount,reference_id) VALUES ($1,'order_payment','debit',100,$2)", [user,order]);
    const withdrawal = await scalar('INSERT INTO withdrawals(user_id) VALUES ($1) RETURNING id', [user]);
    const add = await scalar('INSERT INTO add_money_requests(user_id) VALUES ($1) RETURNING id', [user]);
    await db.query("SELECT admin_cancel_order($1,'কারণ')", [order]);
    await db.query("SELECT admin_review_withdrawal($1,'rejected','কারণ')", [withdrawal]);
    await db.query("SELECT admin_review_add_money($1,'rejected','কারণ')", [add]);
    assert.equal(await scalar('SELECT wallet_balance::int FROM profiles WHERE id=$1', [user]), 1200);
    assert.equal(await scalar("SELECT count(*)::int FROM wallet_transactions WHERE direction='credit'"), 2);
    assert.equal(await scalar('SELECT count(*)::int FROM support_cases'), 6);
    await db.exec('SAVEPOINT repeat_review');
    await assert.rejects(db.query("SELECT admin_review_withdrawal($1,'rejected','again')", [withdrawal]), /already reviewed/);
    await db.exec('ROLLBACK TO SAVEPOINT repeat_review');
    await assert.rejects(db.query("SELECT admin_cancel_order($1,'again')", [order]), /cannot be cancelled/);
    await db.exec('ROLLBACK TO SAVEPOINT repeat_review');
    assert.equal(await scalar('SELECT wallet_balance::int FROM profiles WHERE id=$1', [user]), 1200);
    const approved = await scalar('INSERT INTO add_money_requests(user_id) VALUES ($1) RETURNING id', [user]);
    await db.query("SELECT admin_review_add_money($1,'approved',null)", [approved]);
    assert.equal(await scalar('SELECT wallet_balance::int FROM profiles WHERE id=$1', [user]), 1300);
    assert.equal(await scalar('SELECT count(*)::int FROM support_cases'), 6);
  });
});

test('notification failure rolls back wallet refund, source status, case and ledger together', async () => {
  await rolledBack(async () => {
    const id = await scalar('INSERT INTO withdrawals(user_id) VALUES ($1) RETURNING id', [user]);
    await db.exec(`CREATE FUNCTION public.test_fail_notification() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected notification failure'; END $$;
      CREATE TRIGGER test_failure BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION public.test_fail_notification();
      SAVEPOINT financial_review;`);
    await assert.rejects(db.query("SELECT admin_review_withdrawal($1,'rejected','test')", [id]), /injected notification failure/);
    await db.exec('ROLLBACK TO SAVEPOINT financial_review');
    assert.equal(await scalar('SELECT wallet_balance::int FROM profiles WHERE id=$1', [user]), 1000);
    assert.equal(await scalar('SELECT status FROM withdrawals WHERE id=$1', [id]), 'pending');
    assert.equal(await scalar('SELECT count(*)::int FROM support_cases'), 3);
    assert.equal(await scalar('SELECT count(*)::int FROM wallet_transactions'), 0);
  });
});
