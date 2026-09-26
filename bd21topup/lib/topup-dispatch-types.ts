export type DryRunDispatch = {
  id: string;
  orderId: string;
  status: string;
  dryRun: true;
  mappingVersion: string;
  uid: string;
  packageName: string;
  amount: number | string;
  created: boolean;
  manualReviewReason: string | null;
  failureReason: string | null;
  auditTrail: Array<{ actionType: string; createdAt: string | null }>;
  operations: Array<{
    id: string;
    sequence: number;
    productCode: string;
    quantity: number;
    commandHash: string;
    status: string;
    failureReason: string | null;
    hasPreviousSendIntent: boolean;
  }>;
};
