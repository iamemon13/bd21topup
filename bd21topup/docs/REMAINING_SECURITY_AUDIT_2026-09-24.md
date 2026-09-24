# Remaining security audit — 2026-09-24

This is an evidence-based audit and targeted hardening report, not a claim that every security or historical accounting question is resolved. Customer balances, financial history and external transaction IDs were not changed.

## 1. Work completed

Started from clean, current main `776ccebb31e191c59476577ee5e933322fff53da`; fetched origin and tags. Confirmed its Vercel production deployment was READY and all 20 existing Supabase migrations were applied. Neither previous hardening migration was repeated.

Application/security commit: `ed5fc89fa257c6fec0acaca559dc3405b10e24fd`.

| Change | Reason | Files / verification |
|---|---|---|
| Atomic role/permission audit | Previously an upsert could succeed while best-effort audit logging failed | `app/api/admin/role/route.ts`; service-only `admin_update_role` RPC; 11 isolated DB tests and 4 API tests |
| Bulk completion schema fix | Live `orders` has no `updated_at`; old bulk completion wrote that missing column | `app/api/admin/orders/bulk/route.ts`; regression test confirms supported columns and pending/approved/processing filter |
| Next.js security patch | Official ImageResponse advisory covers installed package version; app has no affected API usage | Next.js 16.3.5 -> exact 16.3.6, eslint-config-next 16.3.3 -> exact 16.3.6; package.json and lockfile |
| Read-only historical review query | Reproducible candidate, ledger, funding, withdrawal, audit and support correlation | `scripts/review-historical-finance.sql`; detailed customer evidence kept outside public repository |

Applied migration: `20260924165709_atomic_admin_role_audit`. The CLI created the draft migration; repository filename was synchronized with the actual remote version after application. Read back migration history, function definition, owner, search path and ACL. New function is **SECURITY INVOKER**, owner postgres, empty search_path; only owner and service_role have EXECUTE. It rechecks stored Super Admin authority, validates roles/permissions, prevents self-demotion, locks the actor row, serializes concurrent calls, and commits mutation/audit together. Existing service-role table permissions remain; this is an application-path atomicity guarantee, not protection against a compromised service credential or out-of-band SQL.

Live verification executed the caller's existing Super Admin role through the function inside BEGIN/ROLLBACK with service_role, checked one audit insertion, then rolled everything back. No persistent role/audit test change remained. No financial production test was performed.

Validation actually run after application/dependency edits:

- `node --test tests/*.test.mjs`: **71 passed, 0 failed** (16 new, 55 existing), including all financial and historical-repair fixtures.
- `npm run typecheck`: passed.
- Focused ESLint on both changed routes and both new test files: passed.
- `npm run build`: passed on Next.js 16.3.6; 44 static pages generated.
- `git diff --check`: passed (Windows line-ending notices only).
- `npm audit`: 0 reported vulnerabilities, before and after patch.
- `npm audit signatures`: 369 packages verified; 95 attestations verified.
- Renamed-migration DB test rerun: 11/11 passed.

Preview `bd21topup-8wgcljjqm-ekbotix.vercel.app` was READY for the exact application commit. Linked Vercel CLI read-only checks: root 200; account, transactions, order history, admin role, admin activity and dashboard APIs all 401 without application credentials. Expected baseline headers present. Merged by fast-forward from current main only after preview checks.

## 2. Security findings

| Severity | Finding / evidence | Impact and exploitability | Protection / recommendation | Status |
|---|---|---|---|---|
| Critical | No demonstrated critical application exposure found in this review | The upstream Next.js advisory is critical, but requires attacker-controlled Node ImageResponse SVG; no ImageResponse/next/og usage was found | Keep patched framework | Patched defensively; do not label this app proven remotely exploitable |
| High | No confirmed high-severity exploitable finding established | Historical accounting gaps alone are not proof of stolen/missing current funds | Preserve records and obtain manual evidence | Investigation documented |
| Medium | Role/permission mutation could lack audit | Authorized Super Admin operation plus audit failure could erase accountability; not a demonstrated privilege bypass | Atomic RPC, internal authorization and rollback tests | Fixed |
| Medium | Package updates and nonfinancial single/bulk order status changes still have best-effort audit | Requires authorized operation and logging failure; audit trail can be incomplete | Later focused invoker-RPC transactions, retaining state-machine predicates | Deferred, explicitly not fixed by role RPC |
| Medium | Leaked password protection disabled | Known compromised passwords remain eligible; risk depends on password reuse | Managed protection requires Pro+; no paid change made | Plan limitation remains |
| Low | Minimal CSP does not restrict scripts, styles, images or connections | Defense-in-depth gap if an injection bug exists; no injection exploit found | Staged strict-CSP proposal below | Deferred |
| Low | Rate counters have no scheduled retention; raw valid IPv6 strings are not canonicalized | Possible growth or equivalent-address bucket fragmentation; per-user limit remains | Monitor, then bounded expiry cleanup and canonicalization with proxy tests | Reviewed; no threshold change |
| Low | Cloudflare proxy may aggregate Vercel IP buckets | Vercel normally overwrites forwarded IPs, so proxy ingress may become the shared IP; legitimate users could share a bucket | Verify actual hosting path before changing trusted headers; never blindly trust CF-Connecting-IP | Operational follow-up |
| Low | Bulk completion wrote nonexistent column | Authorized bulk completion could fail with DB error; not data theft | Remove only invalid field, preserve status guard | Fixed |
| Informational | Local secrets and framework-generated keys are present only in ignored local files | Expected local configuration, no history or client-bundle match found | Keep ignored; no rotation solely for legitimate local presence | No confirmed leak |

## 3. Secret scan report

Gitleaks **8.30.1**, downloaded from the official GitHub release; Windows x64 archive SHA-256 matched the published release checksum. All scanner output/report values were redacted. No credential was sent to an external verification service, printed, committed or rotated.

Baseline coverage: **313 reachable commits**, **314 including reflog**, fetched branches/tags, non-shallow repository. Initial Git scan reported 296 patch-bearing commits; reflog-inclusive scan reported 297. These scanner counts are not the total commit count. To cover merge snapshots and deleted/historical content independently of patch traversal, exported and scanned **all 546 unique Git blobs** across refs/reflog (2,472 objects, about 28.10 MB).

| Scan | Result |
|---|---|
| All history, `--all --full-history`, then reflog-inclusive | No default-rule findings |
| All unique historical blobs, including deleted content | No default-rule findings |
| Project-specific credential assignment rules in all blobs | Two findings: two historical versions of the same browser fixture line; fake local-fixture access/refresh strings, not credentials |
| Current entire app directory, including ignored files/dependencies/build output | 14 findings: four in .env.local, ten generated Next.js keys in ignored .next files |
| Exact local secret values checked against every historical blob | No matches; includes SIAMBHAU key even though default rules did not flag it |
| Exact non-public local secrets checked against .next/static | No matches |
| Tracked .env files | Only .env.example, empty credential placeholders |

Local `.env.local` findings: Vercel OIDC JWT, Supabase public publishable key, Supabase secret key, GOXTOP key; **values [REDACTED]**. The public key is intentionally publishable. Secret/provider credentials may be active; liveness was not probed. Their presence in a gitignored env file is not a repository leak. SIAMBHAU variable also exists locally and was included in exact-value historical/client checks. Framework cache, prerender preview and server-reference manifest keys are generated server artifacts, not committed provider credentials.

Supplemental scanner initially matched empty placeholders by spanning newlines; constrained whitespace to horizontal spacing and reran. Only the two fake fixture findings remained. No broad allowlist was added to the repository.

Evidence/tooling saved outside the public repo at `C:/Users/Emon Khan/.codex/audits/bd21topup-20260924/` (redacted reports, scanner config and local scan script). Scope is exhaustive for available Git blobs; it does not prove absence of every possible secret, recover pruned/unfetched GitHub objects, or perform OCR of image pixels. Public raster assets are not certified free of visually embedded secrets. No history rewrite or force push was performed.

## 4. Historical finance review

Private per-candidate report: `C:/Users/Emon Khan/.codex/audits/bd21topup-20260924/finance-review.md`; adjacent minimized JSON contains the full read-only correlation. It includes all **44 candidates**, their user/order/withdrawal IDs, creation times, amounts/statuses, canonical debits, refunds, prior/following ledger balances, nearby add-money/withdrawal activity, audit/support matches and recommendations. It excludes customer names, phone numbers, external payment IDs and credentials. Do not publish this evidence to the public repository.

- **28 wallet-order debit gaps, BDT 5830:** count and total unchanged; affected wallet still BDT 9944. Historical `1d9338b`/`52ac1ae` deducted the balance before an unchecked `purchase` insert. Current constraint rejects that type. This supports an explanation for missing ledger history, not a fresh debit or deployment-time proof. Overlapping withdrawals, historical adjustments and ambiguous timing prevent confident full-balance reconciliation. Recommendation for every row: needs manual evidence.
- **13 withdrawal gaps out of 19:** no linked canonical debit/reversal for these candidates. Stored balance_after values and nearby ledger were captured individually. `65c1287` deducted at approval, then attempted unchecked `Withdrawal` insertion without reference_id. Earlier versions varied, and created_at is not approval time. Rejected requests may legitimately lack a debit. No bulk reconstruction recommended.
- **3 completed orders with matching original debits and refunds, BDT 352:** two 158 and one 36; original/refund entries confirmed. All three lack matching admin audit/support records. Historical status overwrite is plausible, but actor/time/intent is unproven. Classification for each: **insufficient evidence**, possible historical status inconsistency. Keep refunds and balances unchanged.
- All 44 have zero matching admin audit records. Eight have support-case matches; support cases were introduced/backfilled on September 22, after these events, so they do not prove original debit execution.
- Preserve valid add-money credit/reversal pairs and unusual historical external IDs. No normalization, deletion, ledger insertion or customer balance adjustment was performed.

**Proven:** missing canonical links and completed/refunded coexistence. **Probable:** unchecked historical ledger inserts explain some gaps. **Ambiguous:** current-balance implications, original deployment activation, approval timing, refund intent and simultaneous event order. **Valid historical behavior:** a rejected approval-time withdrawal can correctly lack a debit; net-valid credit/reversal pairs remain valid. **Repair proven: zero candidates.** Manual evidence needed includes provider receipts, contemporaneous balance records, off-platform support/admin records and deployment activation times.

## 5. Supabase state

All previous 20 migrations confirmed applied, including `20260923191844_harden_financial_audit_and_access` and `20260923193817_close_legacy_admin_financial_rpc_entrypoints`; new migration makes 21. No historical migration rerun. All 12 public tables have RLS enabled.

| RPC | service_role | authenticated / anon |
|---|---|---|
| admin_financial_action | Execute | Denied |
| Six legacy admin financial RPCs | Denied | Denied |
| process_wallet_payment / process_withdrawal | Execute preserved | Denied |
| admin_update_role | Execute; SECURITY INVOKER | Denied; PUBLIC revoked |

Existing privileged financial functions remain owned by postgres with search_path=public; no ACL relaxation. New function definition and effective privileges were read back, rather than inferring success from the migration response.

Security/performance advisors run before and after migration:

| Advisor finding | Level | Intentional / actual risk / action |
|---|---|---|
| add_money_requests: RLS no policy | INFO | Intentional server-only; do not add browser policy |
| admin_audit_logs: RLS no policy | INFO | Intentional server-only; retain append/read service access |
| admin_roles: RLS no policy | INFO | Intentional server-only authorization data |
| api_rate_limits: RLS no policy | INFO | Intentional server-only counters |
| notifications: RLS no policy | INFO | Intentional server API access |
| orders: RLS no policy | INFO | Intentional server API access |
| uid_cache: RLS no policy | INFO | Intentional server-only cache |
| wallet_transactions: RLS no policy | INFO | Intentional server-only financial ledger |
| Leaked Password Protection Disabled | WARN | Remaining risk; Free plan confirmed live; Pro+ requirement confirmed in official docs |
| admin_audit_logs_admin_id_idx unused | INFO | Recently added useful FK/index; retain pending workload evidence |
| notifications_user_id_idx unused | INFO | Same; not a vulnerability |
| withdrawals_user_id_idx unused | INFO | Same; not a vulnerability |

Leaked-password protection rejects known compromised passwords via HaveIBeenPwned. Enabling managed protection requires user-approved Pro+ billing. No no-cost equivalent managed switch is available on this Free project. Free mitigations include unique generated passwords/password managers and existing OAuth login. A client-side compromised-password check could improve UX but is bypassable and is not equivalent server enforcement; a custom authoritative flow needs separate design. No billing/auth-policy change was made.

## 6. Application security

**Authentication/authorization:** server token verification and DB-backed role/permission checks retained. Role mutation remains Super Admin only; API tests reject admin/editor/user and derive actor from verified token, not request body. Financial atomicity and rate-limit tests remain green. Activity email search continues reading admin IDs and resolving only those users; no listUsers regression introduced.

**Nonfinancial audit inventory:** role and permission changes are security-critical and now atomic. Package price/name updates and single/bulk nonfinancial order transitions are important and remain best-effort. Package endpoint exposes GET/PUT, not a creation handler. Support administrative lookup is read-only; no new case mutation was discovered. No additional settings-write endpoint was found in the reviewed admin route inventory. Lower-risk informational reads do not require mutation auditing.

**Rate limiting:** retained 15 orders, 15 wallet-pay, 10 add-money, 5 withdrawals per user/action/minute and 100 per IP/action/minute. Counter RPC fails closed; user bucket always applies, IP only when VERCEL=1 and parsed by isIP. Snapshot had five expired counters, total relation size 65,536 bytes: no present storage emergency. No cleanup schedule or limit tuning added. Proposed maintenance: bounded indexed batches for counters expired well beyond active windows, not a full-table delete; verify query plan/cron access first. IPv6 canonicalization should preserve address identity and avoid subnet aggregation without customer/traffic evidence. Cloudflare is present on the public hostname; Vercel's documented overwriting of X-Forwarded-For protects against basic spoofing but may expose proxy IPs. No blind switch to attacker-controlled headers.

**CSP inventory and proposal:** baseline remains object-src none, base-uri self, frame-ancestors none; nosniff, DENY, referrer policy, HSTS and disabled camera/mic/location verified on preview. App script bundles/fonts/assets are same-origin; Supabase browser auth/data uses the project origin; ui-avatars.com supplies recent-order avatars; account avatars may use OAuth-provided URLs. Telegram is navigation, not a script source. UID provider domains are server-side and do not belong in browser connect-src. Inline style attributes exist in payment/account flows. No eval/unsafe HTML or next/og use was found in inspected app/components/lib source.

Installed Next.js guide requires dynamic rendering for nonce CSP; the build currently prerenders UI pages. A safe strict rollout therefore needs structural/rendering and inline-style changes, plus authenticated browser coverage. Candidate design: fresh request nonce through proxy and dynamic root rendering; script-src self nonce/strict-dynamic without production unsafe-eval; style-src nonce after removing style attributes (or explicitly separate style-src-attr during transition); connect-src self and exact Supabase HTTPS/WSS origin; img-src self/data/blob and verified avatar origins; font-src self; object-src none; base-uri self; form-action self; frame-ancestors none. Preview toolbar allowances must remain preview-only. Validate login/OAuth/recovery, hydration/navigation, avatar/payment UI and API traffic in report-only mode before enforcement. **This is a reviewed proposal, not a browser-tested strict policy; strict CSP remains deferred.**

**Dependencies:** minimal security patch only, installed with --ignore-scripts; no forced/major upgrades. Lockfile v3 uses registry.npmjs.org URLs with integrity fields; no unexpected nonregistry dependencies. Declared install script: unrs-resolver postinstall delegates to napi-postinstall for native package preparation. Registry signatures/attestations passed. Optional Supabase 2.117.1 and React/TypeScript/ESLint major upgrades were not applied. npm audit alone missed the advisory, hence direct upstream review.

**Repository hygiene:** .env.local, .next, node_modules, .vercel and tsbuildinfo are ignored. .env.example contains empty credential placeholders. Tracked backup/audit-logger.ts.bak is obsolete-looking source, not a detected credential dump; retained as history. Empty schema backup and initial schema migration cannot establish historical live schema. No new dump/archive/debug output committed; private audit artifacts kept outside repository.

## 7. Deferred items and verification limits

- Historical financial correction: no candidate proven; manual evidence required, not permission to infer a balance change.
- Authenticated browser login/session, admin dashboard data, Activity Log pagination/email/UUID/action/target/details/IP search and role-specific Activity Log rejection: **not verified live**. Browser tool failed initialization; no authenticated app session was available. Isolated RBAC tests do not substitute for these checks.
- Public custom domain requests hit a Cloudflare 403 challenge. This is not an app 403 or a successful acceptance test. Preview/origin CLI checks use Vercel deployment access, not an application login.
- Strict CSP, remaining important nonfinancial audit transactions, IP/proxy normalization and counter cleanup remain follow-ups.
- Leaked-password protection upgrade requires explicit billing approval. No upgrade was purchased.
- No real order, withdrawal, refund, wallet adjustment or add-money approval was used for production testing.

## 8. Production state

Application code commit `ed5fc89fa257c6fec0acaca559dc3405b10e24fd` passed preview and was fast-forwarded/pushed to main. Vercel production `bd21topup-2yv765qkk-ekbotix.vercel.app` was read back as READY for that exact SHA. Database migration `20260924165709_atomic_admin_role_audit` is applied and verified. Six unauthenticated protected production-origin APIs returned 401 through the linked Vercel CLI. The public Cloudflare hostname and authenticated browser flows remain unverified.

- **Actually applied:** role-audit database function; no financial data changes.
- **Actually deployed application:** atomic role-audit endpoint, bulk completion column fix, Next.js/eslint-config-next 16.3.6; exact code SHA and READY deployment above.
- **Documentation:** this report, handoff, problem/solution log and refreshed commit history are being committed separately; no further application changes are part of that documentation commit.
- **Local only:** private finance evidence and redacted scanner artifacts outside the repository.
- **Proposed only:** strict CSP rollout, broader nonfinancial atomicity, counter retention/proxy normalization.
- **Requires approval:** any paid-plan change, destructive history rewrite, or real-money acceptance test.
- **Intentionally deferred:** ambiguous financial corrections and blocked authenticated browser checks.

User explicitly stopped further audit work and requested a Markdown handoff plus GitHub history/problem-solution documentation. No further hardening is to be inferred from this report. Continue only in a new authorized session, using `NEXT_AUDIT_HANDOFF.md`.

Final code-history rescan: 314 reachable commits / 315 including reflog; Gitleaks reported 298 patch-bearing commits and no findings. This includes the new application commit; documentation-only publication follows this scan.

## Sources

- [Next.js ImageResponse advisory](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j)
- [Supabase password security and Pro requirement](https://supabase.com/docs/guides/auth/password-security)
- [Vercel forwarded request headers](https://vercel.com/docs/headers/request-headers#x-forwarded-for)
- [Gitleaks source and usage](https://github.com/gitleaks/gitleaks)
- Installed Next.js docs: `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` and route-handler guide, read before edits.
