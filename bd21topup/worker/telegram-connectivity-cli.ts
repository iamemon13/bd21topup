import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { checkTelegramConnectivity, resolveTelegramIdentity } from "./telegram-connectivity.ts";
import { loadTelegramConnectivityConfig, loadTelegramIdentityConfig, redactTelegramError } from "./telegram-config.ts";
import { readTelegramSession, writeTelegramSession } from "./telegram-session-file.ts";
import { TeleprotoGateway } from "./teleproto-gateway.ts";
import { captureSensitiveInput } from "./telegram-auth-secrets.ts";

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
  const identityBootstrap = process.argv.includes("--identity-bootstrap");
  const expectedArgs = identityBootstrap ? ["--identity-bootstrap"] : [];
  if (process.argv.slice(2).join("\u0000") !== expectedArgs.join("\u0000")) {
    throw new Error("Connectivity CLI accepts only the explicit --identity-bootstrap mode.");
  }
  const config = identityBootstrap
    ? loadTelegramIdentityConfig(process.env)
    : loadTelegramConnectivityConfig(process.env);
  const supplierEntityId = "supplierEntityId" in config ? config.supplierEntityId : undefined;
  if (
    config.mode !== "real" ||
    !config.apiId ||
    !config.apiHash ||
    !config.sessionFile ||
    !config.supplierUsername ||
    (!identityBootstrap && !supplierEntityId)
  ) {
    throw new Error("Connectivity check requires TELEGRAM_TRANSPORT_MODE=real and complete configuration.");
  }
  const previousSession = await readTelegramSession(config.sessionFile);
  sensitiveValues.push(config.apiHash, previousSession);
  const gateway = new TeleprotoGateway(previousSession, config.apiId, config.apiHash);
  const prompts = {
    phoneNumber: () => captureSensitiveInput(
      () => question("Telegram phone number: "),
      sensitiveValues,
    ),
    phoneCode: () => captureSensitiveInput(
      () => hiddenQuestion("Telegram login code (hidden): "),
      sensitiveValues,
    ),
    password: () => captureSensitiveInput(
      () => hiddenQuestion("Telegram 2FA password (hidden): "),
      sensitiveValues,
    ),
  };
  const entity = identityBootstrap
    ? await resolveTelegramIdentity(gateway, config.supplierUsername, prompts)
    : await checkTelegramConnectivity(gateway, config.supplierUsername, supplierEntityId!, prompts);
  const savedSession = gateway.saveSession?.();
  if (savedSession && savedSession !== previousSession) await writeTelegramSession(config.sessionFile, savedSession);
  stdout.write(`${JSON.stringify({ connected: true, identityBootstrap, username: entity.username, entityType: entity.type, entityId: entity.id, messagesSent: 0 })}\n`);
}

if (process.argv.includes("--check-module-load")) {
  stdout.write("TELEGRAM_CONNECTIVITY_CLI_MODULES_OK\n");
} else {
  main().catch((error) => {
    process.stderr.write(`${redactTelegramError(error, sensitiveValues).message}\n`);
    process.exitCode = 1;
  });
}
