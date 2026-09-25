export type DeliveryOperation = { operationId: string; uid: string; productCode: string; quantity: number; commandHash: string };
export type DeliveryResult = { kind: "dry_run_completed" | "failed" | "uncertain"; dryRun: boolean; resultHash: string; summary: string };
export interface TelegramTransport { sendOperation(operation: DeliveryOperation): Promise<DeliveryResult>; }
