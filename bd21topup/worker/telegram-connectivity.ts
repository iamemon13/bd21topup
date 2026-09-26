import type { MtprotoGateway, SafeTelegramEntity, TelegramAuthPrompts } from "./mtproto-gateway";

export async function checkTelegramConnectivity(
  gateway: MtprotoGateway,
  supplierUsername: string,
  supplierEntityId: string,
  prompts?: TelegramAuthPrompts,
): Promise<SafeTelegramEntity> {
  try {
    if (prompts && gateway.authenticate) await gateway.authenticate(prompts);
    else await gateway.connect();
    const entity = await gateway.resolve(supplierUsername);
    if (
      entity.username.toLowerCase() !== supplierUsername.toLowerCase() ||
      entity.id !== supplierEntityId
    ) {
      throw new Error("Configured Telegram supplier identity did not match.");
    }
    return entity;
  } finally {
    await gateway.disconnect().catch(() => undefined);
  }
}
