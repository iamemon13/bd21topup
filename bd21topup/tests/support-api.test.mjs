import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the actual TypeScript route modules with an in-memory Supabase adapter.
// No application credentials, network, or production data are used by these tests.
function moduleFrom(path, imports = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((name) => {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

const support = moduleFrom('lib/support.ts');
const id = 'BD21-ORD-8A4B7C2D9E1F';
const otherId = 'BD21-WDR-9A4B7C2D9E1F';

function app({ token = 'valid', role = 'editor', permissions = ['manage_orders'], failure, extraCases = 0, schemaError, columnError } = {}) {
  const reads = [];
  const tables = {
    support_cases: [
      { id: 'case-own', user_id: 'owner', case_type: 'ORD', order_id: 'order-own', support_id: id, status: 'open', reason: 'কারণ' },
      { id: 'case-other', user_id: 'other', case_type: 'WDR', withdrawal_id: 'withdrawal-other', support_id: otherId, status: 'open', reason: 'private' },
      { id: 'case-add', user_id: 'owner', case_type: 'ADD', add_money_request_id: 'add-own', support_id: 'BD21-ADD-8A4B7C2D9E1F', status: 'open', reason: 'অ্যাড মানি' },
      { id: 'case-wdr', user_id: 'owner', case_type: 'WDR', withdrawal_id: 'withdrawal-own', support_id: 'BD21-WDR-8A4B7C2D9E1F', status: 'open', reason: 'উত্তোলন' },
    ],
    orders: [{ id: 'order-own', user_id: 'owner', status: 'cancelled', amount: 10 }],
    admin_roles: role ? [{ user_id: 'owner', role, permissions }] : [],
    add_money_requests: [{ id: 'add-own', user_id: 'owner', status: 'rejected', amount: 10 }],
    withdrawals: [{ id: 'withdrawal-own', user_id: 'owner', status: 'rejected', amount: 100 }],
    wallet_transactions: [],
    notifications: [{ id: 'notification-own', user_id: 'owner', support_case_id: 'case-own' },
      { id: 'foreign-link', user_id: 'owner', support_case_id: 'case-other' }],
  };
  const supabaseAdmin = {
    auth: { getUser: async (received) => ({ data: { user: received === token && received === 'valid' ? { id: 'owner' } : null }, error: null }) },
    from(table) {
      const filters = [];
      let single = false;
      let range = [0, Infinity];
      let selection = '';
      const query = {
        select(columns) { selection = columns; return query; },
        eq(column, value) { filters.push((row) => row[column] === value); return query; },
        in(column, values) { filters.push((row) => values.includes(row[column])); return query; },
        order() { return query; },
        range(start, end) { range = [start, end + 1]; return query; },
        maybeSingle() { single = true; return query; },
        then(resolve, reject) {
          reads.push(table);
          const rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row))).slice(...range);
          const error = failure === table ? { message: 'injected failure' } :
            table === 'support_cases' ? schemaError :
            table === 'notifications' && selection.includes('support_case_id') ? columnError : null;
          return Promise.resolve({ data: single ? rows[0] ?? null : rows, error }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  for (let i = 0; i < extraCases; i++) tables.support_cases.push({
    id:`extra-${i}`,user_id:'owner',case_type:'ORD',order_id:`order-${i}`,
    support_id:`BD21-ORD-${i.toString(16).toUpperCase().padStart(12,'0')}`,status:'open',reason:'test',
  });
  const imports = {
    'next/server': { NextResponse: Response },
    '@/lib/supabase-admin': { supabaseAdmin },
    '@/lib/support': support,
  };
  imports['@/lib/admin-auth'] = moduleFrom('lib/admin-auth.ts', imports);
  imports['@/lib/support-cases'] = moduleFrom('lib/support-cases.ts', imports);
  return { reads, loadCases: imports['@/lib/support-cases'].loadUserSupportCases, route: (name) => moduleFrom(`app/api/${name}/route.ts`, imports) };
}

function request(path = '', token = 'valid') {
  return new Request(`http://localhost/api/${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

test('Telegram contact includes only the reference and a receipt prompt; bot payload is valid', () => {
  const chat = new URL(support.supportContactUrl(id));
  assert.equal(chat.origin + chat.pathname, 'https://t.me/BD21Support');
  assert.match(chat.searchParams.get('text'), /BD21-ORD-8A4B7C2D9E1F/);
  assert.match(chat.searchParams.get('text'), /রসিদ বা স্ক্রিনশট/);
  assert.equal(new URL(support.supportContactUrl(id,'ExampleBot','bot')).searchParams.get('start'), id);
  for (const username of ['javascript:alert(1)', 'evil.test/path', 'BD21Support?text=bad', '@support', '', 'BD21Support\n', 'BD21Support\r\n']) {
    assert.equal(support.supportContactUrl(id, username), null);
  }
  assert.equal(support.supportContactUrl('forged'), null);
  assert.equal(support.supportContactUrl(`${id}\n`), null);
  assert.equal(support.supportContactUrl(id, 'BD21Support', 'unknown'), null);
});

test('history and notifications require verified bearer tokens and derive ownership from getUser', async () => {
  for (const name of ['orders/my','transactions','notifications']) {
    for (const token of ['', 'expired']) {
      const env = app();
      assert.equal((await env.route(name).GET(request(name, token))).status, 401);
      assert.deepEqual(env.reads, []);
    }
    const env = app();
    const response = await env.route(name).GET(request(`${name}?userId=other&supportId=${otherId}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('Vary'), 'Authorization');
    const text = await response.text();
    assert.ok(text.includes(id));
    assert.ok(!text.includes(otherId));
    assert.ok(!text.includes('private'));
    assert.ok(!text.includes('case-other'));
    assert.ok(!text.includes('case-own'));
  }
});

test('transaction mappings distinguish order/add-money/withdrawal sources', async () => {
  const body = await (await app().route('transactions').GET(request())).json();
  assert.equal(body.transactions[0].support.supportId, id);
  assert.equal(body.walletTransactions.find((r) => r.id === 'add-own').support.supportId, 'BD21-ADD-8A4B7C2D9E1F');
  assert.equal(body.walletTransactions.find((r) => r.id === 'withdrawal-own').support.supportId, 'BD21-WDR-8A4B7C2D9E1F');
});

test('admin case lookup rejects insufficient permission before touching cases', async () => {
  for (const options of [{ role: null }, { role: 'user' }, { permissions: [] }, { permissions: ['manage_add_money'] }]) {
    const env = app(options);
    const response = await env.route('admin/support-cases').GET(request(`admin/support-cases?supportId=${id}`));
    assert.equal(response.status, 403);
    assert.ok(!env.reads.includes('support_cases'));
  }
  for (const token of ['', 'expired']) {
    const env = app();
    assert.equal((await env.route('admin/support-cases').GET(request(`admin/support-cases?supportId=${id}`,token))).status,401);
    assert.ok(!env.reads.includes('support_cases'));
  }
});

test('admin lookup allows matching permissions and super admin, returns minimal result and no-store', async () => {
  for (const options of [{}, { role: 'super_admin', permissions: [] }]) {
    const response = await app(options).route('admin/support-cases').GET(request(`admin/support-cases?supportId=${id}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    const body = await response.json();
    assert.equal(body.support.supportId,id);
    assert.equal(body.operationId,'order-own');
    assert.ok(!('user_id' in body));
  }
  for (const [prefix,permission] of [['ADD','manage_add_money'],['WDR','manage_withdrawals']]) {
    const response = await app({ permissions:[permission] }).route('admin/support-cases').GET(request(`admin/support-cases?supportId=BD21-${prefix}-8A4B7C2D9E1F`));
    assert.equal(response.status,200);
  }
});

test('malformed/missing references and missing cases return 400/404', async () => {
  for (const value of ['', id.toLowerCase(), `${id}' OR 1=1`, `${id}\n`, `${id}\r\n`]) {
    const env = app();
    const response = await env.route('admin/support-cases').GET(request(`admin/support-cases?supportId=${encodeURIComponent(value)}`));
    assert.equal(response.status,400);
    assert.deepEqual(env.reads,[]);
  }
  assert.equal((await app().route('admin/support-cases').GET(request('admin/support-cases?supportId=BD21-ORD-AAAAAAAAAAAA'))).status,404);
});

test('admin error responses cannot be cached across credentials', async (t) => {
  t.mock.method(console,'error',()=>{});
  for (const [options, reference, token, status] of [
    [{}, 'invalid', 'valid', 400],
    [{}, id, 'expired', 401],
    [{ permissions:[] }, id, 'valid', 403],
    [{}, 'BD21-ORD-AAAAAAAAAAAA', 'valid', 404],
    [{ failure:'support_cases' }, id, 'valid', 500],
  ]) {
    const response = await app(options).route('admin/support-cases').GET(request(`admin/support-cases?supportId=${reference}`,token));
    assert.equal(response.status,status);
    assert.equal(response.headers.get('Cache-Control'),'private, no-store');
    assert.equal(response.headers.get('Vary'),'Authorization');
  }
});

test('new support routes expose no mutation handler', () => {
  assert.deepEqual(Object.keys(app().route('admin/support-cases')), ['GET']);
});

test('support lookup pages past the PostgREST row limit without losing old cases', async () => {
  const env = app({ extraCases:1100 });
  const cases = await env.loadCases('owner');
  assert.equal(cases.byId.size,1103);
  assert.ok(cases.byOperation.has('ORD:order-1099'));
  assert.equal(env.reads.filter((table)=>table==='support_cases').length,3);
  assert.ok(!cases.byId.has('case-other'));
});

test('case query failures return an error instead of incomplete or cross-user case data', async (t) => {
  t.mock.method(console,'error',()=>{});
  for (const route of ['orders/my','transactions','notifications','admin/support-cases']) {
    const response = await app({ failure:'support_cases' }).route(route).GET(request(`${route}?supportId=${id}`));
    assert.equal(response.status,500);
    const body = await response.text();
    assert.ok(!body.includes(id));
    assert.ok(!body.includes('private'));
  }
});

test('pre-migration history remains available without fabricated support IDs', async () => {
  for (const schemaError of [
    {code:'42P01',message:'relation "public.support_cases" does not exist'},
    {code:'PGRST205',message:"Could not find the table 'public.support_cases' in the schema cache"},
  ]) {
    for (const name of ['orders/my','transactions','notifications']) {
      const response = await app({schemaError}).route(name).GET(request(`${name}?userId=other`));
      assert.equal(response.status,200);
      const body = await response.json();
      assert.equal(body.supportCasesAvailable,false);
      const items = body.orders ?? body.transactions ?? body.notifications;
      assert.ok(items.length);
      assert.ok(items.every(item=>item.support===null));
      assert.ok(!JSON.stringify(body).includes(otherId));
    }
    assert.equal((await app({schemaError}).route('admin/support-cases').GET(request(`?supportId=${id}`))).status,503);
  }
});

test('missing notification support column retries only the owner-scoped legacy projection', async () => {
  for (const columnError of [
    {code:'42703',message:'column notifications.support_case_id does not exist'},
    {code:'PGRST204',message:"Could not find the 'support_case_id' column of 'notifications' in the schema cache"},
  ]) {
    const env = app({columnError});
    const response = await env.route('notifications').GET(request('?userId=other'));
    assert.equal(response.status,200);
    const body = await response.json();
    assert.equal(body.supportCasesAvailable,false);
    assert.equal(body.notifications[0].id,'notification-own');
    assert.ok(body.notifications.every(item=>item.support===null));
    assert.ok(!JSON.stringify(body).includes('support_case_id'));
    assert.deepEqual(env.reads,['notifications','notifications']);
  }
});

test('schema compatibility never masks permission failures or unrelated missing schema', async (t) => {
  t.mock.method(console,'error',()=>{});
  for (const schemaError of [
    {code:'42501',message:'permission denied for table support_cases'},
    {code:'42P01',message:'relation "auth.users" does not exist'},
    {code:'42703',message:'column support_cases.reason does not exist'},
  ]) assert.equal((await app({schemaError}).route('orders/my').GET(request())).status,500);
  const env=app({columnError:{code:'42501',message:'permission denied for notifications.support_case_id'}});
  assert.equal((await env.route('notifications').GET(request())).status,500);
  assert.deepEqual(env.reads,['notifications']);
});
