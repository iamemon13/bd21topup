# Telegram worker hosting and zero-send setup

## Runtime boundary

Keep the Next.js web application on Vercel. Do not run the personal-account MTProto worker as a Vercel Function: Functions have bounded invocation duration, scale to zero, and expose only temporary writable storage. The Telegram session and a future update consumer require a persistent process and persistent private storage.

Run the worker on a separate persistent Node.js host with:

- Node.js `24.20.0`, matching the verified development/runtime command.
- Repository working directory as the process working directory.
- `npm ci` during release installation.
- A persistent private directory outside the release checkout for `TELEGRAM_SESSION_FILE`.
- One active Telegram worker process. Do not autoscale it horizontally.
- Restart on process failure with backoff, but never translate a restart into an automatic resend. Durable send-intent recovery remains authoritative.
- Graceful shutdown time for MTProto disconnect and logs.
- Logs restricted to lifecycle, safe identity metadata, dispatch IDs, operation IDs, and state transitions. Never log API hashes, sessions, Supabase secrets, phone numbers, login codes, 2FA passwords, or supplier command text.
- Monitoring for process restarts, authentication/session failures, identity mismatch, `manual_review`, and stale send intents.

The Vercel constraints are documented in [Vercel Functions runtimes](https://vercel.com/docs/functions/runtimes) and [function duration](https://vercel.com/docs/functions/configuring-functions/duration).

## Environment

Authentication and identity bootstrap require:

```text
TELEGRAM_TRANSPORT_MODE=real
TELEGRAM_API_ID=<secret>
TELEGRAM_API_HASH=<secret>
TELEGRAM_SESSION_FILE=<absolute persistent private path>
TELEGRAM_SUPPLIER_USERNAME=<reviewed username>
TELEGRAM_REAL_SEND_ENABLED=false
TELEGRAM_PILOT_ACKNOWLEDGED=false
```

The first identity bootstrap intentionally omits `TELEGRAM_SUPPLIER_ENTITY_ID`. After manual verification, add:

```text
TELEGRAM_SUPPLIER_ENTITY_ID=<verified stable entity id>
```

The controlled pilot additionally needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`. Keep those variables out of connectivity-only environments when possible. Store all real values in the host secret manager or an ignored, access-controlled environment file. Never store them in Git or command history.

## Zero-send operator sequence

1. Configure API credentials, persistent session path, and reviewed supplier username. Leave both activation flags `false`.
2. From the repository working directory, run:

   ```powershell
   npm run telegram:identity
   ```

3. Enter the phone number, hidden Telegram login code, and hidden 2FA password when prompted. The command saves the session atomically, resolves only the configured username, prints safe identity metadata, reports `messagesSent: 0`, and disconnects.
4. Independently compare the resolved username, entity type, and stable entity ID with the intended supplier. Do not continue on any uncertainty.
5. Add the verified entity ID to the worker's secret configuration.
6. Run the pinned check:

   ```powershell
   npm run telegram:check
   ```

7. Require the command to return the same username and entity ID with `messagesSent: 0`.
8. Leave `TELEGRAM_REAL_SEND_ENABLED=false` and `TELEGRAM_PILOT_ACKNOWLEDGED=false`. Authentication and identity verification do not authorize a pilot.

## Controlled pilot prerequisites

Before one pilot, separately approve and verify the deployed commit, persistent host, secure session, pinned identity, exactly one eligible dispatch UUID, staffed manual review, monitoring, and production secret configuration. Enable real-send and pilot acknowledgement only for the explicitly scoped command. Never run the pilot as a global queue consumer and never retry an uncertain send.

The hosting comparison, authoritative read-only preflight, guard order, emergency stop, and manual-review procedure are in `docs/telegram-pilot-runbook.md`.
