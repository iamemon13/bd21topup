// Public response contract only; never import the supplier manifest into the UI.
export type TopupPreview = {
  success: true;
  orderId: string;
  uid: string;
  packageId: string;
  packageName: string;
  category: string;
  mappingVersion: string;
  generatedAt: string;
  operations: { index: number; command: string }[];
};
