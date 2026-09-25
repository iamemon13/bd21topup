# Top-up dispatch worker (dry run only)

This directory defines the durable worker boundary. `DryRunTelegramTransport` is the only transport implementation. It performs no network calls and needs no Telegram credentials. The database claim RPC atomically uses `FOR UPDATE SKIP LOCKED`; ordered bundle operations become claimable one at a time. The worker records a unique durable send intent before calling the transport. Recovery requeues only stale claims that never reached send intent; stale send intents and transport uncertainty enter `manual_review`.

`runOneDryRun` accepts an optional dispatch ID. When supplied, the database claim is restricted to that dispatch and returns no work instead of falling back to the global queue. Omitting it preserves normal global-worker behavior.

Claim and send-intent RPCs independently revalidate the current order, package, wallet evidence, immutable dispatch snapshot, operation manifest, and command hashes. If send-intent validation returns no timestamp, the queue throws and transport is not invoked.

The final send-intent validation holds the same transaction advisory reference lock acquired automatically by every non-null wallet-ledger insert. A financial writer either commits before validation and is observed, or waits until the send-intent transaction commits.

A disabled personal-account MTProto foundation is documented in `docs/telegram-mtproto-foundation.md`. It is not wired to this runner. Before real activation, prove persistent hosting, secure account authentication, supplier response formats, message/reply correlation, monitoring, and a staffed manual-review process. An uncertain send must remain `manual_review`; it must never be reclaimed and blindly resent.

Dispatch completion is fulfillment metadata only. The worker never updates `orders` or financial tables.
