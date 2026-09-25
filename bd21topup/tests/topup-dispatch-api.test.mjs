import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { load, generator, mappings, actor, order, pkg, debit } from "./topup-test-helpers.mjs";
const domain = load("lib/topup-dispatch.ts", { "node:crypto": crypto, "@/lib/topup-preview": generator, "@/lib/topup-mappings": mappings });

function setup({ role="admin", permissions=["manage_orders"], invalid=false, createError=null }={}) {
  const calls=[];
  const dispatchId="55555555-5555-4555-8555-555555555555";
  const operationId="66666666-6666-4666-8666-666666666666";
  const admin={ auth:{ getUser:async()=>invalid?{data:{user:null},error:{}}:{data:{user:{id:actor}},error:null} },
    from(table){ calls.push(["from",table]); const data={ admin_roles:{role,permissions}, orders:order, packages:[pkg], wallet_transactions:[debit], topup_dispatches:{id:dispatchId,order_id:order.id,status:"queued",dry_run:true,mapping_version:"bd21-kaium-v1",uid_snapshot:order.uid,package_name_snapshot:pkg.name,amount_snapshot:order.amount,manual_review_reason:null}, topup_dispatch_operations:[{id:operationId,sequence_no:1,product_code:"weekly",quantity:1,command_hash:"a".repeat(64),status:"queued",failure_reason:null}], admin_audit_logs:[{action_type:"TOPUP_DISPATCH_CREATED",created_at:"2026-09-25T00:00:00Z"}] }[table];
      const result={data,error:null}; const query={ select(){return query},eq(){return query},limit:async()=>result,maybeSingle:async()=>result,single:async()=>result,order:async()=>result }; return query; },
    async rpc(name,args){ calls.push(["rpc",name,args]); return {data:createError?null:[{dispatch_id:dispatchId,created:true}],error:createError}; }
  };
  const auth=load("lib/admin-auth.ts",{"@/lib/supabase-admin":{supabaseAdmin:admin}});
  const route=load("app/api/admin/orders/topup-dispatch/route.ts",{
    "next/server":{NextResponse:{json:(b,o)=>Response.json(b,o)}},"@/lib/admin-auth":auth,
    "@/lib/supabase-admin":{supabaseAdmin:admin},"@/lib/topup-dispatch":domain,"@/lib/topup-preview":generator,
  });
  return {calls,run:(body={orderId:order.id},token="Bearer test")=>route.POST(new Request("https://example.test/api/admin/orders/topup-dispatch",{method:"POST",headers:token?{authorization:token}:{},body:typeof body==="string"?body:JSON.stringify(body)}))};
}

for (const body of [{},{orderId:"bad"},{orderId:order.id,uid:"forged"},{orderId:order.id,adminId:actor},{orderId:order.id,packageId:pkg.id},{orderId:order.id,operations:["Ktp forged"]}])
  test("dispatch API rejects client-forged fields: "+JSON.stringify(body),async()=>{const s=setup();assert.equal((await s.run(body)).status,400);assert.ok(!s.calls.some(x=>x[0]==="rpc"));});
test("dispatch API uses authenticated actor and server-derived mapping only",async()=>{const s=setup();const response=await s.run();assert.equal(response.status,200);const call=s.calls.find(x=>x[0]==="rpc");assert.equal(call[1],"admin_create_topup_dispatch_dry_run");assert.equal(call[2].p_admin_id,actor);assert.equal(call[2].p_order_id,order.id);assert.deepEqual(call[2].p_operations.map(x=>[x.productCode,x.quantity]),[["weekly",1]]);assert.ok(!JSON.stringify(call[2]).includes("Ktp "));const body=await response.json();assert.equal(body.dispatch.dryRun,true);});
for (const [label,options,token,status] of [["missing auth",{},null,401],["invalid auth",{invalid:true},"Bearer bad",401],["missing permission",{permissions:[]},"Bearer test",403]])
  test("dispatch authorization: "+label,async()=>assert.equal((await setup(options).run(undefined,token)).status,status));
test("database revalidation errors do not expose dispatch",async()=>{const response=await setup({createError:{code:"55000",message:"secret"}}).run();assert.equal(response.status,409);assert.ok(!("dispatch" in await response.json()));});
