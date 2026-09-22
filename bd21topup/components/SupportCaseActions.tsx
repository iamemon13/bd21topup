"use client";

import { useState } from "react";
import type { SupportCase } from "@/lib/support";

export default function SupportCaseActions({ support }: { support?: SupportCase | null }) {
  const [message, setMessage] = useState("");
  if (!support) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(support!.supportId);
      setMessage("Support ID কপি হয়েছে।");
    } catch {
      setMessage("কপি করা যায়নি। Support ID নির্বাচন করে কপি করুন।");
    }
  }

  return (
    <div className="m-3 min-w-0 rounded-xl border border-cyan-400/25 bg-[#07182f] p-3 text-left">
      <p className="text-xs font-bold text-cyan-300">Support ID</p>
      <p className="mt-1 select-all break-all font-mono text-sm text-white">{support.supportId}</p>
      <p className="mt-2 break-words text-xs text-slate-300">{support.reason}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="rounded-lg bg-cyan-400/15 px-3 py-2 text-xs font-bold text-cyan-300">কপি করুন</button>
        {support.contactUrl ? (
          <a href={support.contactUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-cyan-400 px-3 py-2 text-xs font-bold text-black">সাপোর্টে যোগাযোগ</a>
        ) : <span className="text-xs text-amber-300">সাপোর্ট লিংক এখন উপলব্ধ নয়। ID সংরক্ষণ করুন।</span>}
      </div>
      <p className="mt-2 text-xs text-slate-400">Telegram-এ এই ID এবং রসিদ বা স্ক্রিনশট পাঠান।</p>
      <p role="status" className="mt-1 text-xs text-cyan-300">{message}</p>
    </div>
  );
}
