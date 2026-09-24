# BD21topup — Project Journey

This file converts the raw Git history into a readable engineering timeline. The exact raw history is generated separately in `COMMIT_HISTORY.md`.

## 2026-09-24 — Security audit continuation and handoff

- `ed5fc89` — transactional role/permission audit, bulk completion schema correction, Next.js/eslint-config-next 16.3.6 security patch.
- Applied and verified `20260924165709_atomic_admin_role_audit`, using SECURITY INVOKER with service-only execution. Existing financial wrapper/legacy ACLs preserved.
- 71 tests passed; typecheck, ESLint, production build, npm audit and registry signature verification completed.
- Gitleaks scanned Git history and all historical blobs with redacted output. No real repository secret found; local ignored credentials and fake fixtures documented separately.
- Investigated all 44 historical financial candidates without modifying balances or history. Manual evidence still required.
- Preview and production deployment READY; protected read-only origin APIs rejected unauthenticated requests; baseline headers verified.
- User requested stopping remaining work and publishing a Markdown handoff plus this problem-solving/history record. Strict CSP, other audit atomicity, proxy/retention work and authenticated browser acceptance remain unfinished.

See [full report](REMAINING_SECURITY_AUDIT_2026-09-24.md) and [handoff](NEXT_AUDIT_HANDOFF.md).

## 2026-09-10 — Initial production snapshot

- `7cf8f2f` — Initial BD21 Top Up project backup
- `53735ad` — Added database schema backup

The project already contained a Next.js application, customer account/wallet features, admin pages, Supabase integration, and Vercel-oriented deployment.

## 2026-09-11 — Database pricing, wallet, order management

Major work included:

- Admin package management
- Database-driven package prices
- Wallet payment flow
- Recent orders
- Notifications
- Order-status workflows
- Add-money workflows
- Bulk admin actions

Representative commits:

- `32d140a` — Fixed Vercel 500 error for admin packages API
- `6c5dce5` — TopUp page fetches prices from DB
- `dc035b3` — Order API fetches package prices from DB
- `3aaa789` — Wallet payment flow with order creation
- `8be5087` — Bulk order completion/cancellation
- `4ece49d` — Bulk add-money actions

## 2026-09-17 — Product categories, RBAC, recovery, withdrawals

Dedicated product flows were added for:

- Weekly / Monthly
- Weekly Lite
- Level Up Pass
- FF Likes
- Indonesia Server

Representative commits:

- `52e56d2`
- `10f8831`
- `3567de4`
- `f5be8a0`

Admin authorization evolved from simple checks into reusable role-based access:

- `8b572d9` — created `admin-auth.ts`
- `71677e3` — role retrieval
- `6a6e2ef` — role-based bulk order actions

Customer account recovery and withdrawals were also implemented:

- `fe7c5fc` — forgot password
- `9897414` — change password
- `0f7b763` — initial withdrawal API
- `6199959` — withdrawal validation
- `b2fae0d` — admin withdrawal management

## 2026-09-18 — Production debugging and financial-flow evolution

A large set of API/category/UID/order/withdrawal changes happened here.

Important examples:

- `a96314b` — `balance_after` handling
- `65c1287` — withdrawal PATCH refactor
- `cf4eea3` — UID check logging/error handling
- `0c6138d` — package category/filtering changes
- `0d712aa` — order API auth/error handling
- `848f551` — recent orders endpoint

This period later became important for financial forensics because different versions of withdrawal logic handled deduction/refund timing differently.

## 2026-09-19 to 2026-09-20 — Security review

Admin withdrawal access was repeatedly tightened:

- `200668f`
- `55114da`
- `9e2c6db`
- `4198310`

Broader security work followed:

- `8b1b13c` — admin RBAC + wallet hardening
- `37d9884` — withdrawal hardening
- `9005158` — admin wallet race-condition fix
- `8047b25` — validation, rate limiting, data minimization
- `78ad35f` — API permissions and financial validation

## 2026-09-21 — Systematic defense-in-depth

Security work became database-focused.

Representative commits:

- `e0a6852` — separated admin roles from profiles
- `20ec72a` — RBAC + wallet audit logging
- `2cd93bc` — withdrawal hardening + Upay
- `539663e` — add-money hardening/audit
- `894c747` — order cancellation refund hardening
- `85b48f3` — order DB constraints
- `0f9feff` — wallet payment RPC hardening
- `ef14430` — wallet payment API hardening
- `af3f220` — admin package hardening
- `a57b2ca` — admin-role privileges
- `52217e2` — audit-log privileges
- `772c664` — client table privileges
- `c36ac24` — public recent-order privacy
- `1fb5c4f` — UID verification hardening
- `ae12579` — DB-backed UID rate limiting
- `c8211c4` — trigger-function privilege hardening

The architecture evolved toward layered protection: server validation, authorization, DB constraints, RLS/grants, RPC transactions, row locking, and audit logs.

## 2026-09-22 — Traceability and financial reconciliation

Key work:

- `e509f38` — secure support cases
- `4c1f419` — super-admin activity log
- `bc9ec09` — activity email search
- `694d50c` — password recovery hardening
- `832fb94` — blocked direct withdrawal inserts
- `9ce79b1` — global payment Transaction IDs
- `c9ec07d` — migration-history synchronization
- `c64f3db` — legacy withdrawal ledger normalization
- `9d6a63e` — legacy rejected-withdrawal reversals
- `f4ab462` / `13bad75` — duplicate withdrawal-history fix + encoding cleanup
- `5b39caf` — removed tracked Supabase CLI temp state

### Historical financial investigation

Git history was used as evidence to identify when the application deducted withdrawals on request vs approval and how ledger entries were written.

Only strongly proven rows were changed.

Two rejected withdrawals with proven debits but missing reversals were corrected. Verified wallet balance:

`৳9352 → ৳9766`

## 2026-09-23 — Package category regression

- `7cee0c8` — load package categories in admin

All packages appeared under UID TopUp because the frontend expected `category`, but the admin API did not return it. The DB already had correct categories, so only the API response needed fixing.

## Skills demonstrated

- Next.js / React / TypeScript
- API route design
- Supabase Auth
- PostgreSQL
- RLS / grants / constraints
- RPCs and transactional logic
- Concurrency/race-condition handling
- Financial ledger reasoning
- Database migrations
- RBAC
- Production debugging
- Security reviews
- Git-based forensic investigation
- Vercel/serverless deployment
