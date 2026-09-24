import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const actor = '11111111-1111-4111-8111-111111111111';
const resolver = '33333333-3333-4333-8333-333333333333';
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
let db, migration, preflight, historical, originalCases;
async function base() {
  const instance = await PGlite.create();
  await instance.exec(await read('tests/fixtures/support-schema.sql'));
  await instance.exec(await read('supabase/migrations/20260922163357_secure_support_cases.sql'));
  return instance;
}
const cases = async instance => (await instance.query('SELECT * FROM support_cases ORDER BY id')).rows;
async function sourceSnapshot(instance) {
  const snapshot = {};
  for (const table of ['profiles', 'orders', 'add_money_requests', 'withdrawals', 'wallet_transactions', 'notifications']) {
    snapshot[table] = (await instance.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  }
  return snapshot;
}
const scalar = async (instance, sql, params = []) => Object.values((await instance.query(sql, params)).rows[0])[0];
async function rollback(fn) {
  await db.exec('BEGIN');
  try { await fn(); } finally { await db.exec('ROLLBACK'); }
}
const openCase = () => scalar(db, "SELECT id FROM support_cases WHERE case_type='ORD'");
const resolve = (caseId, note = 'Receipt verified', admin = actor) => db.query(
  'SELECT * FROM admin_resolve_support_case($1,$2,$3)', [admin, caseId, note],
);
before(async () => {
  migration = await read('supabase/migrations/20260924221423_add_support_case_resolution.sql');
  preflight = await read('scripts/preflight-support-case-resolution.sql');
  db = await base();
  // The old validator legitimately allowed resolution before metadata existed.
  await db.exec("UPDATE support_cases SET status='resolved' WHERE case_type='ADD'");
  originalCases = await cases(db);
  historical = originalCases.find(row => row.case_type === 'ADD');
  const beforeSources = await sourceSnapshot(db);
  await db.exec(migration);
  assert.deepEqual(await sourceSnapshot(db), beforeSources);
});
after(async () => { await db?.close(); });

test('historical resolved rows survive migration without invented metadata or changed evidence', async () => {
  for (const row of await cases(db)) {
    const { resolution_note, resolved_at, resolved_by, ...evidence } = row;
    assert.deepEqual(evidence, originalCases.find(old => old.id === row.id));
    assert.equal(resolution_note, null);
    assert.equal(resolved_at, null);
    assert.equal(resolved_by, null);
  }
  await rollback(async () => {
    await db.query('UPDATE support_cases SET updated_at=updated_at WHERE id=$1', [historical.id]);
    const row = (await db.query('SELECT * FROM support_cases WHERE id=$1', [historical.id])).rows[0];
    assert.equal(row.status, 'resolved');
    assert.equal(row.resolution_note, null);
    await assert.rejects(resolve(historical.id), /already resolved/);
  });
});

test('migration reruns preserve historical and new resolutions, source rows and effective ACLs', async () => {
  const instance = await base();
  try {
    await instance.exec("UPDATE support_cases SET status='resolved' WHERE case_type='ADD'");
    await instance.exec(migration);
    const id = await scalar(instance, "SELECT id FROM support_cases WHERE case_type='ORD'");
    await instance.query('SELECT * FROM admin_resolve_support_case($1,$2,$3)', [actor, id, 'Handled']);
    const rowsBefore = await cases(instance), sourcesBefore = await sourceSnapshot(instance);
    const auditsBefore = (await instance.query('SELECT * FROM admin_audit_logs ORDER BY id')).rows;
    await instance.exec(migration);
    await instance.exec(migration);
    assert.deepEqual(await cases(instance), rowsBefore);
    assert.deepEqual(await sourceSnapshot(instance), sourcesBefore);
    assert.deepEqual((await instance.query('SELECT * FROM admin_audit_logs ORDER BY id')).rows, auditsBefore);
    assert.deepEqual((await instance.query(`SELECT prosecdef,
      has_function_privilege('anon',oid,'EXECUTE') AS anon,
      has_function_privilege('authenticated',oid,'EXECUTE') AS authenticated,
      has_function_privilege('service_role',oid,'EXECUTE') AS service
      FROM pg_proc WHERE oid='public.admin_resolve_support_case(uuid,uuid,text,text)'::regprocedure`)).rows,
    [{ prosecdef: false, anon: false, authenticated: false, service: true }]);
  } finally { await instance.close(); }
});

test('partial columns and conflicting same-named CHECK/FK definitions are replaced deterministically', async () => {
  const instance = await base();
  try {
    await instance.exec(`ALTER TABLE support_cases ADD COLUMN resolution_note text,
      ADD COLUMN resolved_by uuid REFERENCES auth.users(id) ON DELETE CASCADE,
      ADD CONSTRAINT support_case_resolution_fields CHECK (true);`);
    const beforeRows = await cases(instance), beforeSources = await sourceSnapshot(instance);
    await instance.exec(migration);
    const definitions = (await instance.query(`SELECT conname, confdeltype, convalidated,
      pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid='support_cases'::regclass AND conname IN
      ('support_case_resolution_fields','support_cases_resolved_by_fkey')`)).rows;
    assert.equal(definitions.length, 2);
    assert.ok(definitions.every(row => row.convalidated));
    assert.equal(definitions.find(row => row.conname.endsWith('fkey')).confdeltype, 'n');
    assert.match(definitions.find(row => row.conname === 'support_case_resolution_fields').definition, /resolution_note IS NULL/);
    assert.deepEqual((await cases(instance)).map(({ resolved_at, ...row }) => { assert.equal(resolved_at, null); return row; }), beforeRows);
    assert.deepEqual(await sourceSnapshot(instance), beforeSources);
  } finally { await instance.close(); }
});

for (const definition of ['integer', "text DEFAULT 'fabricated'", 'text NOT NULL DEFAULT \'fabricated\'']) {
  test('incompatible pre-existing column fails closed: ' + definition, async () => {
    const instance = await base();
    try {
      await instance.exec('ALTER TABLE support_cases ADD COLUMN resolution_note ' + definition);
      const beforeRows = await cases(instance);
      await assert.rejects(instance.exec(migration), /Conflicting support case resolution column/);
      await instance.exec('ROLLBACK');
      assert.deepEqual(await cases(instance), beforeRows);
      assert.equal(await scalar(instance, "SELECT count(*)::int FROM information_schema.columns WHERE table_name='support_cases' AND column_name='resolved_at'"), 0);
    } finally { await instance.close(); }
  });
}

test('unexpected same-named constraint type fails rather than deleting unrelated constraints', async () => {
  const instance = await base();
  try {
    await instance.exec('ALTER TABLE support_cases ADD CONSTRAINT support_case_resolution_fields UNIQUE(support_id)');
    await assert.rejects(instance.exec(migration), /Conflicting support case resolution constraint type/);
    await instance.exec('ROLLBACK');
    assert.equal(await scalar(instance, "SELECT contype FROM pg_constraint WHERE conrelid='support_cases'::regclass AND conname='support_case_resolution_fields'"), 'u');
  } finally { await instance.close(); }
});

test('read-only preflight works before, during partial column setup and after migration', async () => {
  const instance = await base();
  try {
    await instance.exec("UPDATE support_cases SET status='resolved' WHERE case_type='ADD'");
    for (const stage of ['before', 'partial', 'after']) {
      if (stage === 'partial') await instance.exec('ALTER TABLE support_cases ADD COLUMN resolution_note text');
      if (stage === 'after') await instance.exec(migration);
      const beforeRows = await cases(instance);
      const results = await instance.exec(preflight);
      assert.equal(Number(results[1].rows[0].total_support_cases), 3);
      assert.equal(results[3].rows.length, 1);
      assert.equal(results[4].rows.filter(row => row.column_exists).length, { before: 0, partial: 1, after: 3 }[stage]);
      assert.deepEqual(await cases(instance), beforeRows);
    }
  } finally { await instance.close(); }
});

test('new resolutions reject missing or invalid metadata even with the historical CHECK exception', async () => {
  const variants = [
    [null, null, null], [null, '2026-09-25', actor], ['   ', '2026-09-25', actor],
    ['x'.repeat(501), '2026-09-25', actor], ['Valid note', null, actor],
    ['Valid note', '2026-09-25', null], ['Valid note', '2026-09-25', resolver],
  ];
  for (const [note, at, by] of variants) await rollback(async () => {
    const id = await openCase();
    const beforeSources = await sourceSnapshot(db);
    await db.exec('SET LOCAL ROLE service_role; SAVEPOINT attempt');
    await assert.rejects(db.query(`UPDATE support_cases SET status='resolved',
      resolution_note=$2, resolved_at=$3, resolved_by=$4 WHERE id=$1`, [id, note, at, by]),
    /Invalid support case resolution|foreign key/);
    await db.exec('ROLLBACK TO SAVEPOINT attempt');
    assert.deepEqual((await db.query('SELECT status,resolution_note,resolved_at,resolved_by FROM support_cases WHERE id=$1', [id])).rows,
      [{ status: 'open', resolution_note: null, resolved_at: null, resolved_by: null }]);
    assert.deepEqual(await sourceSnapshot(db), beforeSources);
  });
});

test('RPC requires a valid note and writes complete metadata without changing source/financial records', async () => {
  for (const note of [null, '', '   ', 'x'.repeat(501)]) await rollback(async () => {
    await assert.rejects(resolve(await openCase(), note), /Invalid support case resolution/);
  });
  await rollback(async () => {
    const beforeSources = await sourceSnapshot(db);
    await db.exec('SET LOCAL ROLE service_role');
    const { rows: [row] } = await resolve(await openCase(), '  Verified  ');
    assert.equal(row.resolution_note, 'Verified');
    assert.equal(row.resolved_by, actor);
    assert.ok(row.resolved_at);
    assert.equal(row.status, 'resolved');
    assert.deepEqual(await sourceSnapshot(db), beforeSources);
  });
});

test('audit INSERT failure rolls back status and all three resolution fields', async () => {
  await rollback(async () => {
    const id = await openCase();
    const beforeCases = await cases(db), beforeSources = await sourceSnapshot(db);
    await db.exec(`CREATE FUNCTION public.test_fail_resolution_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected resolution audit failure'; END $$;
      CREATE TRIGGER test_resolution_audit_failure BEFORE INSERT ON public.admin_audit_logs
      FOR EACH ROW EXECUTE FUNCTION public.test_fail_resolution_audit();
      SET LOCAL ROLE service_role; SAVEPOINT attempt;`);
    await assert.rejects(resolve(id), /injected resolution audit failure/);
    // Recover only the failed statement, not the enclosing fixture transaction.
    await db.exec('ROLLBACK TO SAVEPOINT attempt');
    assert.deepEqual((await db.query('SELECT status,resolution_note,resolved_at,resolved_by FROM support_cases WHERE id=$1', [id])).rows,
      [{ status: 'open', resolution_note: null, resolved_at: null, resolved_by: null }]);
    assert.deepEqual(await cases(db), beforeCases);
    assert.deepEqual(await sourceSnapshot(db), beforeSources);
    assert.equal(await scalar(db, 'SELECT count(*)::int FROM admin_audit_logs'), 0);
  });
});

test('resolver deletion preserves note/time; direct or unrelated nested clearing is rejected', async () => {
  await rollback(async () => {
    await db.query('INSERT INTO auth.users(id) VALUES($1)', [resolver]);
    await db.query("INSERT INTO admin_roles VALUES($1,'super_admin','{}')", [resolver]);
    const id = await openCase(), beforeSources = await sourceSnapshot(db);
    const { rows: [resolved] } = await resolve(id, 'Handled', resolver);
    await db.exec('SAVEPOINT clearing');
    await assert.rejects(db.query('UPDATE support_cases SET resolved_by=NULL WHERE id=$1', [id]), /immutable/);
    await db.exec('ROLLBACK TO SAVEPOINT clearing');
    await db.exec(`CREATE FUNCTION public.test_nested_clear() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN UPDATE public.support_cases SET resolved_by=NULL WHERE resolved_by=NEW.user_id; RETURN NEW; END $$;
      CREATE TRIGGER test_nested_clear AFTER UPDATE ON admin_roles FOR EACH ROW EXECUTE FUNCTION public.test_nested_clear();
      SAVEPOINT nested_clearing;`);
    await assert.rejects(db.query('UPDATE admin_roles SET role=role WHERE user_id=$1', [resolver]), /immutable/);
    await db.exec('ROLLBACK TO SAVEPOINT nested_clearing');
    // This fixture's admin_roles FK is restrictive; remove only the test actor role.
    await db.query('DELETE FROM admin_roles WHERE user_id=$1', [resolver]);
    await db.query('DELETE FROM auth.users WHERE id=$1', [resolver]);
    const row = (await db.query('SELECT * FROM support_cases WHERE id=$1', [id])).rows[0];
    assert.equal(row.status, 'resolved');
    assert.equal(row.resolved_by, null);
    assert.equal(row.resolution_note, resolved.resolution_note);
    assert.deepEqual(row.resolved_at, resolved.resolved_at);
    assert.deepEqual(await sourceSnapshot(db), beforeSources);
    await db.exec('SAVEPOINT tampering');
    await assert.rejects(db.query("UPDATE support_cases SET resolution_note='rewritten' WHERE id=$1", [id]), /immutable/);
  });
});

for (const role of ['anon', 'authenticated']) test(role + ' cannot call resolution RPC', async () => {
  await rollback(async () => {
    const id = await openCase();
    await db.exec('SET LOCAL ROLE ' + role);
    await assert.rejects(resolve(id), /permission denied/);
  });
});
