import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const admin='11111111-1111-4111-8111-111111111111', user='22222222-2222-4222-8222-222222222222';
const target='33333333-3333-4333-8333-333333333333';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
let db;
before(async()=>{
 db=await PGlite.create();
 await db.exec(await read('tests/fixtures/support-schema.sql'));
 await db.exec(`
 CREATE TABLE admin_roles(user_id uuid UNIQUE,role text,permissions text[]);
 CREATE TABLE admin_audit_logs(id uuid DEFAULT gen_random_uuid(),admin_id uuid REFERENCES auth.users,action_type text,target_id text,details text,ip_address text);
 GRANT ALL ON admin_audit_logs TO service_role;
 CREATE TABLE api_rate_limits(ip text PRIMARY KEY,request_count integer,reset_at timestamptz);
 ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
 GRANT SELECT ON profiles TO authenticated;
 CREATE POLICY "Users can view their own profile" ON profiles FOR SELECT TO authenticated USING(id=auth.uid());
 DROP POLICY own_withdrawals ON withdrawals;
 CREATE POLICY "Users can view their own withdrawals" ON withdrawals FOR SELECT TO authenticated USING(user_id=auth.uid());
 INSERT INTO admin_roles VALUES ('${admin}','admin',ARRAY['manage_users','manage_orders','manage_add_money','manage_withdrawals']);
 `);
 await db.exec(await read('tests/fixtures/financial-rpcs.sql'));
 await db.exec(await read('tests/fixtures/audit-rpcs.sql'));
 await db.exec(await read('tests/fixtures/audit-undo.sql'));
 await db.exec(await read('supabase/migrations/20260921201839_harden_admin_cancel_order_refund.sql'));
 await db.exec(await read('supabase/migrations/20260923191844_harden_financial_audit_and_access.sql'));
 await db.exec(await read('supabase/migrations/20260921202738_harden_bulk_order_cancel_refund.sql'));
 await db.exec(await read('supabase/migrations/20260923193817_close_legacy_admin_financial_rpc_entrypoints.sql'));
});
after(async()=>db?.close());
const scalar=async(sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0];
async function rollback(fn){await db.exec('BEGIN');try{await fn();}finally{await db.exec('ROLLBACK');}}
const act=(operation,action=null,id=target)=>db.query('SELECT admin_financial_action($1,$2,$3,$4,100,$5)',[admin,operation,id,action,'test reason']);
test('service role uses audited wrapper while legacy direct RPC is denied',async()=>{
 await rollback(async()=>{await db.exec('SET LOCAL ROLE service_role');await act('wallet','add',user);assert.equal(await scalar('SELECT count(*)::int FROM admin_audit_logs'),1);});
 await rollback(async()=>{await db.exec('SET LOCAL ROLE service_role');await assert.rejects(db.query("SELECT admin_adjust_wallet($1,100,'add','test')",[user]),/permission denied/);});
});
test('wallet adjustment and audit commit together',()=>rollback(async()=>{
 await act('wallet','add',user);
 assert.equal(Number(await scalar('SELECT wallet_balance FROM profiles WHERE id=$1',[user])),1100);
 assert.equal(await scalar('SELECT count(*)::int FROM admin_audit_logs'),1);
 assert.equal(await scalar("SELECT action_type FROM admin_audit_logs"),'ADD_MONEY_TO_WALLET');
}));
test('audit insert failure rolls back wallet and ledger',()=>rollback(async()=>{
 await db.exec("CREATE FUNCTION fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$; CREATE TRIGGER fail_audit BEFORE INSERT ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION fail_audit(); SAVEPOINT attempt");
 await assert.rejects(act('wallet','add',user),/injected audit failure/);
 await db.exec('ROLLBACK TO SAVEPOINT attempt');
 assert.equal(Number(await scalar('SELECT wallet_balance FROM profiles WHERE id=$1',[user])),1000);
 assert.equal(await scalar('SELECT count(*)::int FROM wallet_transactions'),0);
}));
for(const action of ['approved','rejected']) test('add-money '+action+' is audited',()=>rollback(async()=>{
 await db.query('INSERT INTO add_money_requests(id,user_id) VALUES($1,$2)',[target,user]);
 await act('add_money',action);
 assert.equal(await scalar('SELECT status FROM add_money_requests WHERE id=$1',[target]),action);
 assert.equal(await scalar('SELECT count(*)::int FROM admin_audit_logs'),1);
 assert.equal(Number(await scalar('SELECT wallet_balance FROM profiles WHERE id=$1',[user])),action==='approved'?1100:1000);
 if(action==='approved'){await act('undo_add_money');assert.equal(Number(await scalar('SELECT wallet_balance FROM profiles WHERE id=$1',[user])),1000);assert.equal(await scalar('SELECT count(*)::int FROM admin_audit_logs'),2);}
}));
for(const action of ['approved','rejected']) test('withdrawal '+action+' checks debit and logs atomically',()=>rollback(async()=>{
 await db.query('INSERT INTO withdrawals(id,user_id) VALUES($1,$2)',[target,user]);
 await db.query("INSERT INTO wallet_transactions(user_id,type,direction,amount,reference_id) VALUES($1,'withdrawal','debit',100,$2)",[user,target]);
 await act('withdrawal',action);
 assert.equal(await scalar('SELECT status FROM withdrawals WHERE id=$1',[target]),action);
 assert.equal(await scalar('SELECT count(*)::int FROM admin_audit_logs'),1);
 assert.equal(Number(await scalar('SELECT wallet_balance FROM profiles WHERE id=$1',[user])),action==='rejected'?1100:1000);
}));
test('withdrawal without original debit cannot be refunded',()=>rollback(async()=>{
 await db.query('INSERT INTO withdrawals(id,user_id) VALUES($1,$2)',[target,user]);
 await assert.rejects(act('withdrawal','rejected'),/not verified/);
}));
test('order cancellation logs refund once and blocks duplicate',()=>rollback(async()=>{
 await db.query("INSERT INTO orders(id,user_id,payment_method) VALUES($1,$2,'wallet')",[target,user]);
 await db.query("INSERT INTO wallet_transactions(user_id,type,direction,amount,reference_id) VALUES($1,'order_payment','debit',100,$2)",[user,target]);
 await act('cancel_order');
 assert.equal(await scalar('SELECT count(*)::int FROM admin_audit_logs'),1);
 assert.equal(Number(await scalar('SELECT wallet_balance FROM profiles WHERE id=$1',[user])),1100);
 await assert.rejects(act('cancel_order'),/cannot be cancelled/);
}));
test('missing permission fails before mutation',()=>rollback(async()=>{
 await db.exec("UPDATE admin_roles SET permissions='{}'");
 await assert.rejects(act('wallet','add',user),/permission denied/);
}));
test('browser roles cannot execute privileged wrapper',()=>rollback(async()=>{
 await db.exec('SET LOCAL ROLE authenticated');
 await assert.rejects(act('wallet','add',user),/permission denied/);
}));
test('service role can append/read audit but cannot edit/delete/truncate',async()=>{
 for(const sql of ['UPDATE admin_audit_logs SET details=null','DELETE FROM admin_audit_logs','TRUNCATE admin_audit_logs']){
  await rollback(async()=>{await db.exec('SET LOCAL ROLE service_role');await assert.rejects(db.exec(sql),/permission denied/);});
 }
 await rollback(async()=>{await db.exec('SET LOCAL ROLE service_role');await db.exec("INSERT INTO admin_audit_logs(action_type) VALUES('TEST'); SELECT * FROM admin_audit_logs");});
});
test('RLS still isolates profiles and withdrawals by authenticated user',()=>rollback(async()=>{
 await db.exec(`SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${admin}'`);
 assert.equal(await scalar('SELECT count(*)::int FROM profiles'),1);
 assert.equal(await scalar('SELECT count(*)::int FROM withdrawals'),0);
}));
test('database rate counter enforces limit and resets after window',()=>rollback(async()=>{
 assert.equal(await scalar("SELECT check_uid_rate_limit('finance:test',2,60)"),true);
 assert.equal(await scalar("SELECT check_uid_rate_limit('finance:test',2,60)"),true);
 assert.equal(await scalar("SELECT check_uid_rate_limit('finance:test',2,60)"),false);
 await db.exec("UPDATE api_rate_limits SET reset_at=now()-interval '1 second' WHERE ip='finance:test'");
 assert.equal(await scalar("SELECT check_uid_rate_limit('finance:test',2,60)"),true);
}));
