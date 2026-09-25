import "server-only";
import {
  resolveTopupMapping,
  TOPUP_MAPPING_VERSION,
} from "@/lib/topup-mappings";

export type PreviewOrder = {
  id: string;
  user_id: string | null;
  uid: string;
  package_name: string;
  amount: number | string;
  payment_method: string;
  status: string;
  cancelled_at: string | null;
};
export type PreviewPackage = {
  id: string;
  name: string;
  category: string | null;
};
export type PreviewDebit = {
  id: string;
  reference_id: string | null;
  user_id: string;
  amount: number | string;
  type: string;
  direction: string;
};
export class PreviewError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

export function assertPreviewOrder(
  order: PreviewOrder | null,
): asserts order is PreviewOrder {
  if (!order)
    throw new PreviewError("ORDER_NOT_FOUND", "Order not found.", 404);
  if (order.payment_method.trim().toLowerCase() !== "wallet")
    throw new PreviewError(
      "PAYMENT_UNVERIFIED",
      "Payment verification is not available for automatic top-up yet.",
    );
  if (order.status !== "pending")
    throw new PreviewError(
      "ORDER_NOT_PENDING",
      "Only pending orders can be previewed.",
    );
  if (!order.user_id)
    throw new PreviewError(
      "ORDER_OWNER_MISSING",
      "Order has no customer account.",
    );
  if (order.cancelled_at !== null)
    throw new PreviewError(
      "ORDER_CANCELLED",
      "Order has cancellation evidence.",
    );
  // Unlike $, this requires the actual end of input, including final newlines.
  if (
    typeof order.uid !== "string" ||
    !/^[0-9]{5,15}(?![\s\S])/.test(order.uid)
  )
    throw new PreviewError(
      "INVALID_UID",
      "Stored UID must contain exactly 5–15 ASCII digits, without spaces or other characters.",
    );
}

function cents(value: number | string): number | null {
  const text = String(value);
  if (!/^[0-9]+(?:\.[0-9]{1,2})?(?![\s\S])/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

export function generateTopupPreview(
  order: PreviewOrder,
  packages: PreviewPackage[],
  evidence: PreviewDebit[],
) {
  assertPreviewOrder(order);
  if (evidence.some((row) => row.type === "refund"))
    throw new PreviewError(
      "REFUND_PRESENT",
      "A refund exists for this order. Manual review required.",
    );
  // Load ALL types/directions for this reference, not just matching debits.
  // Any second row is ambiguous; two rows suffice to reject an arbitrarily large history.
  if (evidence.length === 0)
    throw new PreviewError(
      "DEBIT_MISSING",
      "No canonical wallet payment was found.",
    );
  if (evidence.length !== 1)
    throw new PreviewError(
      "AMBIGUOUS_EVIDENCE",
      "Multiple financial records exist. Manual review required.",
    );
  const debit = evidence[0];
  const amount = cents(order.amount);
  if (
    !amount ||
    debit.reference_id !== order.id ||
    debit.user_id !== order.user_id ||
    debit.type !== "order_payment" ||
    debit.direction !== "debit" ||
    cents(debit.amount) !== amount
  )
    throw new PreviewError(
      "CONFLICTING_EVIDENCE",
      "Wallet payment evidence does not match the order.",
    );
  if (packages.length !== 1 || packages[0].name !== order.package_name)
    throw new PreviewError(
      "PACKAGE_UNRESOLVED",
      "Manual / Unmapped: current package could not be resolved uniquely.",
    );
  const pkg = packages[0];
  const mapping = resolveTopupMapping(pkg);
  if (!mapping)
    throw new PreviewError(
      "PACKAGE_UNMAPPED",
      "Manual / Unmapped: package UUID, name or category is not approved.",
    );
  return {
    orderId: order.id,
    uid: order.uid,
    packageId: pkg.id,
    packageName: pkg.name,
    category: mapping.category,
    mappingVersion: TOPUP_MAPPING_VERSION,
    operations: mapping.operations.map((op, index) => ({
      index: index + 1,
      command: `Ktp ${order.uid} ${op.item}${op.quantity === undefined ? "" : ` ${op.quantity}`}`,
    })),
  };
}
