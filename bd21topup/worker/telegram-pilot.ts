import type { TelegramTransport } from "./telegram-transport";
import type { DispatchQueue } from "./runner";
import { runOneScopedDispatch } from "./runner.ts";
import {
  loadTelegramConnectivityConfig,
  loadTelegramConfig,
  requireRealSend,
  type TelegramConfig,
  type TelegramEnvironment,
} from "./telegram-config.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PilotOperation = {
  id: string;
  sequence_no: number;
  product_code: string;
  quantity: number;
  command_hash: string;
  status: string;
};

export type PilotSnapshot = {
  dispatch: { id: string; status: string; dry_run: boolean; uid_snapshot: string };
  operations: PilotOperation[];
};

export type PilotPreflight = {
  dispatchId: string;
  workerMode: "real";
  supplierUsername: string;
  supplierEntityId: string;
  operationCount: number;
  operations: Array<{ sequence: number; productCode: string; quantity: number; uid: string }>;
};

export function parsePilotDispatchId(args: string[]) {
  if (args.length !== 2 || args[0] !== "--dispatch" || !UUID.test(args[1])) {
    throw new Error("Pilot requires exactly --dispatch <uuid>.");
  }
  return args[1].toLowerCase();
}

export function parsePilotPreflightDispatchId(args: string[]) {
  if (args.length !== 3 || args[0] !== "--preflight" || args[1] !== "--dispatch" || !UUID.test(args[2])) {
    throw new Error("Pilot preflight requires exactly --preflight --dispatch <uuid>.");
  }
  return args[2].toLowerCase();
}

export function loadPilotTelegramConfig(env: TelegramEnvironment): TelegramConfig & {
  mode: "real";
  apiId: number;
  apiHash: string;
  sessionFile: string;
  supplierUsername: string;
  supplierEntityId: string;
  realSendEnabled: true;
} {
  if (env.TELEGRAM_PILOT_ACKNOWLEDGED !== "true") {
    throw new Error("TELEGRAM_PILOT_ACKNOWLEDGED=true is required.");
  }
  return requireRealSend(loadTelegramConfig(env)) as ReturnType<typeof loadPilotTelegramConfig>;
}

export function validatePilotSnapshot(
  dispatchId: string,
  snapshot: PilotSnapshot,
  config: { supplierUsername: string; supplierEntityId: string },
): PilotPreflight {
  if (
    snapshot.dispatch.id !== dispatchId ||
    snapshot.dispatch.status !== "queued" ||
    snapshot.dispatch.dry_run !== true ||
    !/^[0-9]{5,15}$/.test(snapshot.dispatch.uid_snapshot) ||
    snapshot.operations.length < 1
  ) {
    throw new Error("Dispatch is not eligible for a controlled pilot.");
  }

  snapshot.operations.forEach((operation, index) => {
    if (
      operation.sequence_no !== index + 1 ||
      operation.status !== "queued" ||
      !/^[a-z0-9]+$/i.test(operation.product_code) ||
      !Number.isInteger(operation.quantity) ||
      operation.quantity < 1 ||
      operation.quantity > 5 ||
      !/^[0-9a-f]{64}$/.test(operation.command_hash)
    ) {
      throw new Error("Dispatch operations are not eligible for a controlled pilot.");
    }
  });

  return {
    dispatchId,
    workerMode: "real",
    supplierUsername: config.supplierUsername,
    supplierEntityId: config.supplierEntityId,
    operationCount: snapshot.operations.length,
    operations: snapshot.operations.map((operation) => ({
      sequence: operation.sequence_no,
      productCode: operation.product_code,
      quantity: operation.quantity,
      uid: snapshot.dispatch.uid_snapshot,
    })),
  };
}

export async function runControlledTelegramPreflight(options: {
  args: string[];
  env: TelegramEnvironment;
  preflightDispatch(dispatchId: string): Promise<PilotSnapshot>;
  showPreflight(summary: PilotPreflight): void;
}) {
  const dispatchId = parsePilotPreflightDispatchId(options.args);
  const config = loadTelegramConnectivityConfig(options.env);
  if (!config.supplierUsername || !config.supplierEntityId) {
    throw new Error("Pilot preflight requires the pinned supplier identity.");
  }
  const snapshot = await options.preflightDispatch(dispatchId);
  const preflight = validatePilotSnapshot(dispatchId, snapshot, {
    supplierUsername: config.supplierUsername,
    supplierEntityId: config.supplierEntityId,
  });
  options.showPreflight(preflight);
  return preflight;
}

export async function runControlledTelegramPilot(options: {
  args: string[];
  env: TelegramEnvironment;
  workerId: string;
  queue: DispatchQueue;
  inspectDispatch(dispatchId: string): Promise<PilotSnapshot>;
  createTransport(config: ReturnType<typeof loadPilotTelegramConfig>): Promise<TelegramTransport>;
  showPreflight(summary: PilotPreflight): void;
}) {
  const dispatchId = parsePilotDispatchId(options.args);
  const config = loadPilotTelegramConfig(options.env);
  const snapshot = await options.inspectDispatch(dispatchId);
  const preflight = validatePilotSnapshot(dispatchId, snapshot, config);
  options.showPreflight(preflight);
  const transport = await options.createTransport(config);
  const result = await runOneScopedDispatch(
    options.queue,
    transport,
    options.workerId,
    dispatchId,
  );
  if (!result) throw new Error("Dispatch has no claimable pilot operation.");
  return result;
}
