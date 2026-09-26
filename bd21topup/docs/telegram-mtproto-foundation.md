# Phase 3A personal Telegram MTProto foundation

The worker uses `teleproto` 1.229.0, the maintained TypeScript fork of GramJS. It supports personal-account MTProto sessions, typed Telegram entities, message IDs, update handlers, reply metadata, timestamps, and history lookup. The Phase 3A code does not attach it to the dispatch runner or production service.

`DryRunTelegramTransport` remains the default. Selecting the real transport requires `TELEGRAM_TRANSPORT_MODE=real`, complete server-side configuration, `TELEGRAM_REAL_SEND_ENABLED=true`, and an explicitly supplied MTProto gateway. There is no fallback from dry-run to real mode. The supplier username and stable entity ID come only from server configuration and both must match the resolved Telegram entity before sending, while message text is built from the already validated structured operation. An operation is marked attempted before I/O; transport errors are uncertain and the instance will not send that operation again. The existing durable send-intent state remains the cross-process protection when real queue integration is designed later.

## Secret and session storage

Use these environment variable names only:

- `TELEGRAM_TRANSPORT_MODE`
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION_FILE`
- `TELEGRAM_SUPPLIER_USERNAME`
- `TELEGRAM_SUPPLIER_ENTITY_ID`
- `TELEGRAM_REAL_SEND_ENABLED`

Credentials belong in a local ignored `.env` file or a deployment secret manager. The serialized MTProto authorization session is written to the ignored path named by `TELEGRAM_SESSION_FILE`, using an exclusive randomized temporary file, atomic replacement, and owner-only permissions where the operating system supports them. Session files and temporary session files are gitignored. Never print, commit, or copy the session string, API hash, phone number, OTP, or 2FA password into an issue or chat. Values entered during authentication are registered for exact redaction if login fails.

## Connectivity and identity check

`npm run telegram:check` is separate from the dispatch queue. It authenticates interactively when the session file is empty, resolves only `TELEGRAM_SUPPLIER_USERNAME`, requires the resolved username and entity ID to match `TELEGRAM_SUPPLIER_USERNAME` and `TELEGRAM_SUPPLIER_ENTITY_ID`, prints the verified identity, saves the session locally, and disconnects. Its code has no Supabase client and never calls `sendMessage`. OTP and 2FA input are hidden. Keep `TELEGRAM_REAL_SEND_ENABLED=false` for this check.

The client uses one initial connection retry and disables automatic reconnect. Phase 3A does not retry sends. A later worker must keep any timeout or disconnected-after-send outcome in manual review until Telegram history establishes whether the message exists.

## Controlled pilot entrypoint

`npm run telegram:pilot -- --dispatch <uuid>` is the only real-transport pilot entrypoint. It requires one explicit dispatch UUID and never makes a global queue claim. It fails closed unless all real-mode configuration is present, `TELEGRAM_REAL_SEND_ENABLED=true`, and the separate `TELEGRAM_PILOT_ACKNOWLEDGED=true` acknowledgement is set. Both flags remain `false` in `.env.example`.

The pilot also needs server-side `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` values to use the existing RPC-only dispatch queue. It first reads and validates the dispatch snapshot and its ordered operations. Before constructing the Telegram transport, it prints only the dispatch ID, real mode, pinned supplier username/entity ID, operation count, and authoritative UID/product/quantity. It never prints the Supabase secret, API hash, session contents, phone number, login code, or 2FA password.

The pilot never authenticates. An authenticated session file must already exist from a separately approved connectivity check. The pilot then uses the existing scoped claim, authoritative evidence checks, durable send intent, operation sequencing, and uncertain/manual-review finish path. A missing or stale dispatch, non-queued operation, identity mismatch, timeout, connection reset, or unexpected Telegram error cannot fall back to another dispatch or trigger an automatic retry.

Abort before execution by leaving either acknowledgement flag false or by omitting `--dispatch`. After a durable send intent, any unknown outcome must be handled in manual review and must never be resent automatically. The pilot does not complete or cancel orders and does not change wallet balances, refunds, withdrawals, or ledger records.

## Future response correlation

The offline correlation foundation accepts fixtures only. It confirms a result only when the supplier message is an exact reply to the sent message, contains the exact UID, and contains the recorded supplier reference when one is available. Generic success text never confirms fulfillment. Unmatched messages are ignored, ambiguous exact replies enter manual review, and repeated message IDs are idempotently classified as duplicates.

Teleproto exposes the outgoing message ID and timestamp, incoming update sender/chat identity, reply-to metadata, and history lookup. Live update subscription and durable correlation storage are intentionally not wired yet. A future layer must watch only the pinned entity, persist message IDs across processes, and prove restart/reconnect behavior before it can consume live supplier replies.

Before automatic completion can be considered, collect one explicitly approved real transaction and preserve its outgoing ID and timestamp, exact supplier entity ID, full response sequence and timing, reply-to behavior, stable supplier reference format, duplicate/late/failure behavior, and history behavior after reconnect. Generic success text remains insufficient. Automatic order completion remains disabled.
