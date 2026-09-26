import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { load } from "./topup-test-helpers.mjs";

const configModule=load("worker/telegram-config.ts");
const runnerModule=load("worker/runner.ts",{"node:crypto":crypto,"./telegram-transport":{}});
const workerModule=load("worker/telegram-auto-worker.ts",{
  "./telegram-transport":{},"./runner":{},"./runner.ts":runnerModule,"./telegram-config.ts":configModule,
});

const env={
  TELEGRAM_TRANSPORT_MODE:"real",TELEGRAM_API_ID:"12345",TELEGRAM_API_HASH:"fixture-secret",
  TELEGRAM_SESSION_FILE:"/private/fixture.session",TELEGRAM_SUPPLIER_USERNAME:"fixed_supplier",
  TELEGRAM_SUPPLIER_ENTITY_ID:"99",TELEGRAM_REAL_SEND_ENABLED:"true",TELEGRAM_AUTO_WORKER_ENABLED:"true",
};
const operation={operation_id:"66666666-6666-4666-8666-666666666666",
  dispatch_id:"55555555-5555-4555-8555-555555555555",sequence_no:1,product_code:"25",quantity:1,
  uid_snapshot:"123456789",command_hash:"a".repeat(64)};

function queueHarness(outcome) {
  let status="queued",sends=0;
  const calls=[];
  const queue={
    claim:async (...args)=>{calls.push(["claim",...args]);if(status!=="queued")return null;status="processing";return operation;},
    startSendIntent:async (...args)=>{calls.push(["intent",...args]);status="send_intent";},
    finish:async (...args)=>{calls.push(["finish",...args]);status=args[3]==="uncertain"?"manual_review":args[3];},
    completeVerifiedSupplierReply:async (...args)=>{calls.push(["complete",...args]);status="completed";return true;},
    recordSupplierManualReview:async (...args)=>{calls.push(["review",...args]);status="manual_review";return true;},
  };
  const transport={sendOperation:async()=>{sends+=1;return outcome;}};
  return {queue,transport,calls,status:()=>status,sends:()=>sends};
}

async function runUntilResult(harness, workerEnv=env) {
  const controller=new AbortController();
  const result=await workerModule.runAutomaticTelegramWorker({env:workerEnv,workerId:"auto-worker",queue:harness.queue,
    signal:controller.signal,verifySupplier:async()=>undefined,createTransport:async()=>harness.transport,idleDelayMs:1,onResult:()=>controller.abort()});
  return result;
}

test("auto worker CLI module graph loads without configuration or network",()=>{
  const result=spawnSync(process.execPath,["--experimental-transform-types","worker/telegram-auto-worker-cli.ts","--check-module-load"],{
    cwd:new URL("..",import.meta.url),encoding:"utf8",env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot},
  });
  assert.equal(result.status,0,result.stderr); assert.match(result.stdout,/^TELEGRAM_AUTO_WORKER_CLI_MODULES_OK\s*$/);
});

test("disabled or incomplete environment starts no transport and sends zero messages",async()=>{
  for(const changed of [{...env,TELEGRAM_AUTO_WORKER_ENABLED:"false"},{...env,TELEGRAM_AUTO_WORKER_ENABLED:undefined},{...env,TELEGRAM_REAL_SEND_ENABLED:"false"}]){
    let claims=0,transports=0;
    await assert.rejects(workerModule.runAutomaticTelegramWorker({env:changed,workerId:"auto-worker",
      queue:{claim:async()=>{claims+=1;}},signal:new AbortController().signal,
      verifySupplier:async()=>{throw new Error("must not verify");},
      createTransport:async()=>{transports+=1;return {sendOperation:async()=>{throw new Error("must not send");}};}}),/required|disabled/);
    assert.equal(claims,0); assert.equal(transports,0);
  }
});

test("one queued operation is claimed once and verified success uses atomic completion",async()=>{
  const response={supplierEntityId:"99",sentMessageId:"42",replyMessageId:"43",replyToMessageId:"42",
    uid:"123456789",productCode:"25",quantity:1};
  const h=queueHarness({kind:"verified_success",dryRun:false,resultHash:"b".repeat(64),summary:"SUPPLIER_VERIFIED_SUCCESS",supplierResponse:response});
  const result=await runUntilResult(h);
  assert.equal(result.processed,1); assert.equal(h.sends(),1); assert.equal(h.status(),"completed");
  assert.equal(h.calls.filter((call)=>call[0]==="intent").length,1);
  assert.equal(h.calls.filter((call)=>call[0]==="complete").length,1);
});

test("timeout becomes manual_review and is not automatically retried after restart",async()=>{
  const h=queueHarness({kind:"uncertain",dryRun:false,resultHash:"c".repeat(64),summary:"SUPPLIER_REPLY_TIMEOUT"});
  await runUntilResult(h);
  assert.equal(h.status(),"manual_review"); assert.equal(h.sends(),1);
  const restartController=new AbortController();
  const restarted=await workerModule.runAutomaticTelegramWorker({env,workerId:"auto-worker-restart",queue:h.queue,
    signal:restartController.signal,verifySupplier:async()=>undefined,createTransport:async()=>h.transport,idleDelayMs:1,onResult:()=>restartController.abort()});
  assert.equal(restarted.processed,0); assert.equal(h.sends(),1);
});

test("pinned supplier mismatch refuses startup before claim or transport",async()=>{
  let claims=0,transports=0;
  await assert.rejects(workerModule.runAutomaticTelegramWorker({env,workerId:"auto-worker",
    queue:{claim:async()=>{claims+=1;}},signal:new AbortController().signal,
    verifySupplier:async()=>{throw new Error("Configured Telegram supplier identity did not match.");},
    createTransport:async()=>{transports+=1;return {sendOperation:async()=>{throw new Error("must not send");}};}}),/identity did not match/);
  assert.equal(claims,0); assert.equal(transports,0);
});

test("automatic worker has no financial mutation boundary and ships disabled",()=>{
  const source=readFileSync(new URL("../worker/telegram-auto-worker.ts",import.meta.url),"utf8").toLowerCase();
  for(const boundary of ["wallet","refund","payment","orders"]) assert.ok(!source.includes(boundary));
  const template=readFileSync(new URL("../deploy/telegram-worker/telegram-worker.env.template",import.meta.url),"utf8");
  assert.match(template,/^TELEGRAM_AUTO_WORKER_ENABLED=false$/m);
  const service=readFileSync(new URL("../deploy/telegram-worker/bd21topup-telegram-worker.service",import.meta.url),"utf8");
  assert.match(service,/npm run telegram:worker/); assert.match(service,/Restart=on-failure/);
});
