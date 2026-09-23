import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(path,imports){
 const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 new Function('require','module','exports',js)(name=>name in imports?imports[name]:require(name),module,module.exports);
 return module.exports;
}
const response={NextResponse:{json:(body,options)=>Response.json(body,options)}};
test('limiter namespaces user/IP/action, hashes identities and enforces Vercel IP bucket',async()=>{
 const old=process.env.VERCEL;process.env.VERCEL='1';
 try{
 const calls=[];
 const api=load('lib/financial-rate-limit.ts',{'next/server':response,'@/lib/supabase-admin':{supabaseAdmin:{rpc:async(name,args)=>{calls.push([name,args]);return {data:true,error:null};}}}});
 const request=new Request('https://example.test',{headers:{'x-forwarded-for':'203.0.113.1'}});
 assert.equal(await api.checkFinancialRateLimit(request,'user-a','withdraw'),null);
 assert.equal(calls.length,2);
 assert.equal(calls[0][1].p_max_requests,5);
 assert.equal(calls[1][1].p_max_requests,100);
 assert.notEqual(calls[0][1].p_ip,calls[1][1].p_ip);
 for(const [,args] of calls)assert.match(args.p_ip,/^finance:[a-f0-9]{64}$/);
 await api.checkFinancialRateLimit(request,'user-a','orders');
 assert.notEqual(calls[0][1].p_ip,calls[2][1].p_ip);
 }finally{if(old===undefined)delete process.env.VERCEL;else process.env.VERCEL=old;}
});
for(const [data,error,status] of [[false,null,429],[null,{message:'unavailable'},503],[null,null,503]]){
 test('limiter returns '+status+' safely for '+JSON.stringify([data,error]),async()=>{
 const api=load('lib/financial-rate-limit.ts',{'next/server':response,'@/lib/supabase-admin':{supabaseAdmin:{rpc:async()=>({data,error})}}});
 const result=await api.checkFinancialRateLimit(new Request('https://example.test'),'user','orders');
 assert.equal(result.status,status);assert.equal(result.headers.get('Retry-After'),'60');
 });
}
for(const route of ['orders','wallet-pay','add-money','withdraw'])test(route+' blocks before financial writes and uses authenticated identity',async()=>{
 const seen=[];
 const supabaseAdmin={auth:{getUser:async token=>({data:{user:token==='valid'?{id:'verified-user'}:null},error:null})},from:()=>{throw new Error('Unexpected financial access');},rpc:()=>{throw new Error('Unexpected mutation');}};
 const config=load('lib/payment-config.ts',{});
 const api=load('app/api/'+route+'/route.ts',{
 'next/server':response,'@/lib/supabase-admin':{supabaseAdmin},'@/lib/payment-config':config,
 '@/lib/financial-rate-limit':{checkFinancialRateLimit:async(req,userId,action)=>{seen.push({userId,action});return Response.json({error:'limited'},{status:429});}},
 });
 const blocked=await api.POST(new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer valid'},body:'{"userId":"attacker"}'}));
 assert.equal(blocked.status,429);assert.deepEqual(seen,[{userId:'verified-user',action:route}]);
 const unauth=await api.POST(new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer invalid'}}));
 assert.equal(unauth.status,401);assert.equal(seen.length,1);
});
