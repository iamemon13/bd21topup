import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { actor, order, pkg, debit } from "./topup-test-helpers.mjs";
let db;
const migration = readFileSync(new URL("../supabase/migrations/20260925113000_add_topup_dispatch_dry_run.sql", import.meta.url), "utf8");
const scopedClaimMigration = readFileSync(new URL("../supabase/migrations/20260925190000_add_scoped_topup_dispatch_claim.sql", import.meta.url), "utf8");
const hash = (version="bd21-kaium-v1",uid=order.uid,sequence=1,product="weekly",quantity=1) => crypto.createHash("sha256").update(`bd21-topup-op-v1|${version}|${uid}|${sequence}|${product}|${quantity}`).digest("hex");
const operations = [{ productCode: "weekly", quantity: 1, commandHash: hash() }];
before(async () => {
  db = await PGlite.create();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE admin_roles(user_id uuid,role text,permissions text[]);
    CREATE TABLE orders(id uuid PRIMARY KEY,user_id uuid,uid text,package_name text,amount numeric(10,2),payment_method text,status text,cancelled_at timestamp);
    CREATE TABLE packages(id uuid PRIMARY KEY,name text,category text);
    CREATE TABLE wallet_transactions(id uuid PRIMARY KEY,reference_id uuid,user_id uuid,amount numeric,type text,direction text);
    CREATE TABLE admin_audit_logs(id uuid DEFAULT gen_random_uuid(),admin_id uuid,action_type text,target_id text,details text,ip_address text);
    CREATE TABLE profiles(id uuid,wallet_balance numeric);
    GRANT SELECT ON admin_roles,orders,packages,wallet_transactions TO service_role;
    GRANT SELECT,INSERT ON admin_audit_logs TO service_role;
    INSERT INTO admin_roles VALUES ('${actor}','admin',ARRAY['manage_orders']);
    INSERT INTO orders VALUES ('${order.id}','${order.user_id}','${order.uid}','${order.package_name}',158,'wallet','pending',NULL);
    INSERT INTO packages VALUES ('${pkg.id}','${pkg.name}','${pkg.category}');
    INSERT INTO wallet_transactions VALUES ('${debit.id}','${order.id}','${order.user_id}',158,'order_payment','debit');
    INSERT INTO profiles VALUES ('${order.user_id}',1000);`);
  await db.exec(migration);
  await db.exec(scopedClaimMigration);
});
after(async () => db?.close());
const call = () => db.query("SELECT * FROM admin_create_topup_dispatch_dry_run($1,$2,$3,$4,$5::jsonb,$6)", [actor,order.id,pkg.id,"bd21-kaium-v1",JSON.stringify(operations),"test"]);
async function reset() { await db.exec("DELETE FROM admin_audit_logs; DELETE FROM topup_dispatch_operations; DELETE FROM topup_dispatches; DELETE FROM orders WHERE id<>'22222222-2222-4222-8222-222222222222'; UPDATE orders SET user_id='33333333-3333-4333-8333-333333333333',status='pending',payment_method='wallet',cancelled_at=NULL,uid='123456789',amount=158; DELETE FROM wallet_transactions; INSERT INTO wallet_transactions VALUES ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',158,'order_payment','debit'); UPDATE packages SET id='95223d39-1880-4128-a222-08180089a229',name='Weekly',category='uid_bd'; UPDATE orders SET package_name='Weekly'; UPDATE admin_roles SET role='admin',permissions=ARRAY['manage_orders'];"); }
const secondOrderId = "55555555-5555-4555-8555-555555555555";
const secondDebitId = "66666666-6666-4666-8666-666666666666";
async function createSecondDispatch() {
  await db.query("INSERT INTO orders VALUES ($1,$2,$3,'Weekly',158,'wallet','pending',NULL)", [secondOrderId,order.user_id,"987654321"]);
  await db.query("INSERT INTO wallet_transactions VALUES ($1,$2,$3,158,'order_payment','debit')", [secondDebitId,secondOrderId,order.user_id]);
  const secondOps=[{productCode:"weekly",quantity:1,commandHash:hash("bd21-kaium-v1","987654321")}];
  return (await db.query("SELECT * FROM admin_create_topup_dispatch_dry_run($1,$2,$3,$4,$5::jsonb,$6)",[actor,secondOrderId,pkg.id,"bd21-kaium-v1",JSON.stringify(secondOps),"test"])).rows[0].dispatch_id;
}
test("eligible order creates once; duplicate request reuses dispatch", async () => {
  await reset(); const first=(await call()).rows[0], second=(await call()).rows[0];
  assert.equal(first.created,true); assert.equal(second.created,false); assert.equal(first.dispatch_id,second.dispatch_id);
  assert.equal((await db.query("SELECT count(*)::int n FROM topup_dispatches")).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*)::int n FROM topup_dispatch_operations")).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*)::int n FROM admin_audit_logs WHERE action_type='TOPUP_DISPATCH_CREATED'")).rows[0].n,1);
});
test("creation does not mutate order, wallet balance, or ledger", async () => {
  await reset(); const before=(await db.query("SELECT (SELECT row_to_json(o) FROM orders o),(SELECT row_to_json(p) FROM profiles p),(SELECT jsonb_agg(w) FROM wallet_transactions w)")).rows[0]; await call(); const afterState=(await db.query("SELECT (SELECT row_to_json(o) FROM orders o),(SELECT row_to_json(p) FROM profiles p),(SELECT jsonb_agg(w) FROM wallet_transactions w)")).rows[0]; assert.deepEqual(afterState,before);
});
for (const [label,sql] of [
  ["external payment","UPDATE orders SET payment_method='bkash'"],["invalid UID","UPDATE orders SET uid='12x'"],
  ["cancelled","UPDATE orders SET cancelled_at=now()"],["completed","UPDATE orders SET status='completed'"],
  ["missing debit","DELETE FROM wallet_transactions"],
  ["duplicate evidence","INSERT INTO wallet_transactions SELECT gen_random_uuid(),reference_id,user_id,amount,type,direction FROM wallet_transactions"],
  ["refund/conflict","INSERT INTO wallet_transactions SELECT gen_random_uuid(),reference_id,user_id,amount,'refund','credit' FROM wallet_transactions"],
  ["wrong amount","UPDATE wallet_transactions SET amount=999"],["wrong user",`UPDATE wallet_transactions SET user_id='${actor}'`],
  ["package category mismatch","UPDATE packages SET category='ff_likes'"],
  ["package UUID/name binding mismatch","UPDATE packages SET name='Renamed'; UPDATE orders SET package_name='Renamed'"],
]) test(`database rejects ${label}`, async () => { await reset(); await db.exec(sql); await assert.rejects(call()); assert.equal((await db.query("SELECT count(*)::int n FROM topup_dispatches")).rows[0].n,0); });
test("database rejects forged operation mapping and hashes", async () => { await reset(); for (const value of [[{...operations[0],productCode:"2530"}],[{...operations[0],commandHash:"bad"}]]) await assert.rejects(db.query("SELECT * FROM admin_create_topup_dispatch_dry_run($1,$2,$3,$4,$5::jsonb,$6)",[actor,order.id,pkg.id,"bd21-kaium-v1",JSON.stringify(value),"test"])); });
test("browser roles cannot read tables or execute privileged functions", async () => { await reset(); for (const role of ["anon","authenticated"]) { await db.exec(`SET ROLE ${role}`); await assert.rejects(db.query("SELECT * FROM topup_dispatches")); await assert.rejects(call()); await db.exec("RESET ROLE"); } });
test("claim is exclusive and dry-run completion never completes order", async () => { await reset(); await call(); const a=(await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('w1')")).rows; const b=(await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('w2')")).rows; assert.equal(a.length,1); assert.equal(b.length,0); const intent="77777777-7777-4777-8777-777777777777"; await db.query("SELECT start_topup_dispatch_send_intent_dry_run($1,'w1',$2)",[a[0].operation_id,intent]); await db.query("SELECT finish_topup_dispatch_operation_dry_run($1,'w1',$2,'dry_run_completed',$3,NULL)",[a[0].operation_id,intent,"b".repeat(64)]); assert.equal((await db.query("SELECT status FROM orders")).rows[0].status,"pending"); assert.equal((await db.query("SELECT status FROM topup_dispatches")).rows[0].status,"dry_run_completed"); });
test("scoped claim for dispatch A never claims dispatch B", async () => {
  await reset(); const dispatchA=(await call()).rows[0].dispatch_id; const dispatchB=await createSecondDispatch();
  const claimed=(await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('scoped-a',$1)",[dispatchA])).rows;
  assert.equal(claimed.length,1); assert.equal(claimed[0].dispatch_id,dispatchA); assert.notEqual(claimed[0].dispatch_id,dispatchB);
  assert.equal((await db.query("SELECT status FROM topup_dispatch_operations WHERE dispatch_id=$1",[dispatchB])).rows[0].status,"queued");
});
test("scoped claim returns no work instead of falling back to another dispatch", async () => {
  await reset(); const dispatchA=(await call()).rows[0].dispatch_id; const dispatchB=await createSecondDispatch();
  assert.equal((await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('owner-a',$1)",[dispatchA])).rows.length,1);
  assert.equal((await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('no-fallback',$1)",[dispatchA])).rows.length,0);
  assert.equal((await db.query("SELECT status FROM topup_dispatch_operations WHERE dispatch_id=$1",[dispatchB])).rows[0].status,"queued");
});
test("global claim without a dispatch filter retains existing behavior", async () => {
  await reset(); const dispatchA=(await call()).rows[0].dispatch_id; await createSecondDispatch();
  const claimed=(await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('global-worker')")).rows;
  assert.equal(claimed.length,1); assert.equal(claimed[0].dispatch_id,dispatchA);
});
test("stale scoped dispatch enters manual review without claiming other work", async () => {
  await reset(); const dispatchA=(await call()).rows[0].dispatch_id; const dispatchB=await createSecondDispatch();
  await db.query("UPDATE orders SET status='completed' WHERE id=$1",[order.id]);
  assert.equal((await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('stale-scoped',$1)",[dispatchA])).rows.length,0);
  assert.equal((await db.query("SELECT status FROM topup_dispatches WHERE id=$1",[dispatchA])).rows[0].status,"manual_review");
  assert.equal((await db.query("SELECT status FROM topup_dispatch_operations WHERE dispatch_id=$1",[dispatchB])).rows[0].status,"queued");
});
test("scoped bundle claims preserve sequence ordering", async () => {
  await reset(); const packageId="871e33b3-01b4-4f91-9c95-3d5cf03f45e6";
  await db.query("UPDATE packages SET id=$1,name='355 Diamond',category='uid_bd'",[packageId]); await db.query("UPDATE orders SET package_name='355 Diamond'");
  const ops=[{productCode:"240",quantity:1,commandHash:hash("bd21-kaium-v1",order.uid,1,"240",1)},{productCode:"115",quantity:1,commandHash:hash("bd21-kaium-v1",order.uid,2,"115",1)}];
  const dispatchId=(await db.query("SELECT * FROM admin_create_topup_dispatch_dry_run($1,$2,$3,$4,$5::jsonb,$6)",[actor,order.id,packageId,"bd21-kaium-v1",JSON.stringify(ops),"test"])).rows[0].dispatch_id;
  const first=(await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('bundle-worker',$1)",[dispatchId])).rows[0]; assert.equal(first.sequence_no,1);
  const intent="77777777-7777-4777-8777-777777777777"; await db.query("SELECT start_topup_dispatch_send_intent_dry_run($1,'bundle-worker',$2)",[first.operation_id,intent]); await db.query("SELECT finish_topup_dispatch_operation_dry_run($1,'bundle-worker',$2,'dry_run_completed',$3,NULL)",[first.operation_id,intent,"a".repeat(64)]);
  const second=(await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('bundle-worker',$1)",[dispatchId])).rows[0]; assert.equal(second.sequence_no,2);
});
test("concurrent scoped claims cannot duplicate an operation", async () => {
  await reset(); const dispatchId=(await call()).rows[0].dispatch_id;
  const [a,b]=await Promise.all([db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('concurrent-a',$1)",[dispatchId]),db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('concurrent-b',$1)",[dispatchId])]);
  assert.equal(a.rows.length+b.rows.length,1); assert.match(scopedClaimMigration,/FOR UPDATE OF o SKIP LOCKED/);
});
test("scoped claim does not mutate orders, balances, or wallet history", async () => {
  await reset(); const dispatchId=(await call()).rows[0].dispatch_id;
  const before=(await db.query("SELECT (SELECT jsonb_agg(o ORDER BY id) FROM orders o),(SELECT jsonb_agg(p ORDER BY id) FROM profiles p),(SELECT jsonb_agg(w ORDER BY id) FROM wallet_transactions w)")).rows[0];
  await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('financial-safety',$1)",[dispatchId]);
  const afterState=(await db.query("SELECT (SELECT jsonb_agg(o ORDER BY id) FROM orders o),(SELECT jsonb_agg(p ORDER BY id) FROM profiles p),(SELECT jsonb_agg(w ORDER BY id) FROM wallet_transactions w)")).rows[0]; assert.deepEqual(afterState,before);
});
test("uncertain result moves to manual review and cannot be reclaimed", async () => { await reset(); await call(); const claimed=(await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('w1')")).rows[0],intent="77777777-7777-4777-8777-777777777777"; await db.query("SELECT start_topup_dispatch_send_intent_dry_run($1,'w1',$2)",[claimed.operation_id,intent]); await db.query("SELECT finish_topup_dispatch_operation_dry_run($1,'w1',$2,'uncertain',$3,'timeout')",[claimed.operation_id,intent,"c".repeat(64)]); assert.equal((await db.query("SELECT status FROM topup_dispatches")).rows[0].status,"manual_review"); assert.equal((await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('w2')")).rows.length,0); });
test("audit failure rolls back dispatch creation atomically", async () => { await reset(); await db.exec("CREATE FUNCTION fail_dispatch_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failed'; END $$; CREATE TRIGGER fail_dispatch_audit BEFORE INSERT ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION fail_dispatch_audit();"); await assert.rejects(call(),/audit failed/); assert.equal((await db.query("SELECT count(*)::int n FROM topup_dispatches")).rows[0].n,0); await db.exec("DROP TRIGGER fail_dispatch_audit ON admin_audit_logs; DROP FUNCTION fail_dispatch_audit();"); });
test("migration is additive; definer RPCs are fixed-path and service-role-only", () => { assert.ok(!/UPDATE public\.(?:orders|profiles|wallet_transactions|packages)/i.test(migration)); assert.ok(!/DELETE FROM public\.(?:orders|profiles|wallet_transactions|packages)/i.test(migration)); assert.equal((migration.match(/SECURITY DEFINER SET search_path = ''/g)||[]).length,6); assert.equal((migration.match(/TO service_role/g)||[]).length,6); });
test("scoped claim migration preserves RPC-only security and contains no dynamic SQL", () => {
  assert.match(scopedClaimMigration,/p_dispatch_id uuid DEFAULT NULL/);
  assert.match(scopedClaimMigration,/p_dispatch_id IS NULL OR o\.dispatch_id=p_dispatch_id/);
  assert.match(scopedClaimMigration,/SECURITY DEFINER SET search_path = ''/);
  assert.match(scopedClaimMigration,/REVOKE ALL ON FUNCTION public\.claim_topup_dispatch_operation_dry_run\(text,uuid\) FROM PUBLIC, anon, authenticated/);
  assert.match(scopedClaimMigration,/GRANT EXECUTE ON FUNCTION public\.claim_topup_dispatch_operation_dry_run\(text,uuid\) TO service_role/);
  assert.doesNotMatch(scopedClaimMigration,/\bEXECUTE\b\s+(?:format|immediate)|UPDATE public\.(?:orders|profiles|wallet_transactions|packages)|DELETE FROM public\.(?:orders|profiles|wallet_transactions|packages)/i);
});
test("wallet writers and Phase 2 share a stable transaction advisory lock", async () => {
  assert.match(migration,/BEFORE INSERT ON public\.wallet_transactions/);
  assert.equal((migration.match(/pg_advisory_xact_lock/g)||[]).length,2);
  assert.equal((migration.match(/1110721073/g)||[]).length,3);
  const keys=(await db.query("SELECT ('x'||substr(replace($1::text,'-',''),1,8))::bit(32)::integer a, ('x'||substr(replace($1::text,'-',''),1,8))::bit(32)::integer same_a, ('x'||substr(replace($2::text,'-',''),1,8))::bit(32)::integer b",[order.id,"33333333-3333-4333-8333-333333333333"])).rows[0];
  assert.equal(keys.a,keys.same_a); assert.notEqual(keys.a,keys.b);
});
test("service role uses RPCs but cannot bypass them with table mutations", async () => { await reset(); await db.exec("SET ROLE service_role"); assert.equal((await call()).rows[0].created,true); await assert.rejects(db.exec("INSERT INTO topup_dispatches(order_id) VALUES(gen_random_uuid())"),/permission denied/); await assert.rejects(db.exec("UPDATE topup_dispatches SET status='failed'"),/permission denied/); await db.exec("RESET ROLE"); });
test("stale pre-intent claim safely requeues and is audited", async () => { await reset(); await call(); const op=(await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('w1')")).rows[0]; await db.query("UPDATE topup_dispatch_operations SET claimed_at=now()-interval '6 minutes' WHERE id=$1",[op.operation_id]); assert.equal((await db.query("SELECT recover_topup_dispatch_operation_dry_run($1) v",[op.operation_id])).rows[0].v,"queued"); assert.equal((await db.query("SELECT status FROM topup_dispatch_operations WHERE id=$1",[op.operation_id])).rows[0].status,"queued"); assert.equal((await db.query("SELECT count(*)::int n FROM admin_audit_logs WHERE action_type='TOPUP_DISPATCH_RECOVERED'")).rows[0].n,1); });
test("stale durable intent goes manual review and is never reclaimed", async () => { await reset(); await call(); const op=(await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('w1')")).rows[0],intent="77777777-7777-4777-8777-777777777777"; await db.query("SELECT start_topup_dispatch_send_intent_dry_run($1,'w1',$2)",[op.operation_id,intent]); await db.query("UPDATE topup_dispatch_operations SET claimed_at=now()-interval '6 minutes' WHERE id=$1",[op.operation_id]); assert.equal((await db.query("SELECT recover_topup_dispatch_operation_dry_run($1) v",[op.operation_id])).rows[0].v,"manual_review"); assert.equal((await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('w2')")).rows.length,0); });
test("database independently binds hash to version UID sequence product and quantity", async () => { await reset(); for (const bad of [hash("other"),hash("bd21-kaium-v1","99999"),hash("bd21-kaium-v1",order.uid,2),hash("bd21-kaium-v1",order.uid,1,"monthly"),hash("bd21-kaium-v1",order.uid,1,"weekly",2)]) await assert.rejects(db.query("SELECT * FROM admin_create_topup_dispatch_dry_run($1,$2,$3,$4,$5::jsonb,$6)",[actor,order.id,pkg.id,"bd21-kaium-v1",JSON.stringify([{...operations[0],commandHash:bad}]),"test"])); });
test("non-finite amounts are rejected", async () => { await reset(); await db.query("UPDATE orders SET amount='NaN'::numeric"); await db.query("UPDATE wallet_transactions SET amount='NaN'::numeric"); await assert.rejects(call()); for (const value of ["Infinity","-Infinity"]) { await reset(); await db.query("UPDATE wallet_transactions SET amount=$1::numeric",[value]); await assert.rejects(call()); } });
test("manual review on first bundle operation blocks every later operation", async () => { await reset(); const packageId="871e33b3-01b4-4f91-9c95-3d5cf03f45e6"; await db.query("UPDATE packages SET id=$1,name='355 Diamond',category='uid_bd'",[packageId]); await db.query("UPDATE orders SET package_name='355 Diamond'"); const ops=[{productCode:"240",quantity:1,commandHash:hash("bd21-kaium-v1",order.uid,1,"240",1)},{productCode:"115",quantity:1,commandHash:hash("bd21-kaium-v1",order.uid,2,"115",1)}]; await db.query("SELECT * FROM admin_create_topup_dispatch_dry_run($1,$2,$3,$4,$5::jsonb,$6)",[actor,order.id,packageId,"bd21-kaium-v1",JSON.stringify(ops),"test"]); const first=(await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('w1')")).rows[0],intent="77777777-7777-4777-8777-777777777777"; await db.query("SELECT start_topup_dispatch_send_intent_dry_run($1,'w1',$2)",[first.operation_id,intent]); await db.query("SELECT finish_topup_dispatch_operation_dry_run($1,'w1',$2,'uncertain',$3,'unknown')",[first.operation_id,intent,"d".repeat(64)]); assert.equal((await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('w2')")).rows.length,0); });
test("claim, send-intent, finish, and recovery roll back when audit insert fails", async () => { const install=()=>db.exec("CREATE FUNCTION fail_transition_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failed'; END $$; CREATE TRIGGER fail_transition_audit BEFORE INSERT ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION fail_transition_audit()"); const remove=()=>db.exec("DROP TRIGGER fail_transition_audit ON admin_audit_logs; DROP FUNCTION fail_transition_audit()");
  await reset(); await call(); await install(); await assert.rejects(db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('w1')"),/audit failed/); assert.equal((await db.query("SELECT status FROM topup_dispatch_operations")).rows[0].status,"queued"); await remove();
  await reset(); await call(); let op=(await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('w1')")).rows[0]; await install(); await assert.rejects(db.query("SELECT start_topup_dispatch_send_intent_dry_run($1,'w1',$2)",[op.operation_id,"77777777-7777-4777-8777-777777777777"]),/audit failed/); assert.equal((await db.query("SELECT status FROM topup_dispatch_operations")).rows[0].status,"processing"); await remove();
  await reset(); await call(); op=(await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('w1')")).rows[0]; const intent="77777777-7777-4777-8777-777777777777"; await db.query("SELECT start_topup_dispatch_send_intent_dry_run($1,'w1',$2)",[op.operation_id,intent]); await install(); await assert.rejects(db.query("SELECT finish_topup_dispatch_operation_dry_run($1,'w1',$2,'dry_run_completed',$3,NULL)",[op.operation_id,intent,"e".repeat(64)]),/audit failed/); assert.equal((await db.query("SELECT status FROM topup_dispatch_operations")).rows[0].status,"send_intent"); await remove();
  await reset(); await call(); op=(await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('w1')")).rows[0]; await db.query("UPDATE topup_dispatch_operations SET claimed_at=now()-interval '6 minutes' WHERE id=$1",[op.operation_id]); await install(); await assert.rejects(db.query("SELECT recover_topup_dispatch_operation_dry_run($1)",[op.operation_id]),/audit failed/); assert.equal((await db.query("SELECT status FROM topup_dispatch_operations")).rows[0].status,"processing"); await remove();
});

const staleEvidenceCases = [
  ["UID changed", "UPDATE orders SET uid='987654321'"],
  ["user changed", `UPDATE orders SET user_id='${actor}'`],
  ["package changed", "UPDATE orders SET package_name='Monthly'"],
  ["package name/category changed", "UPDATE packages SET name='Renamed',category='ff_likes'; UPDATE orders SET package_name='Renamed'"],
  ["amount changed", "UPDATE orders SET amount=159"],
  ["second evidence added", "INSERT INTO wallet_transactions SELECT gen_random_uuid(),reference_id,user_id,amount,type,direction FROM wallet_transactions"],
  ["refund evidence added", "INSERT INTO wallet_transactions SELECT gen_random_uuid(),reference_id,user_id,amount,'refund','credit' FROM wallet_transactions"],
  ["debit user changed", `UPDATE wallet_transactions SET user_id='${actor}'`],
  ["debit amount changed", "UPDATE wallet_transactions SET amount=159"],
  ["order cancelled", "UPDATE orders SET cancelled_at=now()"],
  ["order non-pending", "UPDATE orders SET status='completed'"],
  ["payment method changed", "UPDATE orders SET payment_method='bkash'"],
  ["operation manifest mismatch", `UPDATE topup_dispatch_operations SET product_code='monthly',command_hash='${hash("bd21-kaium-v1",order.uid,1,"monthly",1)}'`],
  ["command hash mismatch", `UPDATE topup_dispatch_operations SET command_hash='${"f".repeat(64)}'`],
];

test("payment evidence identity and existence are protected by the dispatch foreign key", async () => {
  await reset(); await call();
  await assert.rejects(db.exec("UPDATE wallet_transactions SET id='55555555-5555-4555-8555-555555555555'"),/foreign key/);
  await assert.rejects(db.exec("DELETE FROM wallet_transactions"),/foreign key/);
});

for (const [label, mutate] of staleEvidenceCases) {
  test(`existing dispatch is not reused after ${label}`, async () => {
    await reset(); await call(); await db.exec(mutate); await assert.rejects(call());
    assert.equal((await db.query("SELECT count(*)::int n FROM topup_dispatches")).rows[0].n,1);
  });
  test(`worker cannot claim after ${label}`, async () => {
    await reset(); await call(); await db.exec(mutate);
    assert.equal((await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('stale-worker')")).rows.length,0);
    assert.equal((await db.query("SELECT status FROM topup_dispatch_operations ORDER BY sequence_no LIMIT 1")).rows[0].status,"manual_review");
  });
}

test("send intent revalidates evidence changed after claim and stops transport boundary", async () => {
  await reset(); await call();
  const op=(await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('w1')")).rows[0];
  await db.exec("UPDATE orders SET uid='987654321'");
  const result=(await db.query("SELECT start_topup_dispatch_send_intent_dry_run($1,'w1',$2) v",[op.operation_id,"77777777-7777-4777-8777-777777777777"])).rows[0].v;
  assert.equal(result,null);
  assert.equal((await db.query("SELECT status,send_attempted_at FROM topup_dispatch_operations WHERE id=$1",[op.operation_id])).rows[0].status,"manual_review");
  assert.equal((await db.query("SELECT send_attempted_at FROM topup_dispatch_operations WHERE id=$1",[op.operation_id])).rows[0].send_attempted_at,null);
});

for (const [label,value] of [["NULL",null],["empty",""],["63 chars","a".repeat(63)],["65 chars","a".repeat(65)],["uppercase","A".repeat(64)],["non-hex","g".repeat(64)]]) {
  test(`finish rejects ${label} result hash`, async () => {
    await reset(); await call(); const op=(await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('w1')")).rows[0]; const intent="77777777-7777-4777-8777-777777777777";
    await db.query("SELECT start_topup_dispatch_send_intent_dry_run($1,'w1',$2)",[op.operation_id,intent]);
    await assert.rejects(db.query("SELECT finish_topup_dispatch_operation_dry_run($1,'w1',$2,'dry_run_completed',$3,NULL)",[op.operation_id,intent,value]));
    assert.equal((await db.query("SELECT status FROM topup_dispatch_operations WHERE id=$1",[op.operation_id])).rows[0].status,"send_intent");
  });
}

test("valid result hash completes and failed operation records failed_at", async () => {
  await reset(); await call(); let op=(await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('w1')")).rows[0]; let intent="77777777-7777-4777-8777-777777777777";
  await db.query("SELECT start_topup_dispatch_send_intent_dry_run($1,'w1',$2)",[op.operation_id,intent]); await db.query("SELECT finish_topup_dispatch_operation_dry_run($1,'w1',$2,'dry_run_completed',$3,NULL)",[op.operation_id,intent,"a".repeat(64)]);
  assert.ok((await db.query("SELECT completed_at FROM topup_dispatch_operations WHERE id=$1",[op.operation_id])).rows[0].completed_at);
  await reset(); await call(); op=(await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('w1')")).rows[0]; intent="88888888-8888-4888-8888-888888888888";
  await db.query("SELECT start_topup_dispatch_send_intent_dry_run($1,'w1',$2)",[op.operation_id,intent]); await db.query("SELECT finish_topup_dispatch_operation_dry_run($1,'w1',$2,'failed',$3,'definitive failure')",[op.operation_id,intent,"b".repeat(64)]);
  const failed=(await db.query("SELECT failed_at,failure_reason FROM topup_dispatch_operations WHERE id=$1",[op.operation_id])).rows[0]; assert.ok(failed.failed_at); assert.equal(failed.failure_reason,"definitive failure");
});

test("queued and processing states reject supplier result metadata", async () => {
  await reset(); await call();
  for (const assignment of ["supplier_message_id='x'","supplier_response_hash='"+"a".repeat(64)+"'","supplier_response_summary='result'"]) await assert.rejects(db.exec(`UPDATE topup_dispatch_operations SET ${assignment}`));
  const op=(await db.query("SELECT * FROM claim_topup_dispatch_operation_dry_run('w1')")).rows[0];
  await assert.rejects(db.query("UPDATE topup_dispatch_operations SET supplier_response_summary='result' WHERE id=$1",[op.operation_id]));
});
