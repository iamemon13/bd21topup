# Support Cases

Implemented on `feature/secure-support-cases`, based on `c8211c4`.

## Database and security

Apply `supabase/migrations/20260922135323_secure_support_cases.sql` only after explicit production approval. The migration is transactional and additive. It creates `support_cases`, a private function schema, triggers, indexes, and a nullable notification FK. It does not modify financial RPCs, balances, or existing operation rows.

- Orders in `cancelled` or `rejected`, and add-money/withdrawal requests in `rejected`, receive a case in the same transaction as the status change. Single and bulk flows are covered.
- One unique FK per operation prevents duplicate cases. A check enforces exactly one source of the correct type. Source validation checks ownership and eligibility and derives the reason from the source's `admin_note`.
- IDs such as `BD21-ORD-8A4B7C2D9E1F` use a random 12-character uppercase hexadecimal suffix. A unique constraint plus bounded retry handles collisions. They are references, never authorization tokens.
- Authenticated clients have only SELECT with `auth.uid() = user_id` RLS. Anonymous users have no access. Clients cannot mutate cases or execute private helper functions. Helpers are security invokers with an empty search path; existing trusted financial RPCs execute them within their transaction.
- Case identity and the original reason are immutable. Status has `open`, `resolved`, and `closed` values, with timestamps, but this release intentionally has no status mutation endpoint or service-role UPDATE grant.
- Notification creation is atomic with case creation. A unique `support_case_id` allows exactly one linked support notification. Existing notification text is not parsed or guessed for ownership.
- Historical eligible records are backfilled with new cases and notifications. Anonymous/deleted-user orders are skipped. The case creation timestamp records when the case was created, not the original operation timestamp. Existing notifications remain; users can see a separate support notification alongside an earlier rejection notification.
- Reading a case, copying an ID, and opening Telegram cannot issue a refund. The withdrawal rejection's existing automatic refund remains inside its original RPC.

User APIs use `auth.getUser(accessToken)` and filter by the returned user ID. Their support payload contains only public ID, case status, reason, and contact URL. Internal support row IDs are removed before returning notifications. Support queries page through PostgREST results so older references are not silently dropped. Successful history/notification responses explicitly use `Cache-Control: private, no-store` and `Vary: Authorization`; admin support lookup uses these headers on both success and error responses.

`GET /api/admin/support-cases?supportId=...` uses the existing `checkUserRole` before lookup. ORD requires `manage_orders`, ADD requires `manage_add_money`, WDR requires `manage_withdrawals`; existing super-admin rules apply. There is no public lookup endpoint. `/admin/support-cases` is linked from the admin dashboard. Authorized staff receive the related operation ID to locate it in the existing admin list; users do not receive additional internal IDs.

## Telegram support workflow

The existing repository destination is `https://t.me/BD21Support`. No new secret is needed.

Optional server environment variables, also listed in `.env.example`:

```dotenv
SUPPORT_TELEGRAM_USERNAME=BD21Support
SUPPORT_TELEGRAM_MODE=chat
```

The default `chat` mode opens the configured account with a draft containing the Support ID and a Bengali receipt/screenshot message. The user sends the draft and attaches the evidence in Telegram. Support staff use the authenticated admin lookup, ask for the receipt/screenshot, and verify the account and original operation before using any existing financial workflow. A Telegram identity or a matching Support ID alone is never ownership proof.

For a separately managed Telegram bot, set a public bot username and `SUPPORT_TELEGRAM_MODE=bot`. The link passes the reference as `/start BD21-...`. The external bot must handle that payload and prompt for a receipt/screenshot. This repository does not contain or deploy a Telegram bot, webhook, token, or Telegram-to-account identity binding. Do not enable bot mode until that external handler is configured. Do not return private case details to a Telegram sender merely because they know an ID.

Invalid configuration disables the contact link while leaving copy/reference access available. Supported Telegram [public username links and draft text](https://core.telegram.org/api/links#public-username-links) and [bot deep links](https://core.telegram.org/bots/features#deep-linking) follow Telegram's documented format. Clipboard failure is handled with a Bengali manual-copy message.

## Local validation

```powershell
npm run test:support
npm run typecheck
npm run lint
npm run build
```

Database tests run in PGlite, an isolated in-memory PostgreSQL instance, with fake users and a minimal schema fixture. The add-money/withdrawal RPC fixture is a read-only schema snapshot from 2026-09-22; cancellation uses the existing checked-in hardening migration. No test reads application secrets or connects to Supabase. Tests cover RLS, denied writes, direct withdrawal forgery, backfill, source validation, idempotency, financial RPC behavior and rollback. API tests execute the actual route modules with an in-memory Supabase adapter, including verified-session ownership and per-operation admin permissions.

This is not a full staging Supabase/PostgREST integration test: the repository's original remote-schema migration is empty. Production schema metadata was inspected read-only to verify the columns and constraints. Run a staging rehearsal and database advisors before approved production rollout.

For isolated browser fixtures against a local production build:

```powershell
npm run start -- --port 3100
# In another terminal; install/use agent-browser separately if needed:
node tests/support-browser.mjs <path-to-agent-browser-executable>
```

The script intercepts all application APIs and remote Supabase HTTP requests, uses fake session cookies, and checks desktop/mobile history, notifications, copy feedback, contact references, admin lookup and horizontal overflow. Screenshots are saved under ignored `.next/support-ui/`.

Validation on 2026-09-22:

- 19 database/API tests passed, including pagination beyond 1,000 cases, fail-closed query errors, private-response cache headers, strict end-of-input validation, and preservation of legitimate pending withdrawal inserts.
- Type-check and production build passed.
- Browser checks cover 390px and 1280px: both histories (including the rejected-order filter), all three notification case types, successful clipboard action, Telegram ID links, admin lookup, no horizontal overflow or browser errors.
- Full lint still reports the same 27 errors and 22 warnings as baseline `c8211c4`. The new files pass targeted lint; the feature adds no lint diagnostics. Existing unrelated lint problems were not suppressed or changed.
- `git diff --check` passed. Existing financial hardening migrations/RPC implementations are unchanged.

Follow-up review preserved the existing working tree and checked session verification, permission-before-lookup behavior, source ownership, client table/function privileges, RLS, all rejection paths, public Telegram URL construction and response data. No direct authorization/ownership bypass was found in these paths. The review added explicit private response cache headers, rejected-order types/filters and strict rejection of trailing newlines in reference IDs/Telegram usernames. No financial mutation endpoint was added. The review preserved financial RPCs and did not change production data.

## Changed files

| Area | Files |
| --- | --- |
| Database | `supabase/migrations/20260922135323_secure_support_cases.sql` |
| Support model and server lookup | `lib/support.ts`, `lib/support-cases.ts`, `app/api/admin/support-cases/route.ts` |
| User APIs | `app/api/orders/my/route.ts`, `app/api/transactions/route.ts`, `app/api/notifications/route.ts` |
| User UI | `components/SupportCaseActions.tsx`, `components/NotificationBell.tsx`, `app/orders/page.tsx`, `app/transactions/page.tsx` |
| Admin UI | `app/admin/support-cases/page.tsx`, `app/admin/page.tsx` |
| Tests | `tests/support-api.test.mjs`, `tests/support-database.test.mjs`, `tests/support-browser.mjs`, `tests/fixtures/support-schema.sql`, `tests/fixtures/financial-rpcs.sql` |
| Configuration/documentation | `.env.example`, `package.json`, `package-lock.json`, `vercel.json`, `docs/support-cases.md` |

## Rollout requiring approval

`vercel.json` disables Git-triggered deployments only for `feature/secure-support-cases`, so publishing this review branch does not automatically deploy the un-migrated application. Other branches retain their existing deployment behavior. Remove or change this branch guard only when preview deployment is authorized and its database is ready.

1. Review this migration and rehearse it against staging. Backfill creates new user notifications and can take locks while scanning historical operations; assess historical volume and schedule appropriately.
2. After approval, apply the migration **before** deploying the application. The old application tolerates the additive schema; the new APIs require `support_cases` and the notification FK and fail closed if absent.
3. Keep the default support account, or set the two public destination variables. No service credential change is required.
4. After approved deployment, check all three rejection/cancellation flows, history and notification links, and an authorized/unauthorized admin lookup. Confirm RLS/privileges with Supabase advisors.

Feature-branch publication is for review only. Merge, deployment, production migration and financial-data changes require separate approval.
