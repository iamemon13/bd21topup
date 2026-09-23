import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const limits = { orders: 15, "wallet-pay": 15, "add-money": 10, withdraw: 5 } as const;
type Action = keyof typeof limits;

// Uses the existing locked PostgreSQL counter, shared across Vercel instances.
export async function checkFinancialRateLimit(request: Request, userId: string, action: Action) {
  const buckets: Array<[string, number]> = [[`user:${userId}`, limits[action]]];
  // Trust the proxy header only on Vercel. Outside Vercel, enforce the user bucket.
  const ip = process.env.VERCEL === "1"
    ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    : undefined;
  if (ip && isIP(ip)) buckets.push([`ip:${ip}`, 100]);
  try {
    for (const [identity, max] of buckets) {
      const key = createHash("sha256").update(`${action}:${identity}`).digest("hex");
      const { data, error } = await supabaseAdmin.rpc("check_uid_rate_limit", {
        p_ip: `finance:${key}`, p_max_requests: max, p_window_seconds: 60,
      });
      if (error || typeof data !== "boolean") throw new Error("Counter unavailable");
      if (!data) return NextResponse.json(
        { success: false, error: "Too many requests. Please wait a minute.", message: "Too many requests. Please wait a minute." },
        { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
      );
    }
    return null;
  } catch {
    return NextResponse.json(
      { success: false, error: "Payment requests are temporarily unavailable.", message: "Payment requests are temporarily unavailable." },
      { status: 503, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
    );
  }
}
