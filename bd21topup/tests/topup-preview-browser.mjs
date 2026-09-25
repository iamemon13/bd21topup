// Local production build only. Fake auth, intercepted APIs, no real credentials.
// node tests/topup-preview-browser.mjs <agent-browser executable>
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdirSync, openSync, closeSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const binary = process.argv[2] || "agent-browser";
const out = resolve(".next/topup-preview-ui");
mkdirSync(out, { recursive: true });
function browser(...args) {
  const path = resolve(out, "command.json"),
    fd = openSync(path, "w");
  let error;
  try {
    execFileSync(
      binary,
      ["--session", "bd21-topup-fixtures", "--json", ...args],
      { stdio: ["ignore", fd, "ignore"], timeout: 30000 },
    );
  } catch (e) {
    error = e;
  } finally {
    closeSync(fd);
  }
  const raw = readFileSync(path, "utf8");
  if (!raw.trim()) throw error || Error("No browser response");
  const response = JSON.parse(raw);
  assert.equal(response.success, true, response.error);
  return response.data;
}
const evaluate = (script) =>
  browser("eval", "-b", Buffer.from(script).toString("base64")).result;
const order = {
  id: "22222222-2222-4222-8222-222222222222",
  user_id: "33333333-3333-4333-8333-333333333333",
  uid: "123456789",
  player_name: "Preview fixture",
  product_name: "Free Fire UID TopUp",
  package_name: "355 Diamond",
  amount: 237,
  payment_method: "wallet",
  receiver_number: "Wallet Payment",
  transaction_id: "WALLET-FIXTURE",
  status: "pending",
  created_at: "2026-09-25T00:00:00Z",
  cancelled_at: null,
  topupMappingState: "mapped",
};
const preview = {
  success: true,
  orderId: order.id,
  uid: order.uid,
  packageId: "871e33b3-01b4-4f91-9c95-3d5cf03f45e6",
  packageName: order.package_name,
  category: "uid_bd",
  mappingVersion: "bd21-kaium-v1",
  generatedAt: order.created_at,
  operations: [
    { index: 1, command: "Ktp 123456789 240" },
    { index: 2, command: "Ktp 123456789 115" },
  ],
};
try {
  browser("open", "http://localhost:3100/login");
  browser("network", "route", "**/*.supabase.co/**", "--abort");
  browser(
    "network",
    "route",
    "**/api/admin/orders",
    "--body",
    JSON.stringify({
      success: true,
      orders: [
        order,
        {
          ...order,
          id: "55555555-5555-4555-8555-555555555555",
          payment_method: "bkash",
        },
        {
          ...order,
          id: "66666666-6666-4666-8666-666666666666",
          topupMappingState: "unmapped",
        },
      ],
    }),
  );
  browser("network", "route", "**/api/**", "--abort");
  const session = {
    access_token: "local-fixture-token",
    refresh_token: "local-fixture-refresh",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: "bearer",
    user: { id: order.user_id, aud: "authenticated", role: "authenticated" },
  };
  evaluate(
    `document.cookie=${JSON.stringify("sb-cnjkxbosjdahbyjtqbyj-auth-token=base64-" + Buffer.from(JSON.stringify(session)).toString("base64url") + "; Path=/; SameSite=Lax")}`,
  );
  for (const width of [390, 1280]) {
    browser("set", "viewport", String(width), "900");
    browser("open", "http://localhost:3100/admin/orders");
    browser("wait", "--text", "Top Up Preview");
    assert.ok(
      evaluate("document.body.innerText").includes("Manual / Unmapped"),
    );
    assert.ok(
      evaluate("document.body.innerText").includes(
        "payment verification is not available",
      ),
    );
    evaluate(`window.__previewCalls=[];window.__copied=[];window.__copyFails=false;
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(window.__copyFails)throw Error('denied');window.__copied.push(text);}}});
      const originalFetch=window.fetch.bind(window);window.fetch=(url,options)=>{
        if(url==='/api/admin/orders/topup-preview'){window.__previewCalls.push(JSON.parse(options.body));return new Promise(resolve=>{window.__releasePreview=(body,status=200)=>resolve(new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}}));});}
        return originalFetch(url,options);
      };`);
    evaluate(
      "Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Top Up Preview').scrollIntoView({block:'center'})",
    );
    browser("find", "role", "button", "click", "--name", "Top Up Preview");
    browser("wait", "--text", "Checking eligibility");
    evaluate(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Checking eligibility')).click()`,
    );
    assert.equal(evaluate("window.__previewCalls.length"), 1);
    assert.deepEqual(evaluate("window.__previewCalls[0]"), {
      orderId: order.id,
    });
    evaluate(`window.__releasePreview(${JSON.stringify(preview)})`);
    browser("wait", "dialog[open]");
    const text = evaluate('document.querySelector("dialog").innerText');
    assert.ok(
      text.includes("Preview only — no command has been sent to the supplier."),
    );
    assert.ok(!/Mark Completed|Auto Top Up|Telegram Send/.test(text));
    assert.deepEqual(
      evaluate(
        'Array.from(document.querySelectorAll("dialog pre")).map(e=>e.textContent)',
      ),
      preview.operations.map((o) => o.command),
    );
    browser("find", "role", "button", "click", "--name", "Copy command 1");
    browser("wait", "--text", "Command 1 copied.");
    browser("find", "role", "button", "click", "--name", "Copy All");
    browser("wait", "--text", "All commands copied.");
    assert.deepEqual(evaluate("window.__copied"), [
      "Ktp 123456789 240",
      "Ktp 123456789 240\nKtp 123456789 115",
    ]);
    evaluate("window.__copyFails=true");
    browser("find", "role", "button", "click", "--name", "Copy command 2");
    browser("wait", "--text", "Copy failed.");
    assert.equal(
      evaluate("document.documentElement.scrollWidth<=innerWidth"),
      true,
    );
    assert.equal(
      evaluate(
        'document.querySelector("dialog").scrollWidth<=document.querySelector("dialog").clientWidth',
      ),
      true,
    );
    browser("screenshot", "--full", `${out}/${width}-preview.png`);
    browser("find", "role", "button", "click", "--name", "Close", "--exact");
    assert.equal(
      evaluate('document.querySelectorAll("dialog[open]").length'),
      0,
    );
    evaluate(
      "Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Top Up Preview').scrollIntoView({block:'center'})",
    );
    browser("find", "role", "button", "click", "--name", "Top Up Preview");
    browser("wait", "--text", "Checking eligibility");
    evaluate(
      `window.__releasePreview({success:false,code:'REFUND_PRESENT',error:'A refund exists. Manual review required.'},409)`,
    );
    browser("wait", "--text", "A refund exists.");
    assert.equal(
      evaluate('document.querySelectorAll("dialog[open]").length'),
      0,
    );
  }
  assert.ok(!browser("errors").errors?.length);
  console.log(
    "PASS: mobile/desktop dialog, ordered commands, individual/all copy, visible clipboard/API errors, duplicate request guard, manual states, preview warning.",
  );
} catch (error) {
  console.error(JSON.stringify(browser("snapshot"), null, 2));
  throw error;
} finally {
  browser("close");
}
