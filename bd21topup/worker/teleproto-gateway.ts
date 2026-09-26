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

  async waitForReply(username: string, supplierEntityId: string, sentMessageId: string, timeoutMs: number,
    isFinal: (reply: { senderEntityId: string; messageId: string; replyToMessageId?: string; text: string }) => boolean) {
    const deadline = Date.now() + timeoutMs;
    let replyMessageId: string | null = null;
    let latestReply = null;
    while (Date.now() < deadline) {
      const messages = await this.client.getMessages(username, { limit: 20 });
      const reply = messages.find((message) => String(message.senderId ?? "") === supplierEntityId
        && String(message.replyTo?.replyToMsgId ?? "") === sentMessageId
        && (replyMessageId === null || String(message.id) === replyMessageId));
      if (reply) {
        replyMessageId ??= String(reply.id);
        latestReply = {
        senderEntityId: String(reply.senderId ?? ""), messageId: String(reply.id),
        replyToMessageId: String(reply.replyTo?.replyToMsgId ?? ""), text: reply.message,
        };
        if (isFinal(latestReply)) return latestReply;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return latestReply;
  }

  saveSession() {
    return String(this.client.session.save());
  }

  async disconnect() {
    await this.client.disconnect();
  }
}
