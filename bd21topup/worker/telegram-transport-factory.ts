import { DryRunTelegramTransport } from "./dry-run-telegram-transport";
import { RealTelegramTransport } from "./real-telegram-transport";
import type { MtprotoGateway } from "./mtproto-gateway";
import type { TelegramConfig } from "./telegram-config";
import type { TelegramTransport } from "./telegram-transport";

export function createTelegramTransport(config: TelegramConfig, gateway?: MtprotoGateway): TelegramTransport {
  if (config.mode === "dry-run") return new DryRunTelegramTransport();
  if (!gateway) throw new Error("Real Telegram transport requires an MTProto gateway.");
  return new RealTelegramTransport(config, gateway);
}
