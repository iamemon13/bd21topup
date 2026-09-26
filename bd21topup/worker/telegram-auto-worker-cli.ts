import { createClient } from "@supabase/supabase-js";
import { readTelegramSession } from "./telegram-session-file.ts";
import { TeleprotoGateway } from "./teleproto-gateway.ts";
import { RealTelegramTransport } from "./real-telegram-transport.ts";
import { checkTelegramConnectivity } from "./telegram-connectivity.ts";
import { redactTelegramError } from "./telegram-config.ts";
import { loadAutomaticWorkerConfig, runAutomaticTelegramWorker } from "./telegram-auto-worker.ts";
import { SupabaseDispatchQueue } from "./supabase-dispatch-queue.ts";

const sensitiveValues: string[] = [];

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required automatic worker configuration: ${name}.`);
  return value;
}

async function main() {
  const config = loadAutomaticWorkerConfig(process.env);
  const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseSecret = required("SUPABASE_SECRET_KEY");
  sensitiveValues.push(config.apiHash, supabaseSecret);
  const session = await readTelegramSession(config.sessionFile);
  if (!session) throw new Error("Telegram authentication session is missing; run the connectivity check first.");
  sensitiveValues.push(session);

  const client = createClient(supabaseUrl, supabaseSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const queue = new SupabaseDispatchQueue(client);
  const controller = new AbortController();
  const gateway = new TeleprotoGateway(session, config.apiId, config.apiHash);
  const requestShutdown = () => controller.abort();
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);
  try {
    const result = await runAutomaticTelegramWorker({
      env: process.env,
      workerId: `telegram-auto-${process.pid}`,
      queue,
      signal: controller.signal,
      verifySupplier: async () => { await checkTelegramConnectivity(gateway, config.supplierUsername, config.supplierEntityId); },
      createTransport: async () => new RealTelegramTransport(config, gateway),
      onResult: (outcome) => {
        if (outcome) process.stdout.write(`${JSON.stringify({ workerOutcome: outcome.kind, summary: outcome.summary })}\n`);
      },
    });
    process.stdout.write(`${JSON.stringify({ workerStopped: true, processed: result.processed })}\n`);
  } finally {
    process.removeListener("SIGINT", requestShutdown);
    process.removeListener("SIGTERM", requestShutdown);
  }
}

if (process.argv.includes("--check-module-load")) {
  process.stdout.write("TELEGRAM_AUTO_WORKER_CLI_MODULES_OK\n");
} else {
  main().catch((error) => {
    process.stderr.write(`${redactTelegramError(error, sensitiveValues).message}\n`);
    process.exitCode = 1;
  });
}
