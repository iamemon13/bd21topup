import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260926090000_harden_withdrawal_creation_and_order_name_snapshots.sql");
const snapshotMigration = read("supabase/migrations/20260926090100_preserve_order_account_name_snapshots.sql");

test("withdrawal migration preserves legacy rows and rejects invalid new methods before any mutation", async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, wallet_balance numeric, updated_at timestamptz);
    CREATE TABLE public.withdrawals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, amount numeric, method text, account_number text, status text, balance_after numeric,
      CONSTRAINT withdrawals_method_check CHECK(lower(trim(method)) IN ('bkash','nagad','rocket','upay')));
    CREATE TABLE public.wallet_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, direction text, amount numeric, balance_after numeric, reference_id uuid, description text);
    CREATE TABLE public.orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, account_name text);
    INSERT INTO public.profiles VALUES ('11111111-1111-4111-8111-111111111111',1000,now());
    INSERT INTO public.withdrawals(user_id,amount,method,account_number,status,balance_after) VALUES
      ('11111111-1111-4111-8111-111111111111',100,'rocket','01700000000','approved',900),
      ('11111111-1111-4111-8111-111111111111',100,'upay','01700000000','rejected',1000);
    CREATE FUNCTION public.update_orders_account_name() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE public.orders SET account_name=NEW.id::text WHERE user_id=NEW.id; RETURN NEW; END $$;
    CREATE TRIGGER profile_name_change_trigger AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_orders_account_name();
  `);
  await db.exec(migration);
  await db.exec(snapshotMigration);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM public.withdrawals WHERE method IN ('rocket','upay')")).rows[0].count, 2);
  for (const method of ["rocket", "upay", "unknown", ""]) {
    await assert.rejects(db.query("SELECT public.process_withdrawal($1,100,$2,'01700000000')", ["11111111-1111-4111-8111-111111111111", method]), /Invalid withdrawal method/);
    assert.equal(Number((await db.query("SELECT wallet_balance FROM public.profiles")).rows[0].wallet_balance), 1000);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM public.withdrawals")).rows[0].count, 2);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM public.wallet_transactions")).rows[0].count, 0);
  }
  for (const method of ["bkash", "nagad"]) {
    await db.query("SELECT public.process_withdrawal($1,100,$2,'01700000000')", ["11111111-1111-4111-8111-111111111111", method]);
  }
  assert.equal((await db.query("SELECT count(*)::int AS count FROM public.wallet_transactions")).rows[0].count, 2);
  await db.close();
});

test("account-name snapshot and withdrawal access changes are explicit and non-destructive", () => {
  const accountRoute = read("app/api/account/route.ts");
  const orderRoute = read("app/api/orders/route.ts");
  const withdrawRoute = read("app/api/withdraw/route.ts");
  assert.match(orderRoute, /account_name:\s*accountName/);
  assert.doesNotMatch(accountRoute, /from\("orders"\)\s*\.update/);
  assert.match(snapshotMigration, /DROP TRIGGER IF EXISTS profile_name_change_trigger ON public\.profiles/);
  assert.match(snapshotMigration, /DROP FUNCTION IF EXISTS public\.update_orders_account_name/);
  assert.match(withdrawRoute, /z\.enum\(\["bkash", "nagad"\]/);
  assert.match(migration, /v_clean_method NOT IN \('bkash', 'nagad'\)/);
  assert.match(migration, /SET search_path = ''/);
  assert.match(migration, /TO service_role, postgres/);
  assert.doesNotMatch(migration, /ALTER TABLE public\.withdrawals/);
});

test("transaction history has a bounded, deterministic cursor contract", () => {
  const route = read("app/api/transactions/route.ts");
  const page = read("app/transactions/page.tsx");
  assert.match(route, /const DEFAULT_PAGE_SIZE = 25/);
  assert.match(route, /const MAX_PAGE_SIZE = 100/);
  assert.match(route, /\.eq\("user_id", user\.id\)/);
  assert.match(route, /\.order\("created_at", \{\s*ascending: false/);
  assert.match(route, /\.order\("id", \{ ascending: false \}\)/);
  assert.match(route, /\.limit\(pagination\.pageSize \+ 1\)/);
  assert.match(route, /created_at\.lt/);
  assert.match(route, /nextCursor/);
  assert.match(page, /Load more/);
});
