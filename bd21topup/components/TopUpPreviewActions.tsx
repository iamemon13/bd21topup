"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import TopUpPreviewDialog from "@/components/TopUpPreviewDialog";
import type { TopupPreview } from "@/lib/topup-preview-types";

type Order = {
  id: string;
  status: string;
  payment_method: string;
  user_id?: string | null;
  cancelled_at?: string | null;
  topupMappingState?: "mapped" | "unmapped" | "unavailable";
};
export default function TopUpPreviewActions({
  order,
  disabled,
}: {
  order: Order;
  disabled: boolean;
}) {
  const busy = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<TopupPreview | null>(null);
  async function loadPreview() {
    if (busy.current || disabled) return;
    busy.current = true;
    setLoading(true);
    setError("");
    setPreview(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session)
        throw new Error("Login required. Refresh and sign in again.");
      const response = await fetch("/api/admin/orders/topup-preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ orderId: order.id }),
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(result.error || "Preview could not be generated.");
      setPreview(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Preview connection failed.",
      );
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }
  const external = order.payment_method.trim().toLowerCase() !== "wallet";
  return (
    <div className="mt-3">
      {order.topupMappingState === "unmapped" ? (
        <p className="text-xs text-amber-300">Manual / Unmapped</p>
      ) : external ? (
        <p className="text-xs text-amber-300">
          Manual payment — payment verification is not available for automatic
          top-up yet.
        </p>
      ) : order.status === "pending" && order.user_id && !order.cancelled_at ? (
        <button
          type="button"
          disabled={disabled || loading}
          onClick={loadPreview}
          className="min-h-10 w-full rounded-lg border border-violet-400/60 bg-violet-400/10 px-3 py-2 text-xs font-bold text-violet-200 disabled:opacity-50"
        >
          {loading ? "Checking eligibility…" : "Top Up Preview"}
        </button>
      ) : null}
      {error && (
        <p role="alert" className="mt-2 break-words text-xs text-red-300">
          {error}
        </p>
      )}
      {preview && (
        <TopUpPreviewDialog
          preview={preview}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
