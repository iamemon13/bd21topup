export type TelegramEnvironment = Record<string, string | undefined>;

export type TelegramConfig = {
  mode: "dry-run" | "real";
  apiId?: number;
  apiHash?: string;
  sessionFile?: string;
  supplierUsername?: string;
  supplierEntityId?: string;
  realSendEnabled: boolean;
};

function required(env: TelegramEnvironment, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required Telegram configuration: ${name}.`);
  return value;
}

function normalizeSupplierUsername(value: string) {
  const normalized = value.startsWith("@") ? value.slice(1) : value;
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(normalized)) {
    throw new Error("TELEGRAM_SUPPLIER_USERNAME is invalid.");
  }
  return normalized.toLowerCase();
}

function normalizeSupplierEntityId(value: string) {
  if (!/^[1-9][0-9]{0,19}$/.test(value)) {
    throw new Error("TELEGRAM_SUPPLIER_ENTITY_ID is invalid.");
  }
  return value;
}

function loadRealConnectivityBase(env: TelegramEnvironment) {
  if (env.TELEGRAM_TRANSPORT_MODE?.trim() !== "real") {
    throw new Error("TELEGRAM_TRANSPORT_MODE=real is required.");
  }
  const apiIdText = required(env, "TELEGRAM_API_ID");
  if (!/^[1-9][0-9]*$/.test(apiIdText) || !Number.isSafeInteger(Number(apiIdText))) {
    throw new Error("TELEGRAM_API_ID is invalid.");
  }
  return {
    apiId: Number(apiIdText),
    apiHash: required(env, "TELEGRAM_API_HASH"),
    sessionFile: required(env, "TELEGRAM_SESSION_FILE"),
    supplierUsername: normalizeSupplierUsername(required(env, "TELEGRAM_SUPPLIER_USERNAME")),
  };
}

function requireInactiveTelegramControls(env: TelegramEnvironment) {
  const realSend = env.TELEGRAM_REAL_SEND_ENABLED?.trim();
  const pilotAcknowledged = env.TELEGRAM_PILOT_ACKNOWLEDGED?.trim();
  if ((realSend !== undefined && realSend !== "false") ||
      (pilotAcknowledged !== undefined && pilotAcknowledged !== "false")) {
    throw new Error("Connectivity requires real send and pilot acknowledgement to remain false or unset.");
  }
}

export function loadTelegramIdentityConfig(env: TelegramEnvironment = process.env) {
  requireInactiveTelegramControls(env);
  return { mode: "real" as const, ...loadRealConnectivityBase(env), realSendEnabled: false as const };
}

export function loadTelegramConnectivityConfig(env: TelegramEnvironment = process.env) {
  requireInactiveTelegramControls(env);
  const config = loadTelegramConfig(env);
  if (config.mode !== "real") throw new Error("Connectivity requires TELEGRAM_TRANSPORT_MODE=real.");
  return config;
}

export function loadTelegramConfig(env: TelegramEnvironment = process.env): TelegramConfig {
  const modeValue = env.TELEGRAM_TRANSPORT_MODE?.trim() || "dry-run";
  if (modeValue !== "dry-run" && modeValue !== "real") {
    throw new Error("TELEGRAM_TRANSPORT_MODE must be dry-run or real.");
  }
  if (modeValue === "dry-run") return { mode: "dry-run", realSendEnabled: false };

  const base = loadRealConnectivityBase(env);
  return {
    mode: "real",
    ...base,
    supplierEntityId: normalizeSupplierEntityId(required(env, "TELEGRAM_SUPPLIER_ENTITY_ID")),
    realSendEnabled: env.TELEGRAM_REAL_SEND_ENABLED === "true",
  };
}

export function requireRealSend(config: TelegramConfig) {
  if (config.mode !== "real" || !config.realSendEnabled) {
    throw new Error("Real Telegram sending is disabled.");
  }
  return config as Required<Omit<TelegramConfig, "mode">> & { mode: "real" };
}

export function redactTelegramError(error: unknown, sensitiveValues: string[] = []) {
  const message = error instanceof Error ? error.message : "Unknown Telegram error.";
  let scrubbed = message;
  for (const value of sensitiveValues) {
    if (value) scrubbed = scrubbed.split(value).join("[REDACTED]");
  }
  scrubbed = scrubbed
    .replace(/((?:api[_ -]?hash|session|password|phone|code)\s*[:=])\s*\S+/gi, "$1[REDACTED]")
    .replace(/\b\+?[0-9][0-9 ()-]{7,}[0-9]\b/g, "[REDACTED]");
  return new Error(`Telegram operation failed: ${scrubbed.slice(0, 240)}`);
}
