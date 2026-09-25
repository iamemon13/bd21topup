# Top-up dispatch worker (dry run only)

This directory defines the durable worker boundary. `DryRunTelegramTransport` is the only transport implementation. It performs no network calls and needs no Telegram credentials. The database claim RPC atomically uses `FOR UPDATE SKIP LOCKED`; ordered bundle operations become claimable one at a time. The worker records a unique durable send intent before calling the transport. Recovery requeues only stale claims that never reached send intent; stale send intents and transport uncertainty enter `manual_review`.

Claim and send-intent RPCs independently revalidate the current order, package, wallet evidence, immutable dispatch snapshot, operation manifest, and command hashes. If send-intent validation returns no timestamp, the queue throws and transport is not invoked.

The final send-intent validation holds the same transaction advisory reference lock acquired automatically by every non-null wallet-ledger insert. A financial writer either commits before validation and is observed, or waits until the send-intent transaction commits.

A real personal-account MTProto transport is intentionally absent. Before adding one, prove persistent hosting, secure account authentication, supplier response formats, message/reply correlation, monitoring, and a staffed manual-review process. An uncertain send must remain `manual_review`; it must never be reclaimed and blindly resent.

Dispatch completion is fulfillment metadata only. The worker never updates `orders` or financial tables.
