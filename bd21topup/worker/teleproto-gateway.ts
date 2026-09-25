import { TelegramClient, Api } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import type { MtprotoGateway, SafeTelegramEntity, TelegramAuthPrompts } from "./mtproto-gateway";

export class TeleprotoGateway implements MtprotoGateway {
  private readonly client: TelegramClient;

  constructor(session: string, apiId: number, apiHash: string) {
    this.client = new TelegramClient(new StringSession(session), apiId, apiHash, {
      connectionRetries: 1,
      autoReconnect: false,
    });
  }

  async connect() {
    await this.client.connect();
  }

  async authenticate(prompts: TelegramAuthPrompts) {
    await this.client.start({
      phoneNumber: prompts.phoneNumber,
      phoneCode: prompts.phoneCode,
      password: prompts.password,
      onError: () => undefined,
    });
  }

  async resolve(username: string): Promise<SafeTelegramEntity> {
    const entity = await this.client.getEntity(username);
    if (entity instanceof Api.User) {
      const resolvedUsername = entity.usernames?.find((item) => item.active)?.username ?? entity.username;
      if (!resolvedUsername) throw new Error("Resolved Telegram user has no public username.");
      return { id: entity.id.toString(), username: resolvedUsername, type: entity.bot ? "bot" : "user" };
    }
    if (entity instanceof Api.Channel) {
      if (!entity.username) throw new Error("Resolved Telegram channel has no public username.");
      return { id: entity.id.toString(), username: entity.username, type: entity.megagroup ? "group" : "channel" };
    }
    throw new Error("Configured Telegram supplier resolved to an unsupported entity type.");
  }

  async sendText(username: string, text: string) {
    const message = await this.client.sendMessage(username, { message: text });
    return { messageId: String(message.id), sentAt: new Date(message.date * 1000) };
  }

  saveSession() {
    return String(this.client.session.save());
  }

  async disconnect() {
    await this.client.disconnect();
  }
}
