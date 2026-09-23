# BD21topup — continue from this handoff

Updated: 2026-09-24 Bangladesh time. Read this file and current git/live state first.
User requested urgent work only due to low usage quota, then a Markdown handoff.
User has authorized remaining audit work, commits/pushes and deployment, but financial
corrections still require strong evidence. Never blindly alter balances or history.

## Project
- Local application root: D:\Projects\bd21topup (do not prepend bd21topup to local paths).
- Git repository has this app under the tracked bd21topup/ prefix; git show paths need that prefix.
- GitHub: https://github.com/iamemon13/bd21topup
- Production: https://topup.ekbotix.com
- Supabase: cnjkxbosjdahbyjtqbyj, organization joaeqmzrbzcwzpuohunw (FREE plan).
- Vercel project prj_riOPtX7ShokApEVIHNT4tIIaSMJR, scope ekbotix.
- Vercel connector list_teams returned empty; get_project tool has a schema mismatch.
  CLI is authenticated as iamemon13: npx --no-install vercel project ls --filter bd21 --json works.
- Next.js 16.3.5. Read relevant node_modules/next/dist/docs before code changes.
- Supabase/Next.js/Vercel skills were used. No subagents were used.

## State at creation of this handoff — READ THE FINAL STATUS BELOW TOO
- main; f46a3bf commits the already applied seven-order repair plus its tests/report.
- Additional urgent hardening changes are local and tested; initially not yet applied/deployed.
- Do not mistake a migration file's presence for production application.
- Recheck git status, git log, live migration history and Vercel deployment before continuing.

## Completed production financial repair
Applied through Supabase migration tool:
20260923190652_reconcile_proven_legacy_wallet_order_history
- Exactly seven canonical order_payment/debit ledger entries inserted, total BDT 1509.
- b5ffb675-4a9a-4bc6-8161-17eae9ddabfd: 2000 - 1109 = 891 unchanged.
- c72627d1-e00a-49f2-bd3f-ab4aad852b0a: 1010 - 400 = 610 unchanged.
- Missing canonical wallet debits fell 35 -> 28.
- All pre-existing row hashes preserved: 111 ledger, 114 orders, 10 profiles,
  19 withdrawals, 37 add-money requests. Ledger became 118 rows.
- Seven repaired orders and detailed evidence: docs/LEGACY_WALLET_REPAIR.md.
- Read-only verification: scripts/verify-legacy-wallet-repair.sql.
- 11 tests: tests/legacy-wallet-repair.test.mjs.
- SQL is deliberately one-shot; rerun aborts. Do not reapply or delete repaired rows.
- SQL marker 20260923185848 remains original preparation ID; filename uses actual remote version.
- balance_after is reconstructed, created_at copied from order time; descriptions disclose this.

## Urgent hardening implemented locally
Initial migration file:
supabase/migrations/20260923191844_harden_financial_audit_and_access.sql
(May be renamed to actual remote timestamp after application; see final status.)
1. service_role loses UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on admin_audit_logs.
   SELECT/INSERT retained. Other code only reads/inserts audit logs.
2. New service-only admin_financial_action RPC checks stored admin_roles permissions,
   calls existing locked financial RPCs, and inserts audit log in the same transaction.
   Audit failure rolls back the financial mutation.
   Operations: wallet adjustment, withdrawal review, order cancel, add-money review/undo.
   Single and bulk routes updated via lib/financial-audit.ts.
   Withdrawal review additionally requires matching canonical original debit and no reversal.
3. Four missing FK indexes: admin_audit_logs.admin_id, notifications.user_id,
   orders.user_id, withdrawals.user_id.
4. Existing owner SELECT policies on profiles/withdrawals use (select auth.uid()).
   Preserve server-only RLS tables without permissive policies.
5. lib/financial-rate-limit.ts uses existing check_uid_rate_limit PostgreSQL locked counter;
   no process-local memory. Authenticated user + action bucket; Vercel trusted IP +
   action bucket; identifiers SHA256 hashed, finance: prefix.
   Limits per 60 seconds: orders 15, wallet-pay 15, add-money 10, withdraw 5; IP 100.
   Verified stored historical per-user/minute peaks: orders 3, add-money 3, withdraw 1.
   This is successful-history evidence, not complete traffic logs.
   429 + Retry-After 60; DB failure/malformed response -> fail closed 503.
   Outside Vercel user bucket enforced, forwarded IP not trusted.
6. next.config.ts: nosniff, referrer policy, DENY frame, permissions camera/mic/location
   disabled, production HSTS one year, hide X-Powered-By.
   Minimal enforced CSP: object-src none; base-uri self; frame-ancestors none.
   This is NOT a complete nonce-based script CSP.
7. Existing support DB test referenced a stale migration filename; fixed path.
8. Removed pre-existing any annotation in touched admin add-money map (types infer now).

## Validation already completed
- Typecheck passed.
- Focused eslint passed after fixing touched-file issue.
- 13 financial-audit DB tests passed: audit rollback, permissions, wallet adjustments,
  add-money approve/reject/undo, withdrawals approve/reject, missing-debit rejection,
  cancellation/refund, RLS isolation and DB rate counter reset.
- 8 financial-rate-limit/API tests passed: identity hashing, IP/action buckets, 429/503,
  verified-user derivation, no writes when blocked, unauthorized requests rejected.
- 22 existing support API/DB tests passed.
- Legacy repair's 11 tests passed in preceding turn.
- Production build running when handoff was first written; see final status.
- No authenticated real-money operation was made solely for production testing.
- PGlite tests are isolated PostgreSQL fixtures, not concurrent live DB tests.

## Deployment sequence / crucial follow-up
1. Finish production build, review git diff.
2. Apply only hardening migration after checking live permissions/policies/index names.
3. Rename local migration file to returned Supabase version, update DB test path.
   Do not modify applied SQL content.
4. Commit/push tested app changes; inspect production Vercel build and headers/401 APIs.
5. Legacy underlying admin RPCs initially retain service_role EXECUTE for rollout
   compatibility. Once new app deployment is confirmed, create a SECOND migration
   revoking service_role EXECUTE on the old entrypoints. The SECURITY DEFINER wrapper
   can still call them as owner. Revoke PUBLIC/anon/authenticated too after checking ACLs.
   Signatures:
   admin_adjust_wallet(uuid,numeric,text,text)
   admin_review_withdrawal(uuid,text,text)
   admin_review_add_money(uuid,text,text)
   admin_undo_add_money(uuid,text)
   admin_cancel_order(uuid,text)
   admin_cancel_order_with_refund(uuid,text)
   Do NOT revoke process_wallet_payment or process_withdrawal; customer APIs need those.
   Verify wrapper roles and execution after this change, rerun dry-run tests.
6. Run Supabase advisors post-DDL; report informational unused indexes accurately.

## Deferred work — do not call the full audit complete
### Historical finance
- 28 missing wallet-order ledger debits, all user ff05ca06-1160-4b59-bc22-32805a11dac6,
  total BDT 5830; current observed wallet 9944. Classified manual review, not auto-repair.
- 19 withdrawals, 6 canonical debits, 13 gaps; historical logic changed between no
  deduction/request-time/approval-time. Do not insert 13 debits automatically.
- 3 completed wallet orders also refunded, total BDT 352:
  7615e799-bb1a-44b5-b860-7aab0e100ff1 (158)
  7e5234c3-46dc-43e7-867e-f9534630a4dd (158)
  e9c405ea-2b33-4565-b14e-086413306150 (36)
  Refunds occurred Sep 9 17:36:24, 17:31:08, 17:28:30 UTC respectively.
  Current status completed, cancelled_at null; no matching admin audit records.
  Historical bulk completion could overwrite status; cannot establish who/when.
- Preserve add-money credit/reversal pairs: 10=3 credits/2 reversals,
  12=2/1, 399=4/3, 2000=2/1. Their net results are valid.
- ff05 timeline:
  Sep11 2673 -79 -158 +558=2994; -237 +237=2994; -338 +106=2762.
  Sep13–17 3500 -216 +100=3384, overlapping withdrawal requests.
  Sep17 3484 -1633 +399=2250, overlapping approved withdrawals 201.
  Sep17–18 1851 -180 +399=2070.
  Sep18 1700 -1023 +237=914; +400=1314.
  Later sequence requires separate withdrawal deductions; wallet reaches 982.
  Earlier unexplained 19 gap Sep2; 700 gap Sep18; external refund corrections 8022
  share one timestamp; sorting timestamps alone cannot recover order.
- Code: 1d9338b/52ac1ae wallet-pay deducted balance, inserted order, then unchecked
  type purchase ledger insert. Live constraint rejects purchase.
  3aaa789/5f69ac9 earlier pay_with_wallet RPC body unavailable; 5f69ac9 also reset
  latest order status to pending. 8b1b13c switched atomic RPC.
  65c1287 withdrawal approval deducted balance and attempted unchecked type Withdrawal
  ledger insert without reference_id. Request created_at is NOT deduction time.
- Initial schema and bd21_schema_backup.sql are zero bytes. Historical constraint/
  deployment activation dates are not proven from Git.

### Security / operations remaining
- Secret scan of CURRENT TREE AND ALL GIT HISTORY not completed. Never print secret values.
  If active secret found: rotate/revoke first, update deployment env, then consider
  history cleanup; no destructive reset/rewrite without careful scope.
- npm audit reported ZERO vulnerabilities. npm outdated found optional updates:
  supabase-js 2.116.0->2.117.1, next 16.3.5->16.3.6, eslint-config-next 16.3.3->16.3.6.
  React/TS/ESLint major/minor jumps are NOT needed just to clear outdated output.
  No dependency updates made; never npm audit fix --force.
- Supabase leaked-password protection disabled. Org is FREE; feature requires Pro+.
  Do not silently buy/upgrade plan. Explain limitation or revisit when plan changes.
- Security advisor INFO: 8 RLS tables without policies are intentional server-only:
  add_money_requests, admin_audit_logs, admin_roles, api_rate_limits, notifications,
  orders, uid_cache, wallet_transactions. Do not add permissive policies to silence.
- Full script CSP needs browser inventory and nonce/static-rendering decision.
  External resources include Supabase, ui-avatars.com, Telegram links; UID providers
  called server-side: siambhau69.eu.cc, goxtop.com, apis.ffbazar.com.
- Rate counter cleanup/retention, IPv6 normalization and operational limit tuning
  merit review. Existing counters reused; no cleanup schedule added.
- Nonfinancial status/role/package audit remains best-effort; critical financial
  paths moved to wrapper. Review other mutations separately if expanding scope.
- Preserved historical 3-char external transaction IDs (ttt, gyy, 677, yuu) must not
  be rewritten. NOT VALID length constraint rejects short IDs on future row updates;
  investigate compatibility for admin operations without weakening new payment validation.
- Genuine authenticated browser acceptance tests not run on production to avoid
  creating financial traffic. Use staging/test accounts for further end-to-end tests.

## Rules for the next AI
Read current files and live state. User authorization persists, but evidence still
controls financial changes. Never expose service keys/tokens/passwords. Never db reset,
delete history, rewrite transaction IDs, blindly adjust balances or bulk-fill gaps.
Do not push unrelated edits. Always finish with what is actually deployed vs deferred.

## Final status — 2026-09-24

Financial hardening rollout is now complete.

- Production app hardening commit deployed successfully:
  `0650bc0d85862a1d31fff3185d87faf4dedcf6f8`
- Supabase migration applied:
  `20260923191844_harden_financial_audit_and_access`
- Legacy direct admin financial RPC entrypoints were closed with:
  `20260923193817_close_legacy_admin_financial_rpc_entrypoints`
- Repository sync commit:
  `2550a2c4bd2b8b51b8a0a68581081c4244fca47f`
- Vercel deployment for the final repository commit succeeded.
- Financial audit test suite: 14/14 passed.
- TypeScript typecheck passed.
- Verified:
  - service_role can execute `admin_financial_action`
  - service_role cannot directly execute the six legacy admin financial RPCs
  - anon/authenticated cannot execute those privileged RPCs
  - `process_wallet_payment` and `process_withdrawal` remain available to service_role
  - audited wrapper operation was verified inside a rollback transaction, leaving no test balance/history changes

The deployment sequence described earlier in this handoff is now historical and should not be repeated.

The broader audit is still not declared fully complete. Deferred historical finance cases remain manual-review only, and a complete secret scan across all Git history remains outstanding. Do not automatically repair ambiguous historical balances or ledger gaps.
