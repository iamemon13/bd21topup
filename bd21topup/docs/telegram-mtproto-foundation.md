# Phase 3A personal Telegram MTProto foundation

The worker uses `teleproto` 1.229.0, the maintained TypeScript fork of GramJS. It supports personal-account MTProto sessions, typed Telegram entities, message IDs, update handlers, reply metadata, timestamps, and history lookup. The Phase 3A code does not attach it to the dispatch runner or production service.

`DryRunTelegramTransport` remains the default. Selecting the real transport requires `TELEGRAM_TRANSPORT_MODE=real`, complete server-side configuration, `TELEGRAM_REAL_SEND_ENABLED=true`, and an explicitly supplied MTProto gateway. There is no fallback from dry-run to real mode. The supplier username comes only from server configuration, while message text is built from the already validated structured operation. An operation is marked attempted before I/O; transport errors are uncertain and the instance will not send that operation again. The existing durable send-intent state remains the cross-process protection when real queue integration is designed later.

## Secret and session storage

Use these environment variable names only:

- `TELEGRAM_TRANSPORT_MODE`
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION_FILE`
- `TELEGRAM_SUPPLIER_USERNAME`
- `TELEGRAM_REAL_SEND_ENABLED`

Credentials belong in a local ignored `.env` file or a deployment secret manager. The serialized MTProto authorization session is written to the ignored path named by `TELEGRAM_SESSION_FILE`, using an atomic replacement and owner-only permissions where the operating system supports them. Never print, commit, or copy the session string, API hash, OTP, or 2FA password into an issue or chat.

## Connectivity and identity check

`npm run telegram:check` is separate from the dispatch queue. It authenticates interactively when the session file is empty, resolves only `TELEGRAM_SUPPLIER_USERNAME`, prints the resolved username, entity type, and stable entity ID, saves the session locally, and disconnects. Its code has no Supabase client and never calls `sendMessage`. OTP and 2FA input are hidden. Keep `TELEGRAM_REAL_SEND_ENABLED=false` for this check.

The client uses one initial connection retry and disables automatic reconnect. Phase 3A does not retry sends. A later worker must keep any timeout or disconnected-after-send outcome in manual review until Telegram history establishes whether the message exists.

## Future response correlation

Teleproto exposes the outgoing message ID and timestamp, incoming update sender/chat identity, reply-to metadata, and history lookup. A future layer can persist a send receipt, watch only the configured entity, and correlate direct replies. It must also support supplier responses that are not direct replies by using independently verified references and strict time/chat/UID evidence.

Before automatic completion can be considered, collect one explicitly approved real transaction and preserve its outgoing ID and timestamp, exact supplier entity ID, full response sequence and timing, reply-to behavior, stable supplier reference format, duplicate/late/failure behavior, and history behavior after reconnect. Generic success text remains insufficient. Automatic order completion remains disabled.
