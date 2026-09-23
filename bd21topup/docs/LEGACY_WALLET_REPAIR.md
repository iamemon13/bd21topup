# Proven legacy wallet history repair — applied and verified

Migration: `20260923190652_reconcile_proven_legacy_wallet_order_history.sql`.
Production project: `cnjkxbosjdahbyjtqbyj`.
After preparation and isolated dry-run, the user explicitly approved production application.
Supabase applied only this migration as version `20260923190652`.
The local filename now matches the remote version. SQL content is unchanged from the
approved draft; its preparation comment and repair marker `20260923185848` are retained
to preserve the exact applied statement and row provenance.
No deployment, commit, or push was performed.

## Production verification

Preflight: 2026-09-23 19:06:46 UTC. Postflight: 2026-09-23 19:07:04 UTC
(2026-09-24 01:07 Bangladesh time).

- All seven targets have exactly one matching canonical debit, total 1509 BDT.
- Both wallet balances stayed 891 and 610; affected-user ledger count rose from 2 to 9.
- Global missing canonical wallet debits fell from 35 to 28.
- Before/after hashes matched for every pre-existing row in all five reviewed tables:
  111 ledger rows, 114 orders, 10 profiles, 19 withdrawals and 37 add-money requests.
- Total ledger rows rose from 111 to 118, with exactly seven additions and zero
  changed or missing historical rows. Other reviewed table counts stayed unchanged.
- Remote migration history contains the new version exactly once.

Do not apply again: this is a deliberately guarded one-shot migration.

## Evidence and intended result

Read-only production preflight on 2026-09-23 at 19:01:36 UTC confirmed:
seven completed wallet orders, total 1509 BDT, zero linked ledger entries;
two affected accounts with balances 891 and 610; two original funding ledger rows;
zero withdrawals for these accounts. Global missing canonical wallet debits: 35.

- b5ffb675-4a9a-4bc6-8161-17eae9ddabfd: funding checkpoint 2000 minus six orders totaling 1109 = 891.
- c72627d1-e00a-49f2-bd3f-ab4aad852b0a: funding checkpoint 1010 minus one order of 400 = 610.
  The 1000 funding credit starts from a pre-existing 10; that initial 10 is outside this repair.

Historical wallet-pay route at 1d9338b / 52ac1ae deducted balance and inserted the
order before an unchecked ledger insert using type purchase. Current constraints
reject purchase. This explains the failure mechanism, but historical constraint
activation and deployment times are not independently established.

The explicit UUID/amount/time manifest is embedded in the migration and verification SQL.
Successful application adds only seven order_payment/debit entries; wallets remain
891 and 610. Missing canonical debits should fall from 35 to 28 if no other activity occurs.
The remaining ff05 account, withdrawals, refunds and add-money reversal pairs are excluded.

## Historical fields

created_at is copied from the original order to place repaired history in sequence.
balance_after is reconstructed from the recorded funding checkpoints and chronological
order amounts, not a contemporaneously observed balance. This provenance is marked
in each new description. The two 316 orders are approximately 0.77 seconds apart;
their aggregate deduction is supported, but intermediate balances are reconstructed.
New ledger UUIDs are generated; existing IDs and rows remain unchanged.

## Guards and operating impact

The entire repair is one atomic DO statement. A changed owner, amount, timestamp,
status, cancellation, wallet checkpoint, original funding row, extra ledger event,
withdrawal, or wallet-order count aborts it. Any linked ledger entry is rejected,
even if assigned to another user. Unexpected ledger triggers or rules also abort.
The postflight compares complete affected profile/order rows and original ledger rows.

A second execution deliberately fails; it never silently adds duplicates.
Do not weaken guards to accommodate new customer activity; investigate and revise
the evidence first. Do not delete history to make a rerun pass.

Because no database uniqueness constraint protects order ledger references, the
migration briefly takes SHARE ROW EXCLUSIVE locks on orders, profiles,
wallet_transactions and withdrawals. This blocks writes to those four tables,
including legacy writers, while ordinary reads continue. Lock acquisition times
out after 3 seconds. Schedule an approved application during low traffic; an
isolated PGlite test cannot validate production contention or Supabase roles/RLS.

## Verification performed

Run: `node --test tests/legacy-wallet-repair.test.mjs`.

The test uses installed PGlite (embedded PostgreSQL) with a minimal production-shaped
schema and observed financial fixture. It runs the exact migration and verification SQL.
It checks insertion count/amount/ownership/timestamps/reconstructed balances,
preservation of existing and unrelated data, explicit transaction rollback,
duplicate rerun rejection, changed balances/orders/funding, missing orders,
withdrawals, cross-user linked refunds, unexpected triggers, and all-or-nothing
rollback when the last target fails after earlier targets were inserted.

This is an isolated execution dry-run, not a production rollback experiment or a
full Supabase schema clone. During the dry-run phase no SQL INSERT was sent to production. CLI db push
--dry-run is not a substitute for executing the SQL and was not used.

## Application checklist (completed after explicit approval)

1. Review the migration and obtain explicit production approval.
2. Rerun scripts/verify-legacy-wallet-repair.sql read-only.
   Require orders_match, expected_profiles_match and preflight_targets_empty=true;
   target_count=7, target_amount=1509, affected_user_ledger_count=2,
   affected_user_withdrawal_count=0. Review funding anchors as guarded by the migration.
3. Review pending migration history. Apply only this approved migration through
   Supabase's migration mechanism; never run a broad push blindly.
4. Rerun the same verification SQL. Require postflight_targets_exact=true,
   expected_profiles_match=true, affected_user_ledger_count=9 and no new withdrawals.
   Each target must have exactly one matching repaired row.
5. Confirm preserved historical rows and balances against preflight evidence.
   Commit/push only after the separately approved production verification completes.

Do not use an automated delete/down migration. Any post-application discrepancy
requires a new evidence-led investigation.

References:
- https://github.com/iamemon13/bd21topup/blob/1d9338b/bd21topup/app/api/wallet-pay/route.ts
- https://supabase.com/docs/reference/cli/supabase-migration-new
