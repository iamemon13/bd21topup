# BD21topup Final Red-Team Security Audit

## Audit Metadata
- **Audit date:** 2026-09-27
- **Repository reviewed:** `https://github.com/iamemon13/bd21topup`
- **Production URL:** `https://topup.ekbotix.com/`
- **Commit SHA reviewed:** Public `main` branch as retrieved during this audit; exact SHA could not be resolved from the public web view.
- **Scope:** Authentication, RBAC, customer order creation, wallet payment, external payment verification, admin order actions, package administration, withdrawal administration, dispatch design, Supabase/RPC security posture, HTTP/security headers, rate limiting, dependency metadata, privacy, and concurrency design.
- **Method:** Read-only public source review, architecture/documentation review, static reasoning about exploit paths, and non-destructive production reachability check.
- **Safety limitations:** No production mutation, payment, Telegram send, destructive SQL, credential attack, high-volume test, commit, or push was performed. Supabase production SQL checks were not possible because no authenticated Supabase database connector/session was available. The production website was not retrievable through the available web fetcher, so no claim is made about live UI behavior.

## Executive Summary

The reviewed codebase demonstrates substantial security hardening: bearer-token verification uses Supabase Auth server-side, package prices are resolved server-side, wallet payment is delegated to an atomic PostgreSQL RPC with row locking, external payment transaction IDs have database-backed replay protection, direct authenticated withdrawal inserts are blocked, and sensitive admin operations use audited RPCs.

One **HIGH** authorization/business-logic finding remains: the external payment verification endpoint grants payment-verification authority to `editor` accounts holding `manage_orders`. Verification is represented as an administrative assertion rather than cryptographic/provider-side payment proof, and successful verification can lead directly to automatic top-up dispatch creation when the feature flag is enabled. A compromised editor can therefore potentially turn a pending unpaid external order into a verified order and start a real top-up.

A second **MEDIUM** finding is the absence of equivalent request-level rate limiting on several privileged financial/admin mutation routes. Customer financial routes have a Supabase-backed rate limiter, but privileged mutations such as payment verification, withdrawal review, order status changes, package changes, and admin wallet adjustments do not show the same request-level throttling in the reviewed route handlers. This does not by itself bypass authorization or prove double execution, but it increases replay/automation/operational-risk exposure for a compromised privileged account.

The most important audit limitation is database/worker visibility: the public source available to this review did not expose all authoritative RPC bodies and VPS Telegram-worker implementation needed to conclusively prove or disprove every dispatch crash/retry/late-reply race. Those cases are therefore recorded as residual verification items rather than asserted vulnerabilities.

## Architecture Overview

The documented architecture is browser → Next.js App Router → route validation/auth/RBAC → server-side Supabase client → PostgreSQL tables/RPC/RLS/grants/constraints/audit ledger. Wallet payment uses a database RPC that loads authoritative price, locks the wallet/profile row, validates funds, updates balance, creates the order, and records the wallet transaction.

The wallet payment route authenticates the bearer token, rate-limits the user, validates UID/player/package, generates the transaction ID server-side, and calls `process_wallet_payment` with the authenticated user ID rather than accepting a client amount.

External order creation resolves the package price from the database, derives the authenticated user ID from the verified token, and inserts the order with server-controlled amount and receiver number.

## Existing Security Strengths

- Server-side Supabase Auth token verification for customer/admin routes.
- Admin role lookup requires an actual `admin_roles` row and checks the allowed role plus permission.
- Customer wallet payment does not trust a client-supplied amount; the RPC is authoritative.
- External package price is loaded from `packages` rather than accepted from the browser.
- External payment transaction IDs are normalized and globally claimed across supported order/add-money sources through a private table with a primary key.
- Direct authenticated withdrawal INSERT was revoked so customers cannot bypass the intended withdrawal workflow.
- Security headers include `nosniff`, `Referrer-Policy`, frame denial, a baseline CSP, and production HSTS.
- Customer financial endpoints use a PostgreSQL-backed rate limiter rather than only process-local memory.
- Admin order status updates use an expected-status value through an audited RPC, providing optimistic concurrency protection at the route boundary.
- Package updates use server-side validation and an audited RPC rather than a raw table update.

## Findings Summary Table

| ID | Severity | Confidence | Area | Title | Status |
|---|---|---|---|---|---|
| RT-001 | HIGH | CONFIRMED | RBAC / External Payment | Editor can perform payment verification that can initiate auto top-up | Open |
| RT-002 | MEDIUM | LIKELY | Rate Limiting / Privileged Mutations | Financial/admin mutation routes lack equivalent request throttling | Open |
| RT-003 | LOW | BEST-PRACTICE | Supply Chain / Release Hygiene | Dependency/release audit remains incomplete | Open |
| RT-004 | INFORMATIONAL | CONFIRMED | Audit Coverage | Full production DB and Telegram-worker verification was not available in this review | Open verification item |

## Critical Findings

**None confirmed.**

## High Findings

### RT-001 — Editor payment verification can initiate auto top-up

- **Severity:** HIGH
- **Confidence:** CONFIRMED
- **Component:** `/api/admin/orders/verify-payment`, external payment verification, automatic top-up dispatch
- **Evidence:** The route calls `checkUserRole` with `super_admin`, `admin`, and `editor`, requiring `manage_orders`. The authoritative `admin_verify_external_order_payment` RPC also permits `super_admin`, `admin`, and `editor` with `manage_orders`, so the same trust boundary exists in both the API route and PostgreSQL layer. If automatic external dispatch is enabled, the same request calls `createOrReuseTopupDispatchForExternalOrder`.
- **Attack/failure scenario:** A compromised editor account with `manage_orders` selects a pending external-payment order, calls the verification endpoint directly, and obtains an administrative verification record without the route itself checking gateway/provider evidence. When `AUTO_EXTERNAL_TOPUP_DISPATCH_ENABLED=true`, the same flow can create/reuse a top-up dispatch. The resulting chain is: editor credential compromise → verify unpaid order → dispatch creation → supplier workflow.
- **Impact:** Potential real unpaid top-up and direct financial loss. This is especially important if `editor` is intended to be lower trust than an administrator responsible for payment verification.
- **Recommended remediation:** Introduce a dedicated high-trust `verify_external_payments` permission and require it for external-payment verification. Enforce the rule BOTH in `/api/admin/orders/verify-payment` and inside `admin_verify_external_order_payment`; do not rely on UI-only restrictions. If the intended policy is role-only, enforce that same role boundary independently in both layers. Prefer provider/API/SMS evidence binding where available; otherwise explicitly treat manual verification as a high-trust action.
- **Migration required:** No for route/RPC authorization if existing permission data can be reused; yes if introducing a new permission column/value requires a migration/seed change.
- **Production behavior impact:** Legitimate editors would lose direct payment-verification ability unless the new permission is granted intentionally.
- **Safe to fix immediately:** Yes, after confirming the intended editor capability.

## Medium Findings

### RT-002 — Privileged financial/admin mutation routes lack equivalent request throttling

- **Severity:** MEDIUM
- **Confidence:** LIKELY
- **Component:** Admin financial mutations
- **Evidence:** The shared financial rate limiter defines limits for `orders`, `wallet-pay`, `add-money`, and `withdraw`. The reviewed admin payment-verification, withdrawal-review, order-status, package-update, and admin-wallet routes authenticate/authorize but do not invoke that limiter at the route boundary.
- **Attack/failure scenario:** A compromised valid privileged account can automate repeated requests much more aggressively than an ordinary customer. DB idempotency/concurrency controls may reject duplicates, but request-level throttling is still absent for several sensitive operations.
- **Impact:** Increased abuse/replay/automation risk, operational load, and blast radius after admin credential compromise. This is not evidence of an authorization bypass by itself.
- **Recommended remediation:** Add per-actor and optionally per-IP rate limits to high-impact admin mutations, with tighter limits for payment verification, withdrawal approval, wallet adjustment, cancellation/refund, and package changes. Keep DB idempotency/authorization as the primary control; rate limiting is defense-in-depth.
- **Migration required:** Usually no, if the existing rate-limit RPC/table can be reused.
- **Production behavior impact:** Legitimate bulk operations may receive 429 responses and need bounded batching.
- **Safe to fix immediately:** Yes, after selecting operational thresholds.

## Low Findings

### RT-003 — Dependency/release audit remains incomplete

- **Severity:** LOW
- **Confidence:** BEST-PRACTICE
- **Component:** Dependency/security release hygiene
- **Evidence:** The current repository state verified for this revision uses `next` `16.3.6` and `eslint-config-next` `16.3.6`. The earlier audit observation that the current project used Next.js `15.5.26` was outdated and is corrected here. Dependency auditing and full Git-history secret scanning remain useful release-hygiene checks, but no current-version vulnerability is asserted by this finding.
- **Attack/failure scenario:** An incomplete dependency/security audit can leave a known vulnerable transitive dependency or historical secret undiscovered.
- **Impact:** Potential future supply-chain or credential-exposure risk, dependent on findings from an actual audit.
- **Recommended remediation:** Run the repository's dependency audit and full Git-history secret scan as separate verification tasks; reconcile lockfile/package metadata as part of normal release hygiene.
- **Migration required:** No.
- **Production behavior impact:** None expected.
- **Safe to fix immediately:** Yes.

### RT-004 — Full DB/worker verification remains outstanding

- **Severity:** INFORMATIONAL
- **Confidence:** CONFIRMED
- **Component:** Supabase production state, authoritative financial RPCs, VPS Telegram worker
- **Evidence:** The audit environment did not provide an authenticated read-only Supabase production connection or the complete VPS worker implementation/configuration needed to independently verify every asynchronous dispatch/retry race.
- **Attack/failure scenario:** None asserted. The limitation means some requested race and production-integrity questions remain unverified rather than vulnerable by default.
- **Impact:** Residual uncertainty in the highest-risk asynchronous part of the system.
- **Recommended remediation:** Perform a follow-up audit with read-only Supabase access and the VPS worker source/configuration, with secrets redacted.
- **Migration required:** No.
- **Production behavior impact:** None for the audit itself.
- **Safe to fix immediately:** Not applicable; this is a verification gap.

## Outdated Observations Corrected

- The earlier statement that the current project used Next.js `15.5.26` is **obsolete and removed**. The current repository state verified for this revision uses **Next.js `16.3.6`** and **`eslint-config-next` `16.3.6`**.
- RT-001 is **not** an unverified hypothesis. It is retained as **HIGH / CONFIRMED** based on current source verification.
- The current RT-001 evidence covers **both authorization layers**: the Next.js route allows `super_admin`, `admin`, and `editor` with `manage_orders`, and the `admin_verify_external_order_payment` PostgreSQL RPC applies the same `super_admin`/`admin`/`editor` + `manage_orders` capability boundary.

## Exploit Chain Analysis

### Chain A — editor compromise to unpaid top-up

1. Attacker obtains a valid editor session.
2. Editor is accepted by `/api/admin/orders/verify-payment` because `manage_orders` is sufficient.
3. The route records `payment_verification_source=admin` through the protected verification RPC.
4. If external auto-dispatch is enabled, the route creates/reuses the top-up dispatch.
5. Downstream supplier workflow can then process the top-up.

The weakness is the privilege boundary, not bearer-token forgery.

### Chain B — privileged-account automation amplification

1. A valid privileged account is compromised.
2. Several admin mutation routes accept authenticated requests without the customer financial rate limiter.
3. Database concurrency/idempotency may reject conflicting operations, but the attacker can still generate repeated high-impact attempts until the DB/application controls reject them.
4. Rate limiting would reduce the abuse window and operational blast radius.

## Financial Integrity Assessment

The reviewed customer wallet-payment path is substantially hardened: amount is not accepted from the client, package price is loaded from the database, the authenticated user ID is used, a server-generated wallet transaction ID is created, and the financial operation is delegated to `process_wallet_payment`.

External order creation similarly derives the authenticated user ID and authoritative amount from the package table.

External transaction IDs are normalized and protected by a private claim table keyed by payment method plus normalized transaction ID, covering both orders and add-money requests.

No confirmed client-side amount-forgery path was found in the reviewed order/wallet routes.

## Wallet Security Assessment

The wallet payment route uses a server-generated transaction ID and calls the protected wallet RPC with the authenticated user ID. The documented architecture states that the RPC locks the wallet/profile row and performs balance/order/ledger work transactionally.

Direct authenticated withdrawal inserts are explicitly revoked.

Residual risk: production ledger anomaly queries and RPC body verification were not available during this review.

## External Payment Verification Assessment

The primary concern is RT-001. The endpoint treats manual admin verification as authoritative and does not itself verify the external provider transaction. The route accepts editor + `manage_orders` and then can initiate automatic dispatch.

Global transaction-ID reuse protection is a positive control, but it prevents reuse of the same transaction identifier; it does not prove that a newly submitted transaction identifier corresponds to a real paid transaction.

## Top-Up Dispatch Assessment

The dispatch layer contains useful safety concepts: explicit feature flags, server-side mapping resolution, mapping/version snapshots, operation hashes, dispatch reuse, and operation send-intent tracking.

However, the complete worker-side send/claim/reply state machine was not available for authoritative review. Therefore no claim is made here about crash-after-send, duplicate worker instances, supplier reply spoofing, or late-success retry safety.

## Telegram Worker Assessment

**Not fully verifiable in this audit.** The requested checks—crash immediately after send, multiple worker claims, stale replies, sender pinning, edit abuse, late success, and manual retry races—require the VPS worker source and/or production-safe evidence. These remain mandatory follow-up test cases.

## Supabase / RLS Assessment

Verified source evidence shows deliberate use of private payment-claim storage, revoked direct withdrawal INSERT, server-side RPCs, and documented RLS/grant hardening.

A full table-policy/grant/RPC-execute audit and production data-integrity query set could not be run without authenticated Supabase access.

## RBAC Assessment

The central `checkUserRole` helper validates the bearer token, requires an `admin_roles` row, checks the role against an allowlist, and checks the requested permission for non-super-admins.

The main remaining issue is capability granularity: payment verification is currently reachable by any role granted `manage_orders`, including `editor`. The same boundary is independently present in the verification RPC. A dedicated `verify_external_payments` permission should replace the broad `manage_orders` capability for this high-impact action.

The role-management route itself restricts role changes to `super_admin` and validates roles/permissions before calling `admin_update_role`.

## API Security Assessment

Positive controls include strict bearer authentication, JSON error handling, Zod validation, server-side price lookup, UUID validation, status allowlists, and bounded admin notes.

The main API hardening gap found is inconsistent rate limiting on privileged mutation routes.

## VPS / systemd Assessment

**Not fully verifiable.** The supplied audit scope identifies a VPS/systemd Telegram worker, but the public repository material retrieved for this review did not provide enough authoritative worker/service configuration to assess service account permissions, env-file permissions, restart behavior, duplicate instances, or secret-bearing logs.

## Vercel / Environment Assessment

The application config includes security headers including `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, baseline CSP, Permissions-Policy, and production HSTS.

The CSP is intentionally a baseline rather than a strict nonce-based script policy. The repository documentation also lists production security headers/CSP as an open backlog item, so the current header set should be treated as hardening rather than a completed comprehensive CSP program.

## Privacy / Data Exposure Assessment

Admin order and withdrawal endpoints intentionally expose operational information to authorized admin/editor users, including transaction IDs and withdrawal account numbers.

No unauthorized public exposure was proven from the available source. Least-privilege review should confirm that every editor who can access these endpoints is expected to see the displayed payment/withdrawal data.

## Race Condition Matrix

| Race | Result from available evidence | Assessment |
|---|---|---|
| Wallet debit vs order insert | Wallet payment delegated to atomic RPC with row locking | Protected by design; RPC body not independently re-run here |
| Cancel/refund vs dispatch creation | Cancel uses audited financial RPC; dispatch creation is separate | Needs production/RPC verification for cross-flow atomicity |
| Dispatch claim vs second worker | Worker implementation unavailable | Unverified |
| Telegram send vs worker crash | Worker implementation unavailable | Unverified; highest follow-up priority |
| Supplier late success vs manual retry | Worker implementation unavailable | Unverified |
| Payment verification vs cancellation | Verification checks pending/cancelled state before RPC; cancellation uses separate audited financial path | Needs DB-level transition verification |
| Completion vs refund | Status transitions and audited cancellation exist | Needs authoritative RPC verification |
| Manual completion vs Telegram completion | Optimistic expected-status RPC exists | Route-level protection present; full dispatch coupling unverified |
| Same transaction ID across orders | Private global claim table keyed by method + normalized ID | Strong protection; production state should be checked |
| Same order verified twice | Route short-circuits if already verified; DB RPC must enforce final idempotency | Needs RPC body/production confirmation |

## Production Data Integrity Checks

**Not executed.** No authenticated Supabase production connection was available in the audit environment.

The following read-only queries/checks remain required:

- duplicate external transaction IDs;
- duplicate wallet evidence;
- multiple dispatches per order;
- multiple wallet debit rows per order;
- completed orders with pending/active dispatches;
- cancelled orders with active dispatches;
- verified external orders missing verification source/verifier;
- external dispatches without verification;
- wallet dispatches without debit evidence;
- zero/negative/invalid financial amounts;
- orphaned financial/dispatch rows;
- unexpected statuses;
- invalid/duplicate admin roles;
- completed orders with cancellation/refund evidence;
- stale/manual-review dispatches;
- old queued dispatches and stale worker claims.

## Missing Security Tests

1. Editor cannot call payment verification after a dedicated permission boundary is introduced.
2. Direct API verification cannot create a top-up without authoritative payment evidence.
3. Two simultaneous verification requests create at most one verification/dispatch.
4. Cancellation and dispatch creation cannot produce refund + top-up simultaneously.
5. Worker crash after supplier send cannot cause a second supplier send on restart.
6. Two workers cannot claim the same operation.
7. Late supplier success after timeout/manual review cannot be applied to a different order.
8. Supplier sender/chat/message identity is pinned and exact reply linkage is enforced.
9. Edited or forwarded supplier messages cannot satisfy success evidence unless explicitly linked to the original expected message.
10. Completed/cancelled/refunded orders cannot re-enter dispatch.
11. Reusing a transaction ID across order and add-money paths is rejected case/whitespace-insensitively.
12. Privileged financial routes enforce bounded request rates.
13. Package price changes are audited and cannot alter historical order amounts.
14. Admin role/permission changes are protected against concurrent stale writes.

## Recommended Remediation Order

1. **Immediate mitigation:** restrict external payment verification to the minimum trusted role/permission; disable automatic external dispatch if payment-verification trust cannot yet be established.
2. **Financial/security critical:** verify the `admin_verify_external_order_payment` RPC authorization and transition rules at the DB layer.
3. **Authorization/data isolation:** separate high-impact capabilities such as payment verification from broad `manage_orders` if editors are intended to be lower trust.
4. **Concurrency/idempotency:** complete worker crash/retry/claim and cancellation/dispatch race testing with read-only production evidence.
5. **Hardening:** add privileged-operation rate limits; complete dependency and Git-history secret audits; reconcile version metadata.
6. **UX/trust:** make high-impact admin actions explicit, audited, and visibly distinct from routine order management.

## Release Readiness Checklist

- [ ] Payment verification restricted to intended high-trust role.
- [ ] DB RPC independently enforces payment-verification authorization.
- [ ] Read-only production integrity queries completed.
- [ ] Telegram worker crash/retry/idempotency tests completed without real supplier sends.
- [ ] Multiple-worker claim safety demonstrated.
- [ ] Late supplier reply/manual retry safety demonstrated.
- [ ] Privileged mutation rate limiting enabled.
- [ ] Dependency audit completed.
- [ ] Git-history secret scan completed.
- [x] Current `package.json` framework version verified as Next.js 16.3.6 / eslint-config-next 16.3.6; older 15.5.26 observation corrected.
- [ ] Lockfile/documentation metadata independently reconciled.
- [ ] Production headers/CSP reviewed against current deployment.
- [ ] Follow-up red-team audit completed after remediation.

## Residual Risk

Residual risk remains concentrated in two areas: (1) high-trust payment verification and (2) the asynchronous Telegram supplier boundary. The reviewed code has multiple defensive layers, but the second area cannot be fully assessed without the worker and database RPC implementations plus safe production state checks.

## Security Engineering Practices Demonstrated

Verified practices include:

- server-side RBAC and fine-grained permissions;
- Supabase RLS/grant hardening documented in the repository;
- SECURITY DEFINER/private-function hardening documented and represented in migrations;
- atomic financial RPC design;
- row locking for wallet operations;
- global external transaction-ID replay protection;
- direct-write bypass protection for withdrawals;
- server-side authoritative package pricing;
- audit logging for sensitive admin operations;
- optimistic concurrency on admin order status changes;
- serverless-aware rate-limit state in Supabase;
- guarded financial reconciliation methodology.

These statements are limited to practices supported by the reviewed source/documentation and are not claims of complete security or compliance.

## Final Assessment

**Overall risk level: HIGH until RT-001 is resolved or explicitly accepted as an intentional high-trust editor capability.**

The codebase has materially stronger financial controls than a typical client-trusting top-up application, and no confirmed critical unauthenticated money-movement path was identified from the accessible source. The remaining high-impact concern is the authorization boundary around manual external-payment verification and its coupling to automatic top-up dispatch.

A follow-up audit is recommended after RT-001 remediation, with authenticated read-only Supabase access and the VPS worker source/configuration available for review.
