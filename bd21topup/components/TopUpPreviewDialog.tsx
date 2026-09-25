"use client";

import { useEffect, useRef, useState } from "react";
import type { TopupPreview } from "@/lib/topup-preview-types";

export default function TopUpPreviewDialog({
  preview,
  onClose,
}: {
  preview: TopupPreview;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      previousFocus?.focus();
    };
  }, []);
  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`${label} copied.`);
    } catch {
      setMessage("Copy failed. Select the command text and copy it manually.");
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="topup-preview-title"
      onCancel={onClose}
      onClose={onClose}
      className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-violet-400/40 bg-[#0b2545] p-5 text-white shadow-2xl backdrop:bg-black/80"
    >
      <h2 id="topup-preview-title" className="text-xl font-bold">
        Top Up Preview
      </h2>
      <p className="mt-3 rounded-lg bg-amber-400/10 p-3 text-sm text-amber-200">
        Preview only — no command has been sent to the supplier.
      </p>
      <p className="mt-2 text-xs text-slate-300">
        This is a snapshot, not a reservation. Recheck the order before acting
        on a copied command.
      </p>
      <dl className="mt-4 space-y-2 break-all text-sm">
        <div>
          <dt className="text-slate-400">Order ID</dt>
          <dd>{preview.orderId}</dd>
        </div>
        <div>
          <dt className="text-slate-400">UID</dt>
          <dd>{preview.uid}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Package</dt>
          <dd>{preview.packageName}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Mapping version</dt>
          <dd>{preview.mappingVersion}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Generated at</dt>
          <dd>{preview.generatedAt}</dd>
        </div>
      </dl>
      <div className="mt-4 space-y-3">
        {preview.operations.map((operation) => (
          <div key={operation.index} className="rounded-lg bg-[#07182f] p-3">
            <p className="text-xs text-slate-300">Command {operation.index}</p>
            <pre className="my-2 select-all whitespace-pre-wrap break-all font-mono text-sm">
              {operation.command}
            </pre>
            <button
              type="button"
              onClick={() =>
                copy(operation.command, `Command ${operation.index}`)
              }
              aria-label={`Copy command ${operation.index}`}
              className="min-h-10 rounded-lg bg-violet-400/20 px-4 text-sm"
            >
              Copy
            </button>
          </div>
        ))}
      </div>
      <p
        role="status"
        aria-live="polite"
        className="mt-3 text-sm text-cyan-200"
      >
        {message}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() =>
            copy(
              preview.operations.map((op) => op.command).join("\n"),
              "All commands",
            )
          }
          className="min-h-11 rounded-lg bg-violet-400 px-4 font-bold text-black"
        >
          Copy All
        </button>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="min-h-11 rounded-lg bg-slate-700 px-4 font-bold"
        >
          Close
        </button>
      </div>
    </dialog>
  );
}
