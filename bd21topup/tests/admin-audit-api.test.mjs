import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const actor='11111111-1111-4111-8111-111111111111',target='22222222-2222-4222-8222-222222222222';
function load(path,imports){
  const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const loaded={exports:{}};
  new Function('require','module','exports',js)(name=>{if(!(name in imports))throw Error('Unexpected import '+name);return imports[name];},loaded,loaded.exports);
  return loaded.exports;
}
const next={'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}}};
test('role API derives actor from verified token and uses only the atomic RPC',async()=>{
  const calls=[];
  const admin={auth:{getUser:async()=>({data:{user:{id:actor}}})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{role:'super_admin'}})})})}),rpc:async(name,args)=>{calls.push({name,args});return {error:null};}};
  const api=load('app/api/admin/role/route.ts',{...next,'@/lib/supabase-admin':{supabaseAdmin:admin}});
  const r=await api.PATCH(new Request('https://example.test',{method:'PATCH',headers:{authorization:'Bearer fixture'},body:JSON.stringify({userId:target,adminId:target,role:'editor',permissions:['manage_orders']})}));
  assert.equal(r.status,200);assert.deepEqual(calls,[{name:'admin_update_role',args:{p_admin_id:actor,p_user_id:target,p_role:'editor',p_permissions:['manage_orders']}}]);
});
for(const role of ['admin','editor','user'])test(role+' rejected before role mutation',async()=>{
  const admin={auth:{getUser:async()=>({data:{user:{id:actor}}})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{role}})})})}),rpc:()=>{throw Error('Unexpected write');}};
  const api=load('app/api/admin/role/route.ts',{...next,'@/lib/supabase-admin':{supabaseAdmin:admin}});
  const r=await api.PATCH(new Request('https://example.test',{method:'PATCH',headers:{authorization:'Bearer fixture'},body:'{}'}));assert.equal(r.status,403);
});
test('bulk complete uses live-schema columns and retains eligible-status restriction',async()=>{
  const seen=[];
  const builder={update:values=>{assert.deepEqual(Object.keys(values),['status']);return builder;},in:(column,values)=>{seen.push([column,values]);return builder;},select:async()=>({data:[{id:target}],error:null})};
  const api=load('app/api/admin/orders/bulk/route.ts',{...next,'@/lib/supabase-admin':{supabaseAdmin:{from:()=>builder},logAdminAction:async()=>{}},'@/lib/admin-auth':{checkUserRole:async()=>({user:{id:actor},role:'super_admin'})},'@/lib/financial-audit':{financialAction:()=>{throw Error('Unexpected financial write');}}});
  const r=await api.POST(new Request('https://example.test',{method:'POST',body:JSON.stringify({orderIds:[target],action:'completed'})}));
  assert.equal(r.status,200);assert.deepEqual(seen,[['id',[target]],['status',['pending','approved','processing']]]);
});


