import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { checkTelegramConnectivity } from "./telegram-connectivity.ts";
import { loadTelegramConfig, redactTelegramError } from "./telegram-config.ts";
import { readTelegramSession, writeTelegramSession } from "./telegram-session-file.ts";
import { TeleprotoGateway } from "./teleproto-gateway.ts";

async function question(label: string) {
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    return await terminal.question(label);
  } finally {
    terminal.close();
  }
}

async function hiddenQuestion(label: string) {
  if (!stdin.isTTY || !stdin.setRawMode) throw new Error("Interactive Telegram authentication requires a TTY.");
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return await new Promise<string>((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };
    const onData = (chunk: string) => {
      if (chunk === "\u0003") {
        cleanup();
        reject(new Error("Authentication cancelled."));
      } else if (chunk === "\r" || chunk === "\n") {
        cleanup();
        resolve(value);
      } else if (chunk === "\u007f" || chunk === "\b") {
        value = value.slice(0, -1);
      } else if (/^[^\u0000-\u001f]+$/.test(chunk)) {
        value += chunk;
      }
    };
    stdin.on("data", onData);
  });
}

const sensitiveValues: string[] = [];

async function main() {
  const config = loadTelegramConfig(process.env);
  if (
    config.mode !== "real" ||
    !config.apiId ||
    !config.apiHash ||
    !config.sessionFile ||
    !config.supplierUsername ||
    !config.supplierEntityId
  ) {
    throw new Error("Connectivity check requires TELEGRAM_TRANSPORT_MODE=real and complete configuration.");
  }
  const previousSession = await readTelegramSession(config.sessionFile);
  sensitiveValues.push(config.apiHash, previousSession);
  const gateway = new TeleprotoGateway(previousSession, config.apiId, config.apiHash);
  const entity = await checkTelegramConnectivity(
    gateway,
    config.supplierUsername,
    config.supplierEntityId,
    {
    phoneNumber: () => question("Telegram phone number: "),
    phoneCode: () => hiddenQuestion("Telegram login code (hidden): "),
    password: () => hiddenQuestion("Telegram 2FA password (hidden): "),
    },
  );
  const savedSession = gateway.saveSession?.();
  if (savedSession && savedSession !== previousSession) await writeTelegramSession(config.sessionFile, savedSession);
  stdout.write(`${JSON.stringify({ connected: true, username: entity.username, entityType: entity.type, entityId: entity.id })}\n`);
}

if (process.argv.includes("--check-module-load")) {
  stdout.write("TELEGRAM_CONNECTIVITY_CLI_MODULES_OK\n");
} else {
  main().catch((error) => {
    process.stderr.write(`${redactTelegramError(error, sensitiveValues).message}\n`);
    process.exitCode = 1;
  });
}
