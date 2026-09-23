# BD21topup — Security Engineering

## Defense-in-depth model

The project uses multiple layers:

1. Client-side UX validation
2. Server-side validation
3. Authentication
4. Role/permission authorization
5. PostgreSQL constraints
6. RLS and table grants
7. Transactional RPC functions
8. Row locking for financial updates
9. Audit logging
10. Production verification/migrations

No single layer is treated as sufficient.

## Authentication and recovery

Security work includes:
- server-side access-token verification,
- safer OAuth callback handling,
- recovery-session-only password reset,
- password length validation,
- safer redirect/session behavior.

Representative commits:
- `694d50c`
- `c81071b`
- `13ea427`

## RBAC

Roles:
- `super_admin`
- `admin`
- `editor`

Permissions:
- `manage_users`
- `manage_orders`
- `manage_add_money`
- `manage_withdrawals`
- `manage_packages`

Representative commits:
- `8b572d9`
- `8b1b13c`
- `e0a6852`
- `20ec72a`
- `61bc2bd`

## Server-side financial authority

The browser expresses intent; the server/database owns authoritative financial values.

Examples:
- package price comes from DB,
- wallet changes happen in protected server/RPC flows,
- client-provided amounts are not trusted as authoritative.

## Concurrency protection

Financial balance operations use database-controlled concurrency.

Examples:
- wallet payment RPC with `FOR UPDATE`,
- admin wallet-adjustment race-condition fix,
- hardened withdrawal processing.

Commits:
- `9005158`
- `0f9feff`
- `37d9884`

## Direct database bypass protection

Migration:
`20260922194814_block_direct_withdrawal_insert.sql`

Authenticated users cannot directly insert withdrawals and bypass the intended server workflow.

## Payment Transaction ID replay protection

Migration:
`20260922200434_enforce_global_payment_transaction_id.sql`

External Transaction IDs are centrally protected against reuse for supported external payment methods.

## Database privilege hardening

Representative commits:
- `a57b2ca`
- `52217e2`
- `772c664`
- `c8211c4`

These cover admin-role data, audit data, client tables, and trigger/function privileges.

## Public-data minimization

`c36ac24` hardened public recent-order data to reduce unnecessary customer information exposure.

## Serverless-aware rate limiting

UID verification rate-limit state moved from process memory to Supabase.

Commits:
- `a3e1373`
- `1fb5c4f`
- `ae12579`

## Audit logging

Sensitive admin operations are logged and visible through a super-admin activity page.

Commits:
- `4c1f419`
- `bc9ec09`

## Financial-reconciliation methodology

Historical financial correction followed these rules:

- inspect current DB state,
- inspect historical source code,
- match exact user/amount/time/reference evidence,
- avoid bulk assumptions,
- use guarded migrations,
- verify before/after balances,
- preserve historical evidence.

Used for:
- `20260922204031_normalize_legacy_withdrawal_ledger.sql`
- `20260922210811_reconcile_legacy_withdrawal_reversals.sql`

## Open security backlog

- Financial API rate limiting
- Additional audit-log hardening
- RLS performance optimization
- Missing FK indexes
- Production security headers/CSP
- Dependency audit
- Git-history secret scan
- Remaining historical ledger investigation
