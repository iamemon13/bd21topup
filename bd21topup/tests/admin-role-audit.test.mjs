import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const actor='11111111-1111-4111-8111-111111111111';
const target='22222222-2222-4222-8222-222222222222';
let db;
before(async()=>{
  db=await PGlite.create();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE users(id uuid PRIMARY KEY);
    INSERT INTO users VALUES('${actor}'),('${target}');
    CREATE TABLE admin_roles(user_id uuid UNIQUE REFERENCES users,role text,permissions text[]);
    CREATE TABLE admin_audit_logs(admin_id uuid,action_type text,target_id text,details text,ip_address text);
    GRANT SELECT,INSERT,UPDATE ON admin_roles TO service_role;
    GRANT SELECT,INSERT ON admin_audit_logs TO service_role;
    INSERT INTO admin_roles VALUES('${actor}','super_admin','{}');`);
  await db.exec(await readFile(new URL('../supabase/migrations/20260924165709_atomic_admin_role_audit.sql',import.meta.url),'utf8'));
});
after(async()=>db.close());
async function rollback(fn){await db.exec('BEGIN');try{await fn();}finally{await db.exec('ROLLBACK');}}
const call=(a=actor,t=target,r='admin',p=['manage_orders'])=>db.query('SELECT admin_update_role($1,$2,$3,$4)',[a,t,r,p]);
const scalar=async sql=>(await db.query(sql)).rows[0].v;
test('service role change and audit commit together, invoker rights retained',()=>rollback(async()=>{
  await db.exec('SET LOCAL ROLE service_role');
  await call(actor,target,'editor',['manage_orders','manage_orders']);
  assert.deepEqual((await db.query('SELECT role,permissions FROM admin_roles WHERE user_id=$1',[target])).rows,[{role:'editor',permissions:['manage_orders']}]);
  assert.equal(await scalar('SELECT count(*)::int v FROM admin_audit_logs'),1);
  assert.equal(await scalar("SELECT prosecdef v FROM pg_proc WHERE proname='admin_update_role'"),false);
}));
test('audit failure rolls back an existing role change',()=>rollback(async()=>{
  await db.exec(`INSERT INTO admin_roles VALUES('${target}','editor','{}');
    CREATE FUNCTION fail_role_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END $$;
    CREATE TRIGGER fail_role_audit BEFORE INSERT ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION fail_role_audit();
    SET LOCAL ROLE service_role; SAVEPOINT attempt;`);
  await assert.rejects(call(),/audit failure/);await db.exec('ROLLBACK TO SAVEPOINT attempt');
  assert.equal(await scalar(`SELECT role v FROM admin_roles WHERE user_id='${target}'`),'editor');
  assert.equal(await scalar('SELECT count(*)::int v FROM admin_audit_logs'),0);
}));
for(const role of ['anon','authenticated'])test(role+' cannot call RPC',()=>rollback(async()=>{
  await db.exec('SET LOCAL ROLE '+role);await assert.rejects(call(),/permission denied/);
}));
test('non-super-admin and stale authority rejected inside RPC',()=>rollback(async()=>{
  await db.exec(`UPDATE admin_roles SET role='admin'; SET LOCAL ROLE service_role;`);
  await assert.rejects(call(),/Only Super Admin/);
}));
test('self-demotion rejected',()=>rollback(async()=>{await assert.rejects(call(actor,actor,'user'),/Cannot demote/);}));
for(const [role,permissions] of [['owner',[]],['admin',['unknown']],['admin',[null]],[null,[]]])
  test('invalid role/permission '+JSON.stringify([role,permissions]),()=>rollback(async()=>{await assert.rejects(call(actor,target,role,permissions),/Invalid/);}));
test('ordinary user permissions cleared and missing target cannot leave an audit',async()=>{
  await rollback(async()=>{await call(actor,target,'user',['manage_users']);assert.deepEqual((await db.query('SELECT permissions FROM admin_roles WHERE user_id=$1',[target])).rows[0].permissions,[]);});
  await rollback(async()=>{await db.exec('SAVEPOINT attempt');await assert.rejects(call(actor,'33333333-3333-4333-8333-333333333333'),/foreign key/);await db.exec('ROLLBACK TO SAVEPOINT attempt');assert.equal(await scalar('SELECT count(*)::int v FROM admin_audit_logs'),0);});
});

