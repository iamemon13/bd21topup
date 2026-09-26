import { createClient } from "@supabase/supabase-js";
import { readTelegramSession } from "./telegram-session-file.ts";
import { TeleprotoGateway } from "./teleproto-gateway.ts";
import { RealTelegramTransport } from "./real-telegram-transport.ts";
import { redactTelegramError } from "./telegram-config.ts";
import { parsePilotDispatchId, runControlledTelegramPilot } from "./telegram-pilot.ts";
import { SupabaseDispatchQueue } from "./supabase-dispatch-queue.ts";

const sensitiveValues: string[] = [];

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required pilot configuration: ${name}.`);
  return value;
}

async function main() {
  parsePilotDispatchId(process.argv.slice(2));
  const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseSecret = required("SUPABASE_SECRET_KEY");
  sensitiveValues.push(supabaseSecret);
  const client = createClient(supabaseUrl, supabaseSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const queue = new SupabaseDispatchQueue(client);

  const result = await runControlledTelegramPilot({
    args: process.argv.slice(2),
    env: process.env,
    workerId: `telegram-pilot-${process.pid}`,
    queue,
    inspectDispatch: (dispatchId) => queue.inspectDispatch(dispatchId),
    showPreflight: (summary) => {
      process.stdout.write(`${JSON.stringify({ pilotPreflight: summary })}\n`);
    },
    createTransport: async (config) => {
      sensitiveValues.push(config.apiHash);
      const session = await readTelegramSession(config.sessionFile);
      if (!session) throw new Error("Telegram authentication session is missing; run the connectivity check first.");
      sensitiveValues.push(session);
      const gateway = new TeleprotoGateway(session, config.apiId, config.apiHash);
      return new RealTelegramTransport(config, gateway);
    },
  });

  process.stdout.write(`${JSON.stringify({ pilotOutcome: result.kind, summary: result.summary })}\n`);
}

if (process.argv.includes("--check-module-load")) {
  process.stdout.write("TELEGRAM_PILOT_CLI_MODULES_OK\n");
} else {
  main().catch((error) => {
    process.stderr.write(`${redactTelegramError(error, sensitiveValues).message}\n`);
    process.exitCode = 1;
  });
}
