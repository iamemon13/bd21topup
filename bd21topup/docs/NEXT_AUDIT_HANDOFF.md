# BD21topup — handoff after user-requested stop

Updated 2026-09-24, Bangladesh time. The user explicitly asked this agent to stop remaining audit work, commit completed changes, and publish the history/problem-solution notes to GitHub. This file is for a new ChatGPT session. Do not interpret old TODOs as authorization to repeat completed work.

## Update — 2026-09-25: nonfinancial audit atomicity is now shipped

The "remaining work" item **#2 (Other important audit atomicity)** below was completed after this handoff was written. It is now on `main` and must no longer be described as deferred or proposed.

- Commit `5704d60` ("security: make nonfinancial admin audits atomic"), authored on branch `hardening/nonfinancial-audit-atomicity` and merged to `main` as `a019186` (merge commit of PR #6).
- Migration `supabase/migrations/20260924180051_atomic_nonfinancial_admin_audit.sql` adds three service-only, `SECURITY INVOKER` functions that each set `search_path = ''`:
  - `public.admin_update_package_audited(p_admin_id uuid, p_package_id uuid, p_name text, p_price numeric, p_ip text)`
  - `public.admin_update_order_status_audited(p_admin_id uuid, p_order_id uuid, p_expected_status text, p_next_status text, p_admin_note text, p_ip text)`
  - `public.admin_bulk_complete_orders_audited(p_admin_id uuid, p_order_ids uuid[], p_ip text)`
    Each re-checks the stored `admin_roles` role/permission inside the transaction and commits the mutation together with its `admin_audit_logs` row. The single order-status function additionally requires an `expected_status` state-machine predicate, so a stale status produces no mutation and no audit row.
    Privileges are `REVOKE ALL ... FROM PUBLIC, anon, authenticated` followed by `GRANT EXECUTE ... TO service_role` for all three signatures.
- Wiring: `app/api/admin/packages/route.ts` (PUT), `app/api/admin/orders/route.ts`, and `app/api/admin/orders/bulk/route.ts` call these RPCs. The actor is the verified token subject, never the request body. No best-effort `logAdminAction` call remains under `app/`.
- Tests: `tests/nonfinancial-audit-atomicity.test.mjs` (new) plus extended `tests/admin-audit-api.test.mjs`.
- Re-verified locally on 2026-09-25: `npm run typecheck` clean and `node --test tests/*.test.mjs` reported 82 passed, 0 failed.
- **Production verified:** migration `20260924180051_atomic_nonfinancial_admin_audit` was applied to the production Supabase project. The three RPCs were read back as `SECURITY INVOKER` with empty `search_path`, owned by `postgres`; `service_role` has EXECUTE while `anon` and `authenticated` do not.

Item #2 in the remaining-work list is retained with a completion note rather than deleted, so the original scope stays auditable.

## Project and current baseline

- Local application: `D:\Projects\bd21topup`; Git repository root: `D:\Projects` (tracked paths have `bd21topup/` prefix).
- GitHub: `iamemon13/bd21topup`; production: `https://topup.ekbotix.com/`.
- Supabase: `cnjkxbosjdahbyjtqbyj`, organization `joaeqmzrbzcwzpuohunw`, Free plan confirmed.
- Vercel: `prj_riOPtX7ShokApEVIHNT4tIIaSMJR`, scope `ekbotix`.
- Application commit: `ed5fc89fa257c6fec0acaca559dc3405b10e24fd`, merged/pushed to main by fast-forward.
- Exact production deployment verified READY: `bd21topup-2yv765qkk-ekbotix.vercel.app`.
- Preview verified READY: `bd21topup-8wgcljjqm-ekbotix.vercel.app`.
- A later documentation-only commit contains this handoff/report/history. Check current main and deployment before proceeding.
- **Superseding state (2026-09-25):** `main` is now at merge `a019186`, which includes the nonfinancial audit-atomicity work (commit `5704d60`, migration `20260924180051`). The `ed5fc89` commit listed above is the baseline this handoff was originally written against, not current HEAD.

Read `REMAINING_SECURITY_AUDIT_2026-09-24.md` for the full eight-section report, `PROBLEM_SOLVING_LOG.md`, current tests/migrations, then current live state. Preserve any unrelated working-tree edits.

## Completed — do not redo

1. **Role/permission audit atomicity:** `app/api/admin/role/route.ts` now calls `admin_update_role`. Applied migration **`20260924165709_atomic_admin_role_audit`**. SECURITY INVOKER, empty search_path, owner postgres, EXECUTE only owner/service_role. RPC rechecks Super Admin, validates input, blocks self-demotion, serializes calls, locks actor row, upserts role and inserts audit atomically. The endpoint retains bearer-token verification and Super Admin check. Existing service-role table permissions remain, so this does not prevent out-of-band service-key SQL writes.
2. **Bulk completion bug:** removed nonexistent `orders.updated_at` assignment. Live schema confirms no such column. Eligible status filter remains pending/approved/processing. No orders were changed to test this.
3. **Dependency security patch:** Next.js and eslint-config-next pinned to **16.3.6**. Official GHSA-vcvr-r3jv-pc5j / CVE-2026-94545 concerns Node ImageResponse with attacker-controlled SVG. No ImageResponse/next/og use found here; patch was defensive. `npm audit` alone reported zero before the upgrade too.
4. **History secret scan:** Gitleaks 8.30.1, official release checksum verified, fully redacted reports. All refs/tags fetched; non-shallow Git. Baseline 313 reachable commits / 314 incl reflog, all 546 unique historical blobs separately scanned, including merge/deleted content. Default rules found no historical secrets. Project-specific rules found only two historical fake browser-fixture token lines. Exact local secrets (including SIAMBHAU) absent from all blobs and client bundles. Current directory flagged only ignored `.env.local` credentials/public key and generated `.next` keys. Final code-history rescan: 314 reachable / 315 incl reflog; no findings. No rotation/history rewrite justified by these results. No OCR guarantee for raster assets or inaccessible/pruned remote objects.
5. **Supabase advisors and ACLs:** all prior 20 migrations confirmed; now 21 with role RPC (**22** after the 2026-09-25 nonfinancial migration `20260924180051`). All 12 public tables RLS enabled. Financial wrapper/legacy ACLs preserved. Advisors unchanged after migration: eight intentional server-only RLS-no-policy INFOs, three unused-index INFOs, leaked-password protection WARN.
6. **Financial investigation:** all 44 candidates queried without mutation, with nearby ledger/funding/withdrawal and audit/support correlation. None met repair-proven standard. Private details kept off public GitHub.
7. **Nonfinancial audit atomicity (added after this handoff was written):** commit `5704d60`, merged as `a019186`; migration `20260924180051_atomic_nonfinancial_admin_audit.sql` makes package updates and single/bulk nonfinancial order transitions commit the mutation and its audit entry atomically. See the update section above. Only the production-application check of that migration remains outstanding.

No balances, wallet history, orders, withdrawals, add-money records, short external transaction IDs, financial RPC privileges, or paid plans were changed.

## Tests and acceptance already run

- `node --test tests/*.test.mjs`: **71/71 passed**, including financial tests and 16 new role/bulk tests.
- TypeScript, focused ESLint, Next.js 16.3.6 production build and git diff --check passed.
- `npm audit`: zero reported vulnerabilities.
- `npm audit signatures`: 369 verified registry signatures, 95 verified attestations.
- Live new RPC exercised as service_role in BEGIN/ROLLBACK, using the same existing Super Admin role and checking audit insertion; no persistent mutation.
- Preview root 200 and baseline security headers present. Six protected read-only APIs returned 401 unauthenticated on preview and production origin via Vercel CLI: account, transactions, order history, admin role, admin activity, dashboard.
- Public custom-domain requests met Cloudflare 403 challenge, not app authorization. Direct deployment redirects through Vercel protection unless accessed through linked CLI.
- Browser automation failed initialization (`failed to write kernel assets`); authenticated UI/session checks were **not** completed. Do not claim dashboard data/search/pagination/login acceptance passed.
- `vercel link` linked local `.vercel` state and refreshed ignored local OIDC configuration. CLI generated deployment-protection bypass access internally; no values were printed. Do not expose local credentials.
- **Rerun after the nonfinancial work (2026-09-25):** `node --test tests/*.test.mjs` → **82/82 passed**, and `npm run typecheck` clean. The 71/71 figure above is the earlier baseline from the role-audit session.

## Private financial evidence (not committed)

Local directory: `C:\Users\Emon Khan\.codex\audits\bd21topup-20260924\`.

- `finance-review.md`: per-candidate table with all 44 cases.
- `finance-evidence.json`: minimized exact evidence, no names/phones/external payment IDs/secrets.
- Redacted scanner reports, scanner configuration and `scan.py` also live there.
- Committed read-only query: `scripts/review-historical-finance.sql`.

If a new ChatGPT session cannot access the private files, rerun the read-only query through authorized Supabase access. Do not publish customer evidence in this public repository.

### Historical findings to preserve

- **28 missing canonical wallet-order debits**, user `ff05ca06-1160-4b59-bc22-32805a11dac6`, total **BDT 5830**, observed current balance **BDT 9944**. Do NOT deduct 5830 or insert 28 rows blindly.
- `1d9338b`/`52ac1ae` deducted first, then unchecked type `purchase` insert; current live constraint rejects that type. Git timestamp is not production activation proof. Overlapping withdrawals/adjustments make balance reconstruction ambiguous.
- **13 withdrawal gaps out of 19**. `65c1287` deducted on approval, then unchecked type `Withdrawal` insert without reference_id; earlier versions varied. Withdrawal created_at is not approval timestamp. Rejected approval-time requests may correctly have no debit.
- **Three completed/refunded orders**, total **BDT 352**: `7615e799-bb1a-44b5-b860-7aab0e100ff1` (158), `7e5234c3-46dc-43e7-867e-f9534630a4dd` (158), `e9c405ea-2b33-4565-b14e-086413306150` (36). Original debits and equal refunds exist; no matching audit/support evidence. Classification: insufficient evidence, possible historical status inconsistency. Preserve refunds/balances.
- All 44 candidates have no matching admin audit; eight have later support-case matches, which are not contemporaneous proof.

## Remaining work — not performed after the stop request

1. **Authenticated read-only acceptance:** login/session, account/history, admin dashboard, Activity Log pagination and partial/full email, UUID, action, target/details/IP searches; verify admin/editor cannot access Super Admin-only APIs. Use a legitimate existing session, never request tokens/passwords in chat. No real-money testing without explicit approval.
2. ~~**Other important audit atomicity:** package updates and nonfinancial single/bulk order transitions still use best-effort logAdminAction. Consider focused SECURITY INVOKER transactions, retain state predicates and authorization; no blanket SECURITY DEFINER conversion. Support admin endpoint is read-only.~~ **COMPLETED 2026-09-25** — shipped as commit `5704d60` / merge `a019186`, migration `20260924180051_atomic_nonfinancial_admin_audit.sql`; see the update section at the top. The support admin endpoint remains read-only, as stated. Production application and RPC ACLs were subsequently verified.
3. **Strict CSP:** current minimal policy intentionally unchanged. Installed Next.js guide requires dynamic rendering for nonce CSP; UI is currently static. Inventory includes exact Supabase browser origin, ui-avatars.com and OAuth avatars, inline payment/account styles, same-origin fonts/scripts. UID providers are server-side; Telegram navigation does not need script/connect allowlists. Need report-only preview and authenticated browser tests before enforcing strict directives. Full proposal is in audit report and is not yet browser-tested.
4. **Rate-limit follow-up:** counter snapshot five expired rows / 64 KiB, not urgent. Plan bounded expired-counter retention, IPv6 canonicalization and actual proxy validation. Cloudflare may aggregate Vercel IP buckets; Vercel documents overwriting X-Forwarded-For. Do not blindly trust CF headers, tighten existing limits, or group IPv6 subnets without traffic/false-positive evidence.
5. **Leaked-password protection:** Free plan confirmed, managed feature requires Pro+. Explain benefit and obtain explicit billing approval before upgrade. Password managers/unique passwords/OAuth are free mitigations; client-side breach checks are bypassable and not equivalent enforcement.
6. **Historical cases:** obtain original provider receipts/admin/support records, deployment activation times and balance snapshots. No candidate currently authorizes a repair. Distinguish missing history from wrong current balance.
7. **Short historical transaction IDs:** preserve valid old IDs/credit-reversal pairs; any compatibility issue with newer NOT VALID constraints requires independent evidence and tests.
8. Optional dependency updates are not mandatory security fixes. No force audit fix or major upgrade. Scanner limitations include image OCR and pruned/unfetched history.

## Safety and next-session rules

- Start from current main; inspect live migration history/function/ACL before any schema change. Never reapply completed migrations.
- Never print secret values or ask the user to paste keys, passwords, access/refresh tokens or SMTP credentials.
- Never reset/truncate production, bulk-repair ambiguous finance, rewrite customer IDs, disable RLS or grant privileged RPCs to browser roles.
- Preserve service-role access to process_wallet_payment/process_withdrawal; legacy six admin RPCs must remain denied and financial wrapper service-only.
- For code changes run typecheck, touched-file ESLint, relevant tests, build, diff check; verify preview before merge.
- Any financial correction must prove exact event, amount, balance treatment, idempotency and rollback plan. Missing canonical ledger rows alone are insufficient.
- Report deployed vs local/proposed/deferred precisely. Do not call the full audit complete while these items remain.
