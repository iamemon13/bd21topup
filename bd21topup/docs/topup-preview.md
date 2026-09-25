# Supplier command preview — Phase 1

This feature generates and copies commands. It never sends commands, reserves an
order, creates dispatch jobs, changes status, or moves money. External payments,
FF Likes, and Indonesia Server remain manual. No supplier credentials are used.

## Trust boundaries

- POST `/api/admin/orders/topup-preview` accepts only `{ "orderId": "<uuid>" }`.
- `checkUserRole` authenticates the bearer token and requires `manage_orders` for
  admin/editor, or super-admin. Actor identity is never accepted from the client.
- The route obtains the actor ID only from `auth.getUser(access_token).user.id` and
  passes it to the service-role RPC. No request body field, query parameter or
  client-controlled header can override `p_admin_id`; the service-role key remains
  server-only.
- The server-only `bd21-kaium-v1` manifest contains exactly 37 owner-approved UUID,
  exact-name, category and ordered-operation bindings. Prices and `code_name` are
  never used for command selection. The manifest is not in the client bundle.
- Only pending wallet orders with a customer and null `cancelled_at` qualify.
  Stored UID must contain exactly 5–15 ASCII digits, with no trimming or repair.
- All ledger types for the order reference are considered. Exactly one row must
  exist: `order_payment`, debit, same customer and same positive amount. Additional
  rows, refunds, missing evidence and mismatches require manual review.
- A current catalog row must resolve uniquely and match the manifest's UUID,
  exact name and category. Historical orders are not updated or backfilled.
- Commands are generated in memory, then the audit RPC rechecks authorization and
  the source snapshot before an API success can expose them. Errors return stable
  codes and never return commands. All preview responses are private/no-store.

## Production migration approval — NOT APPLIED

Exact migration: `supabase/migrations/20260925062427_add_topup_preview_audit.sql`.

It adds only `public.admin_audit_topup_preview`, a SECURITY INVOKER function with
an empty search path and fully qualified table references. It creates no tables,
triggers, dispatch objects, or historical data. The existing schema was inspected
using SELECT queries before authoring it.

Purpose: a successful preview must have a committed audit entry, and the database
must recheck permission and the order/package/evidence used to generate it. Shared
locks on the role, order and package serialize with the current role-change,
order-cancellation/completion and package-edit paths. The audit insert and these
checks run in one transaction. Current wallet cancellation locks the source order
before creating refund evidence. Arbitrary privileged out-of-band ledger writes
are not a supported concurrency path.

Privileges: EXECUTE is revoked from PUBLIC, anon and authenticated; EXECUTE is
granted only to service_role (the function owner retains its inherent access).
No table privileges are added. Service role already has the SELECT/row-lock
privileges and audit INSERT privilege needed by this invoker function.

Only mutation inside the function: INSERT into `public.admin_audit_logs`, with
TOPUP_PREVIEW, verified actor, order/package IDs, mapping version, operation count,
SHA-256 command hashes, debit reference and generation timestamp. No full commands,
UIDs or supplier credentials are stored in audit details. Audit failure aborts the
RPC and prevents an API success. A committed audit with a lost HTTP response means
the preview was generated, not that it was received/copied/sent.

Before approval, the API safely returns AUDIT_UNAVAILABLE for otherwise eligible
orders because the RPC is absent. Do not bypass this check to enable previews.

Rollback: disable/remove the preview UI/API first, then drop only this exact function:

```sql
DROP FUNCTION public.admin_audit_topup_preview(uuid,uuid,uuid,text,uuid,numeric,text,text,uuid,text,text[],text);
```

Rollback leaves existing audit history intact. No financial/order restoration is
needed because this migration and function do not modify those records.

## Snapshot limitations

The preview is valid at audit time. It is not a reservation or payment-provider
verification and does not prevent a later cancellation, completion, permission
change, or someone sending a copied command twice. Phase 1 must not be reused as
a dispatch implementation. Future dispatch needs supplier-aware idempotency,
durable operation outcomes and explicit handling of unknown/partial outcomes.

## Validation

- `node --test tests/topup-preview*.test.mjs`
- `node --test tests/*.test.mjs`
- `npm run typecheck`, `npm run lint`, `npm run build`
- Start a local production server on port 3100, then run
  `node tests/topup-preview-browser.mjs <agent-browser executable>`.

Browser tests use only fake auth and intercepted APIs. They do not invoke the
production preview RPC. Screenshots go to ignored `.next/topup-preview-ui/`.
Mapping fixture expectations were transcribed from the owner's supplied brief.
Database tests use isolated in-memory PGlite, compare all source/financial tables
before and after preview, and inject audit failures. Existing tests are not weakened.

Known pre-existing full-suite issue: `tests/financial-audit.test.mjs` creates
`admin_roles` and `admin_audit_logs` after its shared `support-schema.sql` fixture
already creates them; its setup fails with SQLSTATE 42P07. This phase does not
modify that unrelated fixture/setup.

Validation results for this implementation:

- 150 new unit/API/database cases passed, including all 37 exact command fixtures.
- 252 cases passed in the relevant regression run excluding the pre-existing
  broken financial-audit setup. The full-suite run before the final five list-hint
  tests reported 247 passes and the same 14 setup failures.
- Mobile (390px) and desktop (1280px) browser checks passed: ordered commands,
  individual/all copy, clipboard failure, eligibility failure, duplicate-request
  loading guard, manual states, and preview-only warning. APIs were mocked.
- Typecheck and production build passed. Lint passed with three pre-existing
  no-img-element warnings. `git diff --check` passed.
- Built client chunks contain neither the mapping version constant nor an
  approved supplier package UUID; the manifest remains server-only.
- No production migration or preview RPC was invoked. No Telegram/supplier
  interaction, wallet/order mutation, commit, push, or PR occurred.

Files changed by this phase (pre-existing package.json/package-lock.json/tsconfig.json
changes were left untouched):

Modified:
- `app/admin/orders/page.tsx`
- `app/api/admin/orders/route.ts`
- `tests/admin-audit-api.test.mjs` (load the new server dependency; assertions unchanged)

Added:
- `app/api/admin/orders/topup-preview/route.ts`
- `components/TopUpPreviewActions.tsx`
- `components/TopUpPreviewDialog.tsx`
- `lib/topup-mappings.ts`
- `lib/topup-preview.ts`
- `lib/topup-preview-types.ts`
- `supabase/migrations/20260925062427_add_topup_preview_audit.sql`
- `tests/topup-test-helpers.mjs`
- `tests/topup-preview.test.mjs`
- `tests/topup-preview-api.test.mjs`
- `tests/topup-preview-database.test.mjs`
- `tests/topup-preview-browser.mjs`
- `tests/fixtures/topup-mappings.json`
- `docs/topup-preview.md`
