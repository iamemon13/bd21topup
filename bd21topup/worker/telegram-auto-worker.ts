import type { TelegramTransport } from "./telegram-transport";
import type { DispatchQueue } from "./runner";
import { runOneDispatchOperation } from "./runner.ts";
import { loadTelegramConfig, requireRealSend, type TelegramEnvironment } from "./telegram-config.ts";

export function loadAutomaticWorkerConfig(env: TelegramEnvironment) {
  if (env.TELEGRAM_AUTO_WORKER_ENABLED !== "true") {
    throw new Error("TELEGRAM_AUTO_WORKER_ENABLED=true is required.");
  }
  const config = requireRealSend(loadTelegramConfig(env));
  if (!config.supplierUsername || !config.supplierEntityId) {
    throw new Error("Automatic worker requires the pinned supplier identity.");
  }
  return config;
}

function waitForWork(signal: AbortSignal, delayMs: number) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, delayMs);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export async function runAutomaticTelegramWorker(options: {
  env: TelegramEnvironment;
  workerId: string;
  queue: DispatchQueue;
  signal: AbortSignal;
  verifySupplier(config: ReturnType<typeof loadAutomaticWorkerConfig>): Promise<void>;
  createTransport(config: ReturnType<typeof loadAutomaticWorkerConfig>): Promise<TelegramTransport>;
  idleDelayMs?: number;
  onResult?(result: Awaited<ReturnType<typeof runOneDispatchOperation>>): void;
}) {
  const config = loadAutomaticWorkerConfig(options.env);
  await options.verifySupplier(config);
  const transport = await options.createTransport(config);
  let processed = 0;
  while (!options.signal.aborted) {
    const result = await runOneDispatchOperation(options.queue, transport, options.workerId);
    options.onResult?.(result);
    if (result) {
      processed += 1;
      continue;
    }
    await waitForWork(options.signal, options.idleDelayMs ?? 2_000);
  }
  return { processed };
}
