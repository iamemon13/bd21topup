export type DeliveryOperation = { operationId: string; uid: string; productCode: string; quantity: number; commandHash: string };
export type SupplierResponseMetadata = {
  supplierEntityId: string; sentMessageId: string; replyMessageId: string; replyToMessageId: string;
  uid: string; productCode: string; quantity: number;
  supplierOrderId?: string; supplierReference?: string;
};
export type DeliveryResult = {
  kind: "dry_run_completed" | "failed" | "uncertain"; dryRun: boolean; resultHash: string; summary: string;
  supplierMessageId?: string; supplierResponse?: SupplierResponseMetadata;
} | {
  kind: "verified_success"; dryRun: false; resultHash: string; summary: string; supplierResponse: SupplierResponseMetadata;
};
export interface TelegramTransport { sendOperation(operation: DeliveryOperation): Promise<DeliveryResult>; }
