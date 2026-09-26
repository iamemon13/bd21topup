"use client";
import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import TopUpPreviewDialog from "@/components/TopUpPreviewDialog";
import type { TopupPreview } from "@/lib/topup-preview-types";
import type { DryRunDispatch } from "@/lib/topup-dispatch-types";

export async function fetchCurrentDispatch(accessToken: string, dispatchId: string, request: typeof fetch = fetch) {
  const response = await request(`/api/admin/orders/topup-dispatch?dispatchId=${encodeURIComponent(dispatchId)}`, {
    method: "GET", headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "Status refresh failed.");
  return result.dispatch as DryRunDispatch;
}

type Order = { id: string; status: string; payment_method: string; user_id?: string | null; cancelled_at?: string | null; topupMappingState?: "mapped" | "unmapped" | "unavailable" };
export default function TopUpPreviewActions({ order, disabled }: { order: Order; disabled: boolean }) {
  const busy = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<TopupPreview | null>(null);
  const [dispatch, setDispatch] = useState<DryRunDispatch | null>(null);
  async function post(path: string) {
    if (busy.current || disabled) return null;
    busy.current = true; setLoading(true); setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Login required. Refresh and sign in again.");
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ orderId: order.id }), cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "Action failed.");
      return result;
    } catch (err) { setError(err instanceof Error ? err.message : "Connection failed."); return null; }
    finally { busy.current = false; setLoading(false); }
  }
  async function loadPreview() { setPreview(null); const result = await post("/api/admin/orders/topup-preview"); if (result) setPreview(result); }
  async function createDryRunDispatch() { const result = await post("/api/admin/orders/topup-dispatch"); if (result) setDispatch(result.dispatch); }
  async function refreshDispatch() {
    if (busy.current || !dispatch) return;
    busy.current = true; setLoading(true); setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Login required. Refresh and sign in again.");
      setDispatch(await fetchCurrentDispatch(session.access_token, dispatch.id));
    } catch (err) { setError(err instanceof Error ? err.message : "Connection failed."); }
    finally { busy.current = false; setLoading(false); }
  }
  const external = order.payment_method.trim().toLowerCase() !== "wallet";
  return <div className="mt-3">
    {order.topupMappingState === "unmapped" ? <p className="text-xs text-amber-300">Manual / Unmapped</p>
      : external ? <p className="text-xs text-amber-300">Manual payment — payment verification is not available for automatic top-up yet.</p>
      : order.status === "pending" && order.user_id && !order.cancelled_at ? <div className="space-y-2">
        <button type="button" disabled={disabled || loading} onClick={loadPreview} className="min-h-10 w-full rounded-lg border border-violet-400/60 bg-violet-400/10 px-3 py-2 text-xs font-bold text-violet-200 disabled:opacity-50">{loading ? "Checking eligibility…" : "Top Up Preview"}</button>
        <button type="button" disabled={disabled || loading} onClick={createDryRunDispatch} className="min-h-10 w-full rounded-lg border border-amber-400/60 bg-amber-400/10 px-3 py-2 text-xs font-black text-amber-200 disabled:opacity-50">Create DRY-RUN Dispatch</button>
        <p className="text-center text-[10px] font-bold text-amber-300">DRY RUN — NO TELEGRAM MESSAGE WILL BE SENT</p>
      </div> : null}
    {error && <p role="alert" className="mt-2 break-words text-xs text-red-300">{error}</p>}
    {preview && <TopUpPreviewDialog preview={preview} onClose={() => setPreview(null)} />}
    {dispatch && <section className="mt-3 rounded-xl border border-amber-400/40 bg-[#07182f] p-3 text-xs text-slate-200">
      <div className="flex items-center justify-between gap-2"><strong className="text-amber-300">DRY RUN · {dispatch.status}</strong><div className="flex items-center gap-2"><button type="button" disabled={loading} onClick={refreshDispatch} className="rounded border border-sky-400/50 px-2 py-1 text-sky-200 disabled:opacity-50">{loading ? "Refreshing…" : "Refresh status"}</button><button type="button" onClick={() => setDispatch(null)} className="text-slate-400">Close</button></div></div>
      <p className="mt-2 break-all">Dispatch: {dispatch.id}</p><p>Mapping: {dispatch.mappingVersion}</p><p>UID: {dispatch.uid}</p><p>Package: {dispatch.packageName}</p>
      {(dispatch.manualReviewReason || dispatch.failureReason) && <p className="mt-2 rounded bg-red-400/10 p-2 text-red-200">{dispatch.manualReviewReason || dispatch.failureReason}</p>}
      <ol className="mt-2 space-y-1">{dispatch.operations.map((operation) => <li key={operation.id} className="rounded bg-white/5 p-2">{operation.sequence}. {operation.productCode}{operation.quantity > 1 ? ` × ${operation.quantity}` : ""} · {operation.status}{operation.failureReason && <span className="mt-1 block break-words text-red-200">{operation.failureReason}</span>}<span className="mt-1 block break-all text-[10px] text-slate-500">Hash: {operation.commandHash}</span></li>)}</ol>
      <div className="mt-2"><strong>Audit trail</strong>{dispatch.auditTrail.map((entry, index) => <p key={`${entry.actionType}-${index}`} className="text-[10px] text-slate-400">{entry.actionType}{entry.createdAt ? ` / ${entry.createdAt}` : ""}</p>)}</div>
    </section>}
  </div>;
}
