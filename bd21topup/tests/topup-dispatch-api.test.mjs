import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { load, generator, mappings, actor, order, pkg, debit } from "./topup-test-helpers.mjs";
const domain = load("lib/topup-dispatch.ts", { "node:crypto": crypto, "@/lib/topup-preview": generator, "@/lib/topup-mappings": mappings });

function setup({ role="admin", permissions=["manage_orders"], invalid=false, createError=null, retryError=null, dispatchStatus="queued", manualReviewReason=null, operationStatus="queued", failureReason=null, sendIntentId=null }={}) {
  const calls=[];
  const dispatchId="55555555-5555-4555-8555-555555555555";
  const operationId="66666666-6666-4666-8666-666666666666";
  const admin={ auth:{ getUser:async()=>invalid?{data:{user:null},error:{}}:{data:{user:{id:actor}},error:null} },
    from(table){ calls.push(["from",table]); const data={ admin_roles:{role,permissions}, orders:order, packages:[pkg], wallet_transactions:[debit], topup_dispatches:{id:dispatchId,order_id:order.id,status:dispatchStatus,dry_run:true,mapping_version:"bd21-kaium-v1",uid_snapshot:order.uid,package_name_snapshot:pkg.name,amount_snapshot:order.amount,manual_review_reason:manualReviewReason}, topup_dispatch_operations:[{id:operationId,sequence_no:1,product_code:"weekly",quantity:1,command_hash:"a".repeat(64),status:operationStatus,failure_reason:failureReason,send_intent_id:sendIntentId}], admin_audit_logs:[{action_type:"TOPUP_DISPATCH_CREATED",created_at:"2026-09-25T00:00:00Z"},{action_type:"TOPUP_DISPATCH_MANUAL_REVIEW",created_at:"2026-09-26T00:00:00Z"}] }[table];
      const result={data,error:null}; const query={ select(){return query},eq(column,value){calls.push(["eq",table,column,value]);return query},limit(){return query},maybeSingle:async()=>result,single:async()=>result,order(){return query},then(resolve,reject){return Promise.resolve(result).then(resolve,reject)} }; return query; },
    async rpc(name,args){ calls.push(["rpc",name,args]); if(name==="admin_prepare_topup_dispatch_retry") return {data:retryError?null:[{operation_id:operationId,previous_send_intent_id:sendIntentId,next_attempt_no:2}],error:retryError}; return {data:createError?null:[{dispatch_id:dispatchId,created:true}],error:createError}; }
  };
  const auth=load("lib/admin-auth.ts",{"@/lib/supabase-admin":{supabaseAdmin:admin}});
  const route=load("app/api/admin/orders/topup-dispatch/route.ts",{
    "next/server":{NextResponse:{json:(b,o)=>Response.json(b,o)}},"@/lib/admin-auth":auth,
    "@/lib/supabase-admin":{supabaseAdmin:admin},"@/lib/topup-dispatch":domain,"@/lib/topup-preview":generator,
  });
  return {
    calls,
    run:(body={orderId:order.id},token="Bearer test")=>route.POST(new Request("https://example.test/api/admin/orders/topup-dispatch",{method:"POST",headers:token?{authorization:token}:{},body:typeof body==="string"?body:JSON.stringify(body)})),
    read:(query=`dispatchId=${dispatchId}`,token="Bearer test")=>route.GET(new Request(`https://example.test/api/admin/orders/topup-dispatch?${query}`,{headers:token?{authorization:token}:{}})),
    retry:(body={dispatchId,retryReason:"Supplier hard failure was verified",confirmedFailureReason:"Topup failed - Limit Over",supplierFailureConfirmed:true},token="Bearer test")=>route.PATCH(new Request("https://example.test/api/admin/orders/topup-dispatch",{method:"PATCH",headers:token?{authorization:token}:{},body:typeof body==="string"?body:JSON.stringify(body)})),
  };
}

for (const body of [{},{orderId:"bad"},{orderId:order.id,uid:"forged"},{orderId:order.id,adminId:actor},{orderId:order.id,packageId:pkg.id},{orderId:order.id,operations:["Ktp forged"]}])
  test("dispatch API rejects client-forged fields: "+JSON.stringify(body),async()=>{const s=setup();assert.equal((await s.run(body)).status,400);assert.ok(!s.calls.some(x=>x[0]==="rpc"));});
test("dispatch API uses authenticated actor and server-derived mapping only",async()=>{const s=setup();const response=await s.run();assert.equal(response.status,200);const call=s.calls.find(x=>x[0]==="rpc");assert.equal(call[1],"admin_create_topup_dispatch_dry_run");assert.equal(call[2].p_admin_id,actor);assert.equal(call[2].p_order_id,order.id);assert.deepEqual(call[2].p_operations.map(x=>[x.productCode,x.quantity]),[["weekly",1]]);assert.ok(!JSON.stringify(call[2]).includes("Ktp "));const body=await response.json();assert.equal(body.dispatch.dryRun,true);});
for (const [label,options,token,status] of [["missing auth",{},null,401],["invalid auth",{invalid:true},"Bearer bad",401],["missing permission",{permissions:[]},"Bearer test",403]])
  test("dispatch authorization: "+label,async()=>assert.equal((await setup(options).run(undefined,token)).status,status));
test("database revalidation errors do not expose dispatch",async()=>{const response=await setup({createError:{code:"55000",message:"secret"}}).run();assert.equal(response.status,409);assert.ok(!("dispatch" in await response.json()));});
test("dispatch read requires authentication and manage_orders permission",async()=>{
  assert.equal((await setup().read(undefined,null)).status,401);
  assert.equal((await setup({permissions:[]}).read()).status,403);
});
test("dispatch read rejects ambiguous or forged identifiers",async()=>{
  for (const query of ["",`dispatchId=bad`,`dispatchId=55555555-5555-4555-8555-555555555555&orderId=${order.id}`,`orderId=${order.id}&extra=true`])
    assert.equal((await setup().read(query)).status,400);
});
test("dispatch read reloads current manual-review state by order id",async()=>{
  const s=setup({dispatchStatus:"manual_review",manualReviewReason:"Pilot stopped safely",operationStatus:"manual_review",failureReason:"Delivery uncertain"});
  const response=await s.read(`orderId=${order.id}`);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.dispatch.status,"manual_review");
  assert.equal(body.dispatch.manualReviewReason,"Pilot stopped safely");
  assert.equal(body.dispatch.failureReason,"Delivery uncertain");
  assert.equal(body.dispatch.operations[0].status,"manual_review");
  assert.equal(body.dispatch.operations[0].failureReason,"Delivery uncertain");
  assert.equal(body.dispatch.auditTrail.at(-1).actionType,"TOPUP_DISPATCH_MANUAL_REVIEW");
  assert.ok(s.calls.some((call)=>call[0]==="eq"&&call[1]==="topup_dispatches"&&call[2]==="order_id"&&call[3]===order.id));
  assert.ok(!s.calls.some((call)=>call[0]==="rpc"));
});
test("dispatch read supports dispatch id without caching",async()=>{
  const s=setup({dispatchStatus:"manual_review",manualReviewReason:"Pilot stopped safely"});
  const response=await s.read();
  assert.equal(response.status,200);
  assert.equal(response.headers.get("cache-control"),"private, no-store");
  assert.ok(s.calls.some((call)=>call[0]==="eq"&&call[1]==="topup_dispatches"&&call[2]==="id"&&call[3]==="55555555-5555-4555-8555-555555555555"));
});

test("admin UI status refresh replaces the stale dispatch snapshot",async()=>{
  const ui=load("components/TopUpPreviewActions.tsx",{
    react:{useRef(){},useState(){}},
    "react/jsx-runtime":{jsx(){},jsxs(){},Fragment:Symbol("Fragment")},
    "@/lib/supabase":{supabase:{}},
    "@/components/TopUpPreviewDialog":{default(){}},
  });
  const calls=[];
  const fresh=await ui.fetchCurrentDispatch("secret-token","55555555-5555-4555-8555-555555555555",async(url,init)=>{
    calls.push([url,init]);
    return Response.json({success:true,dispatch:{status:"manual_review",manualReviewReason:"Pilot stopped safely",operations:[{status:"manual_review",failureReason:"Delivery uncertain"}],auditTrail:[{actionType:"TOPUP_DISPATCH_MANUAL_REVIEW"}]}});
  });
  assert.equal(fresh.status,"manual_review");
  assert.equal(fresh.operations[0].failureReason,"Delivery uncertain");
  assert.match(calls[0][0],/dispatchId=55555555-5555-4555-8555-555555555555/);
  assert.equal(calls[0][1].method,"GET");
  assert.equal(calls[0][1].cache,"no-store");
  assert.equal(calls[0][1].headers.Authorization,"Bearer secret-token");
});

test("dispatch retry requires authentication and manage_orders permission",async()=>{
  assert.equal((await setup().retry(undefined,null)).status,401);
  assert.equal((await setup({permissions:[]}).retry()).status,403);
});
test("dispatch retry requires strict explicit supplier-failure confirmation",async()=>{
  const dispatchId="55555555-5555-4555-8555-555555555555";
  for(const body of [
    {dispatchId,retryReason:"Supplier hard failure was verified",confirmedFailureReason:"Topup failed - Limit Over",supplierFailureConfirmed:false},
    {dispatchId,retryReason:"Supplier hard failure was verified",confirmedFailureReason:"",supplierFailureConfirmed:true},
    {dispatchId,retryReason:"short",confirmedFailureReason:"Limit Over",supplierFailureConfirmed:true},
    {dispatchId,retryReason:"Supplier hard failure was verified",confirmedFailureReason:"Limit Over",supplierFailureConfirmed:true,send:true},
  ]) { const s=setup(); assert.equal((await s.retry(body)).status,400); assert.ok(!s.calls.some((call)=>call[0]==="rpc")); }
});
test("dispatch retry derives actor and only prepares the exact dispatch",async()=>{
  const s=setup({dispatchStatus:"manual_review",operationStatus:"manual_review",sendIntentId:"77777777-7777-4777-8777-777777777777"});
  const response=await s.retry(); assert.equal(response.status,200);
  const call=s.calls.find((entry)=>entry[0]==="rpc");
  assert.equal(call[1],"admin_prepare_topup_dispatch_retry");
  assert.equal(call[2].p_admin_id,actor);
  assert.equal(call[2].p_dispatch_id,"55555555-5555-4555-8555-555555555555");
  assert.equal(call[2].p_supplier_failure_confirmed,true);
  assert.ok(!("p_order_id" in call[2]));
});
test("ineligible or double-click retry is safely rejected",async()=>{
  assert.equal((await setup({retryError:{code:"55000"}}).retry()).status,409);
});
test("admin UI retry helper prepares only and never invokes Telegram",async()=>{
  const ui=load("components/TopUpPreviewActions.tsx",{
    react:{useRef(){},useState(){}},"react/jsx-runtime":{jsx(){},jsxs(){},Fragment:Symbol("Fragment")},
    "@/lib/supabase":{supabase:{}},"@/components/TopUpPreviewDialog":{default(){}},
  });
  const calls=[]; const input={dispatchId:"55555555-5555-4555-8555-555555555555",retryReason:"Supplier hard failure was verified",confirmedFailureReason:"Topup failed - Limit Over",supplierFailureConfirmed:true};
  await ui.prepareTopupRetry("secret-token",input,async(url,init)=>{calls.push([url,init]);return Response.json({success:true,dispatch:{status:"queued"}});});
  assert.equal(calls[0][0],"/api/admin/orders/topup-dispatch"); assert.equal(calls[0][1].method,"PATCH");
  assert.deepEqual(JSON.parse(calls[0][1].body),input); assert.ok(!calls[0][0].includes("telegram"));
});
test("admin UI shows retry eligibility only for the guarded manual-review state",()=>{
  const ui=load("components/TopUpPreviewActions.tsx",{
    react:{useRef(){},useState(){}},"react/jsx-runtime":{jsx(){},jsxs(){},Fragment:Symbol("Fragment")},
    "@/lib/supabase":{supabase:{}},"@/components/TopUpPreviewDialog":{default(){}},
  });
  const pending={id:order.id,status:"pending",payment_method:"wallet"};
  const eligible={status:"manual_review",operations:[{status:"manual_review",hasPreviousSendIntent:true}]};
  assert.equal(ui.isTopupRetryEligible(pending,eligible),true);
  assert.equal(ui.isTopupRetryEligible({...pending,status:"completed"},eligible),false);
  assert.equal(ui.isTopupRetryEligible(pending,{...eligible,status:"queued"}),false);
  assert.equal(ui.isTopupRetryEligible(pending,{...eligible,operations:[{status:"manual_review",hasPreviousSendIntent:false}]}),false);
});
