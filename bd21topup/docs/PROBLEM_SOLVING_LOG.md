# BD21topup — Problem Solving Log

This document highlights engineering problems identified and solved during development.

Format: **Problem → Root Cause → Solution → Verification / Evidence**.

## 2026-09-24 — Remaining audit and targeted fixes

**Commit:** `ed5fc89fa257c6fec0acaca559dc3405b10e24fd` — deployed to production; Vercel READY.

**Problem:** Role or permission changes could succeed without an audit record.

**Root cause:** The API performed an admin_roles upsert, then called best-effort logAdminAction separately.

**Solution:** Applied `20260924165709_atomic_admin_role_audit`; the API calls a service-only SECURITY INVOKER RPC. It validates stored Super Admin authority and inputs, prevents self-demotion, serializes concurrent calls and commits the role write/audit together. No RLS or financial privilege relaxation.

**Verification:** 11 new isolated database tests cover audit-failure rollback, authorization, ACLs, validation and missing targets; API tests cover verified actor derivation and forbidden roles. A live service-role execution was fully rolled back.

**Problem:** Bulk completion attempted to update a column absent from production.

**Root cause:** `orders.updated_at` was present in the update payload but absent from the live schema.

**Solution:** Removed only that assignment; retained the pending/approved/processing state filter. Regression test passed; no real orders were completed for testing.

**Problem:** npm audit reported zero despite a new upstream Next.js security advisory.

**Solution:** Reviewed GHSA-vcvr-r3jv-pc5j and patched Next.js to 16.3.6, aligning eslint-config-next. This app has no affected ImageResponse usage; do not claim demonstrated RCE exposure.

**Verification:** 71/71 total tests, typecheck, focused ESLint, production build and diff checks passed. npm audit remained zero; 369 registry signatures and 95 attestations verified. Preview and production-origin read-only APIs returned expected unauthenticated 401s; baseline headers verified.

**Investigated, not financially repaired:** all-history secret scan found no real repository secrets; 28 wallet-order gaps, 13 withdrawal gaps and three completed/refunded orders were reviewed read-only. Historical deployment/approval/balance evidence remains insufficient for corrections. Detailed customer evidence is private/local, not published here.

The user stopped further audit work and requested a handoff. See [audit report](REMAINING_SECURITY_AUDIT_2026-09-24.md) and [next-session handoff](NEXT_AUDIT_HANDOFF.md) for remaining work and exact limitations.

---

## 1. Admin Packages API / Vercel 500
**Commit:** `32d140a`

**Problem:** Admin package management failed in production/Vercel.

**Solution:** Corrected the package-management API/server-side Supabase flow, then moved package pricing toward a database-backed source of truth.

Related commits: `6c5dce5`, `dc035b3`.

---

## 2. Client-controlled package prices
**Commits:** `dc035b3`, `78ad35f`, `be6c920`, `ef14430`

**Problem:** A browser-submitted amount must not become the authoritative financial value.

**Solution:** The server loads the package from the database and uses the stored price when creating orders/payments.

**Result:** Editing a request in DevTools cannot redefine the real package price.

---

## 3. Wallet payment race condition
**Commits:** `8b1b13c`, `0f9feff`, `ef14430`

**Problem:** Concurrent wallet purchases could read the same balance before either write completed.

**Root cause:** Application-level read/check/write is not enough for concurrent financial requests.

**Solution:** Moved wallet payment into a PostgreSQL RPC with `FOR UPDATE` locking. The database resolves price, locks the wallet row, checks funds, deducts, creates the order, and writes wallet history as one controlled operation.

---

## 4. Admin wallet-adjustment race condition
**Commit:** `9005158`

Manual wallet adjustment was hardened to avoid lost updates during concurrent balance changes.

---

## 5. Coarse admin authorization
**Commits:** `8b572d9`, `6a6e2ef`, `8b1b13c`, `e0a6852`, `20ec72a`

**Problem:** One generic admin role was too broad.

**Solution:** Evolved to:
- `super_admin`
- `admin`
- `editor`

with permissions such as:
- `manage_users`
- `manage_orders`
- `manage_add_money`
- `manage_withdrawals`
- `manage_packages`

Authorization is enforced in server routes, not just hidden in the UI.

---

## 6. Admin withdrawal access problems
**Commits:** `200668f`, `55114da`, `9e2c6db`, `4198310`

Both admin page access and sensitive API authorization were tightened.

**Lesson:** Hiding a menu/button is not authorization; the API must reject unauthorized callers.

---

## 7. Withdrawal behavior changed across versions
**Commits:** `0f7b763`, `d6d9e42`, `9a59608`, `bafc4d8`, `13eda24`, `65c1287`, `37d9884`

Historical versions deducted money at different stages or wrote different ledger records.

**Solution:** Git history was used as forensic evidence to reconstruct the implementation active when production records were created.

**Result:** Later reconciliation corrected only rows supported by strong evidence.

---

## 8. Direct withdrawal insert bypass
**Commit:** `832fb94`  
**Migration:** `20260922194814_block_direct_withdrawal_insert.sql`

**Problem:** Authenticated clients must not bypass the intended withdrawal workflow by writing directly to the table.

**Solution:** Direct authenticated withdrawal inserts were blocked/revoked so the server-controlled workflow remains authoritative.

---

## 9. Reused external payment Transaction IDs
**Commit:** `9ce79b1`  
**Migration:** `20260922200434_enforce_global_payment_transaction_id.sql`

**Problem:** Reusing an external payment reference can create replay/double-credit risk.

**Solution:** Added DB-backed global Transaction ID protection for bKash, Nagad, Rocket, and Upay.

Historical short IDs were preserved instead of rewriting old evidence.

---

## 10. Supabase migration-history drift
**Commit:** `c9ec07d`

Local migration versions and production migration history were synchronized before further production database changes.

---

## 11. Legacy withdrawal ledger metadata mismatch
**Commit:** `c64f3db`  
**Migration:** `20260922204031_normalize_legacy_withdrawal_ledger.sql`

Six historical request-time withdrawal debits existed as generic adjustment records.

They were proven by matching user, amount, timestamp, and historical source behavior.

Only classification/reference metadata changed:
- `type = withdrawal`
- `reference_id = withdrawal.id`

Wallet balance and amount were not changed.

---

## 12. Rejected legacy withdrawals missing reversals
**Commit:** `9d6a63e`  
**Migration:** `20260922210811_reconcile_legacy_withdrawal_reversals.sql`

Two rejected withdrawals had proven request-time debits but no matching reversal.

Amounts:
- ৳314
- ৳100

A guarded migration verified assumptions, locked the profile row, credited the exact amounts, and inserted canonical reversal records.

**Verified balance:** `৳9352 → ৳9766`

Each target ended with exactly one debit and one reversal.

---

## 13. Duplicate withdrawal transaction-history entries
**Commits:** `f4ab462`, `13bad75`

**Problem:** Canonical withdrawal ledger rows and separately formatted withdrawal requests could both appear.

**Root cause:** The filter used `"Withdrawal"` while DB canonical type was lowercase `"withdrawal"`.

**Fix:**
```ts
transaction.type?.toLowerCase() !== "withdrawal"
```

A temporary encoding side effect from PowerShell editing was also detected and repaired by restoring the clean file and writing UTF-8 without BOM.

---

## 14. Password recovery hardening
**Commits:** `5f7b41d`, `694d50c`

The reset flow was restricted to a real recovery session and strengthened with password-length validation, invalid-session handling, and safe redirect/sign-out behavior.

---

## 15. In-memory rate limiting on serverless
**Commits:** `a3e1373`, `1fb5c4f`, `ae12579`

**Problem:** Process memory is not reliable shared state on Vercel/serverless.

**Solution:** UID verification rate-limit/cache state moved to Supabase.

---

## 16. Public recent-order privacy
**Commit:** `c36ac24`

The public recent-order response was minimized so the trust feed does not unnecessarily expose customer data.

---

## 17. Admin auditability
**Commits:** `20ec72a`, `539663e`, `dce2897`, `6cbc0ca`, `4c1f419`, `bc9ec09`

Sensitive admin operations gained audit logging and a super-admin activity interface with filtering/search.

---

## 18. Support context for rejected/cancelled operations
**Commits:** `e509f38`, `4018cda`

Secure support cases were linked to customer histories and admin support lookup so rejected/cancelled financial operations can be discussed with context.

---

## 19. Database privilege hardening
**Commits:** `a57b2ca`, `52217e2`, `772c664`, `c8211c4`

Privileges for admin-role data, audit data, client tables, and privileged functions/triggers were reviewed and reduced.

**Lesson:** RLS is one layer; table grants and function execution privileges matter too.

---

## 20. All packages appeared under UID TopUp
**Commit:** `7cee0c8`

**Problem:** Admin UI placed every package under UID TopUp.

**Root cause:** Frontend expected `pkg.category`, but `/api/admin/packages` did not return `category`.

Fallback:
```ts
const cat = pkg.category || "uid_bd";
```

**Fix:** Admin package API now selects/returns:
- `category`
- `sort_order`

**Verification:** Live DB already had correct category counts:
- `uid_bd`: 17
- `combo_offer`: 10
- `weekly_lite`: 4
- `level_up`: 6
- `ff_likes`: 10
- `indo_server`: 10

No DB rewrite was needed.

---

## 21. Supabase CLI local state committed
**Commit:** `5b39caf`

Tracked `supabase/.temp/` files were removed and `/supabase/.temp/` was added to `.gitignore`.

---

# Open investigations

These are not represented as solved:

- Remaining legacy wallet-order reconciliation
- Remaining historical withdrawals without canonical debit rows
- Additional audit-log hardening
- Financial endpoint rate limiting
- FK indexes and RLS performance
- Production security headers/CSP
- Dependency audit
- Full Git-history secret scan
