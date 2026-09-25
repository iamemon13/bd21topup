import "server-only";
import { createHash } from "node:crypto";
import { generateTopupPreview, type PreviewDebit, type PreviewOrder, type PreviewPackage } from "@/lib/topup-preview";
import { resolveTopupMapping } from "@/lib/topup-mappings";

export type DispatchOperationInput = {
  productCode: string;
  quantity: number;
  commandHash: string;
};

export function buildDryRunDispatch(
  order: PreviewOrder,
  packages: PreviewPackage[],
  evidence: PreviewDebit[],
) {
  const preview = generateTopupPreview(order, packages, evidence);
  const mapping = resolveTopupMapping(packages[0]);
  if (!mapping) throw new Error("Validated mapping disappeared.");
  const operations: DispatchOperationInput[] = mapping.operations.map((operation, index) => ({
    productCode: operation.item,
    quantity: operation.quantity ?? 1,
    commandHash: createHash("sha256").update(
      `bd21-topup-op-v1|${preview.mappingVersion}|${preview.uid}|${index + 1}|${operation.item}|${operation.quantity ?? 1}`,
    ).digest("hex"),
  }));
  return { preview, operations };
}
