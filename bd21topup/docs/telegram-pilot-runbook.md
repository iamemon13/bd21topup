# Controlled Telegram pilot runbook

## Hosting choice

Use a small single-instance VPS with `systemd` for the first controlled pilot. It is the simplest option for this project because it provides a stable working directory, a persistent private session path, direct interactive re-authentication, an explicit one-process limit, and an immediate stop command.

Managed background workers such as Render reduce operating-system maintenance and provide restart/SIGTERM handling, but require a persistent disk and interactive session provisioning workflow. Railway has similar managed-process convenience with provider-specific volume and scaling controls. The same application requirements apply on every provider: Node.js 24.x, one instance, no horizontal autoscaling, persistent private storage, graceful shutdown, bounded restart backoff, and secret-managed environment variables.

The web application remains on Vercel. Do not run the persistent MTProto process in a Vercel Function.

## Runtime layout

- Install Node.js 24.x and deploy a reviewed commit to a stable release directory.
- Run `npm ci` in that directory.
- Store `TELEGRAM_SESSION_FILE` under a root-owned persistent path outside the release. The service account needs read/write access; other users should have none.
- Run one process under a dedicated unprivileged account. Configure `systemd` with `Restart=on-failure`, a bounded delay, and no second instance.
- During the pilot stage, do not start a global queue loop. Invoke only an explicitly scoped preflight or pilot command.
- Handle `SIGTERM` by stopping new work and disconnecting. A process stopped after durable send intent must remain in manual review and must never be restarted as an automatic resend.

## Production configuration inventory

Store secrets in the host secret manager or a root-readable service environment file outside the repository. Never put values in Git, service command lines, or logs.

| Variable | Storage | Pilot preflight | Real pilot |
| --- | --- | --- | --- |
| `TELEGRAM_TRANSPORT_MODE=real` | Service configuration | Required | Required |
| `TELEGRAM_API_ID` | Secret store | Required by current validated config | Required |
| `TELEGRAM_API_HASH` | Secret store | Required by current validated config | Required |
| `TELEGRAM_SESSION_FILE` | Service configuration; absolute persistent path | Required by current validated config | Required |
| `TELEGRAM_SUPPLIER_USERNAME=kaiumrakibucbot` | Service configuration | Required | Required |
| `TELEGRAM_SUPPLIER_ENTITY_ID=7072880197` | Service configuration | Required | Required |
| `NEXT_PUBLIC_SUPABASE_URL` | Secret/service configuration | Required | Required |
| `SUPABASE_SECRET_KEY` | Secret store | Required | Required |
| `TELEGRAM_REAL_SEND_ENABLED` | Service configuration | Must be `false` | Must be explicitly `true` only for the approved invocation |
| `TELEGRAM_PILOT_ACKNOWLEDGED` | Service configuration | Must be `false` | Must be explicitly `true` only for the approved invocation |

## Session provisioning

Prefer interactive re-authentication directly on the final host under the worker service account. Configure the persistent path and inactive flags, run `npm run telegram:identity`, manually verify the identity, set the pinned ID, and run `npm run telegram:check`. This avoids copying the local session.

If migration is unavoidable, stop every process using the session, transfer it through an encrypted authenticated channel to the persistent path, verify the destination ownership and restrictive permissions, delete transfer artifacts, and run the pinned zero-send check. Keep an encrypted, access-controlled backup with a documented owner and restoration test. Never put the session in Git, chat, CI artifacts, logs, or a container image.

Missing or unreadable session data makes the pilot fail before claim. Corrupt session construction also fails before claim. Unattended worker startup must never invoke the interactive identity command or automatically re-authenticate.

## Candidate selection and read-only preflight

1. A staff operator creates or identifies a dispatch through the existing authenticated admin flow for one naturally eligible pending Wallet order.
2. Record the order ID and returned dispatch ID together. Do not select by “latest,” scan for any queued row, or allow the worker to choose.
3. Confirm the dispatch ID is a UUID and that it belongs to the intended order in the admin view.
4. Keep both activation flags `false` and run:

   ```powershell
   npm run telegram:pilot:preflight -- --dispatch <uuid>
   ```

5. The command calls the service-role-only read-only preflight RPC. It reuses authoritative evidence validation and returns only a queued, fresh dispatch snapshot. It does not claim, create send intent, initialize Telegram, or mutate data.
6. Compare the safe output—dispatch ID, pinned identity, UID, products, quantities, and operation count—with the approved order. Stop on any difference.

The preflight migration must be reviewed and applied separately before this command is used against production.

## Future pilot command and guard order

The later, separately approved command is:

```powershell
npm run telegram:pilot -- --dispatch <uuid>
```

Checks execute in this order:

1. Parse exactly one explicit dispatch UUID.
2. Require pilot acknowledgement to equal `true` exactly.
3. Require real mode, complete Telegram configuration, pinned username/entity ID, and real-send enablement to equal `true` exactly.
4. Read and validate the selected dispatch snapshot and ordered operations.
5. Read the existing session and construct the pinned real transport; missing/corrupt session stops before claim.
6. Pass the same dispatch UUID into the scoped claim RPC. There is no global fallback.
7. Revalidate authoritative order, package, operation, and wallet evidence during claim.
8. Persist durable send intent with a second authoritative revalidation.
9. Connect, resolve the configured username, and require exact username and entity-ID match before `sendText()`.
10. Attempt at most one send. Successful submission remains `uncertain`; timeout, disconnect, or unknown errors also finish in `manual_review`.
11. Never update order status, wallet balance, wallet transactions, refunds, withdrawals, or payment state.

## First-pilot monitoring and manual review

- Assign one named operator to the terminal and one reviewer to the admin order/dispatch view.
- Before starting, announce the approved order and dispatch IDs and confirm no other worker instance exists.
- Watch only safe logs: commit, worker lifecycle, dispatch/operation IDs, sequence number, state transition, pinned identity result, and sanitized error class. Never log secrets, session data, phone/auth inputs, or supplier command text.
- A transport submission is not business success. The expected safe result is `uncertain`/`manual_review` until response handling is separately proven.
- On timeout, disconnect, or any unknown outcome, stop and inspect Telegram history manually. Never resend automatically.
- Treat ambiguous supplier responses as manual review. Do not complete or refund the order automatically.
- Emergency stop on the recommended host: `systemctl stop bd21topup-telegram`. For an interactive one-shot invocation, use `Ctrl+C`. Stopping after send intent does not make retry safe.
- Keep the worker stopped until the selected dispatch and any durable send intent have been reconciled by staff.
