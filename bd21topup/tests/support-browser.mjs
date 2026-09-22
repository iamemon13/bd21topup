// Run against a local production build: node tests/support-browser.mjs <agent-browser executable>
// All API calls are intercepted. Fake auth cookies exist only in an isolated browser session.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdirSync, openSync, closeSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const binary = process.argv[2] || 'agent-browser';
const origin = 'http://localhost:3100';
const out = resolve('.next/support-ui');
mkdirSync(out, { recursive: true });
function browser(...args) {
  // On Windows the background browser can inherit stdout pipes; use a file so
  // the CLI's completed command does not wait for the daemon to close that pipe.
  const commandOutput = resolve(out, 'command.json');
  const outputFile = openSync(commandOutput, 'w');
  let commandError;
  try {
    execFileSync(binary, ['--session','bd21-support-fixtures','--json',...args], {
      stdio:['ignore',outputFile,'ignore'],timeout:30000,
    });
  } catch (error) { commandError = error; }
  finally { closeSync(outputFile); }
  const raw = readFileSync(commandOutput,'utf8');
  if (!raw.trim()) throw commandError || new Error('No browser response');
  const response = JSON.parse(raw.trim());
  assert.equal(response.success,true,response.error);
  return response.data;
}
const evaluate = (script) => browser('eval','-b',Buffer.from(script).toString('base64')).result;
const mock = (path, body) => browser('network','route',`**${path}`, '--body',JSON.stringify(body));
const date = '2026-09-22T10:00:00Z';
const support = (type) => ({ supportId:`BD21-${type}-8A4B7C2D9E1F`,status:'open',reason:'তথ্য মেলেনি। রসিদ বা স্ক্রিনশট পাঠিয়ে সহায়তা নিন।',contactUrl:`https://t.me/BD21Support?text=${encodeURIComponent(`Support ID: BD21-${type}-8A4B7C2D9E1F`)}` });
const order = { id:'11111111-1111-4111-8111-111111111111',uid:'123456789',player_name:'Test Player',product_name:'Free Fire UID TopUp',package_name:'100 Diamonds',amount:100,payment_method:'bkash',transaction_id:'TEST-12345',status:'rejected',created_at:date,support:support('ORD') };

try {
  browser('open',`${origin}/admin/support-cases`);
  // Catch-all prevents any unmocked application API request reaching the server.
  browser('network','route','**/*.supabase.co/**','--abort');
  mock('/api/orders/my',{success:true,orders:[order]});
  mock('/api/transactions',{success:true,summary:{totalTransactions:1,completedSpend:0,openClaims:0,walletTransactions:2},transactions:[{id:order.id,type:'order_payment',orderId:order.id,uid:order.uid,playerName:order.player_name,productName:order.product_name,packageName:order.package_name,amount:100,paymentMethod:'bkash',transactionId:'TEST-12345',status:'rejected',createdAt:date,support:support('ORD')}],walletTransactions:['ADD','WDR'].map((type)=>({id:type,type:'wallet_transaction',transactionType:type==='ADD'?'add_money_rejected':'withdrawal',direction:type==='ADD'?'credit':'debit',amount:100,balanceAfter:1000,referenceId:'TEST',description:'Test rejected operation',createdAt:date,status:'rejected',support:support(type)}))});
  mock('/api/account',{success:true,account:{id:order.id,email:'test@example.invalid',fullName:'Test User',phone:null,avatarUrl:null,verified:true,walletBalance:1000,createdAt:date},stats:{orders:1,completedOrders:0,totalSpend:0},rank:{current:'Bronze',level:1,progress:0,next:'Silver',amountToNext:1000,journey:[]}});
  mock('/api/notifications',{success:true,notifications:['ORD','ADD','WDR'].map((type)=>({id:type,title:'সাপোর্টে যোগাযোগ করুন',message:'রসিদ বা স্ক্রিনশট পাঠান।',type:'support_case',is_read:false,created_at:date,support:support(type)}))});
  mock('/api/notifications/read',{success:true});
  mock('/api/admin/support-cases?*',{support:support('ORD'),caseType:'ORD',operationId:order.id,createdAt:date});
  browser('network','route','**/api/**','--abort');
  const session = { access_token:'local-fixture-token',refresh_token:'local-fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:order.id,aud:'authenticated',role:'authenticated',email:'test@example.invalid'} };
  // Use the public project's cookie name; no real credentials are read.
  const cookie = `sb-cnjkxbosjdahbyjtqbyj-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}; Path=/; SameSite=Lax`;
  evaluate(`document.cookie=${JSON.stringify(cookie)}`);

  for (const width of [390,1280]) {
    browser('set','viewport',String(width),'900');
    for (const path of ['/orders','/transactions','/account','/admin/support-cases']) {
      browser('open',origin+path);
      if (path === '/account') {
        browser('wait','button[aria-label="Notifications"]');
        browser('click','button[aria-label="Notifications"]');
      }
      if (path === '/admin/support-cases') {
        browser('fill','#support-id',support('ORD').supportId);
        browser('click','button[type="submit"], form button');
        browser('wait','section[aria-label="Support Case"]');
      } else {
        browser('wait','a[href^="https://t.me/BD21Support?"]');
        if (path === '/orders' || path === '/transactions') {
          evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().startsWith('Rejected')).click()`);
          browser('wait','a[href^="https://t.me/BD21Support?"]');
          assert.ok(evaluate('document.body.innerText').includes(support('ORD').supportId));
        }
        const links = evaluate(`Array.from(document.querySelectorAll('a[href^="https://t.me/BD21Support?"]')).map(a=>a.href)`);
        assert.ok(links.some((href)=>decodeURIComponent(href).includes('BD21-ORD-')));
        assert.equal(evaluate('document.querySelectorAll("button button, button a").length'),0);
      }
      assert.equal(evaluate('document.documentElement.scrollWidth <= innerWidth'),true,`${path} overflows at ${width}`);
      browser('screenshot','--full',`${out}/${width}-${path.replaceAll('/','-')}.png`);
      if (path === '/orders') {
        browser('find','role','button','click','--name','কপি করুন');
        browser('wait','[role="status"]');
        assert.equal(evaluate(`document.querySelector('[role="status"]').textContent`),'Support ID কপি হয়েছে।');
      }
      if (path === '/transactions') {
        evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Wallet History')).click()`);
        browser('wait','a[href*="BD21-ADD-"]');
        assert.ok(evaluate('document.body.innerText').includes(support('WDR').supportId));
        assert.equal(evaluate('document.documentElement.scrollWidth <= innerWidth'),true);
        browser('screenshot','--full',`${out}/${width}-wallet.png`);
      }
    }
  }
  const errors = browser('errors');
  assert.ok(!errors.errors?.length,JSON.stringify(errors));
  console.log('PASS: mobile/desktop histories, notifications, copy feedback, Telegram IDs, admin lookup and no horizontal overflow.');
  console.log(`Screenshots: ${out}`);
} catch (error) {
  console.error('UI failure:',error.message);
  console.error(JSON.stringify(browser('snapshot'),null,2));
  console.error(JSON.stringify(browser('console'),null,2));
  browser('screenshot','--full',`${out}/failure.png`);
  throw error;
} finally { browser('close'); }
