export type SafeTelegramEntity = {
  id: string;
  username: string;
  type: "user" | "bot" | "channel" | "group";
};
export type SafeSupplierReply = { senderEntityId: string; messageId: string; replyToMessageId?: string; text: string };

export interface MtprotoGateway {
  connect(): Promise<void>;
  authenticate?(prompts: TelegramAuthPrompts): Promise<void>;
  resolve(username: string): Promise<SafeTelegramEntity>;
  sendText(username: string, text: string): Promise<{ messageId: string; sentAt: Date }>;
  waitForReply?(username: string, supplierEntityId: string, sentMessageId: string, timeoutMs: number,
    isFinal: (reply: SafeSupplierReply) => boolean): Promise<SafeSupplierReply | null>;
  saveSession?(): string;
  disconnect(): Promise<void>;
}

export type TelegramAuthPrompts = {
  phoneNumber(): Promise<string>;
  phoneCode(): Promise<string>;
  password(): Promise<string>;
};
