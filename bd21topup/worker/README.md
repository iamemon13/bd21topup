# Top-up dispatch worker

This directory defines the durable worker boundary. `DryRunTelegramTransport` remains the default and performs no network calls. A guarded real MTProto transport and controlled-pilot CLI exist but are disabled by default. The database claim RPC atomically uses `FOR UPDATE SKIP LOCKED`; ordered bundle operations become claimable one at a time. The worker records a unique durable send intent before calling the transport. Recovery requeues only stale claims that never reached send intent; stale send intents and transport uncertainty enter `manual_review`.

`runOneDryRun` remains as a backward-compatible wrapper. `runOneScopedDispatch` requires a valid dispatch UUID and is the only runner used by the pilot. The pilot cannot fall back to the global queue.

The optional `telegram:worker` command is a single-process global queue consumer. It remains disabled unless `TELEGRAM_AUTO_WORKER_ENABLED=true` and real sending are both explicitly enabled. Before claiming anything it resolves the configured pinned supplier with a zero-send connectivity check. It processes one operation at a time, never retries uncertain outcomes, and stops gracefully after the active operation on SIGINT or SIGTERM. The example systemd unit is not enabled by repository changes.

Claim and send-intent RPCs independently revalidate the current order, package, wallet evidence, immutable dispatch snapshot, operation manifest, and command hashes. If send-intent validation returns no timestamp, the queue throws and transport is not invoked.

The final send-intent validation holds the same transaction advisory reference lock acquired automatically by every non-null wallet-ledger insert. A financial writer either commits before validation and is observed, or waits until the send-intent transaction commits.

The personal-account MTProto foundation and controlled-pilot prerequisites are documented in `docs/telegram-mtproto-foundation.md`; persistent runtime and zero-send operator requirements are in `docs/telegram-worker-hosting.md`. Before a real pilot, prove persistent hosting, secure account authentication, monitoring, and a staffed manual-review process. An uncertain send must remain `manual_review`; it must never be reclaimed and blindly resent.

Dispatch completion is fulfillment metadata only. The worker never updates `orders` or financial tables.
