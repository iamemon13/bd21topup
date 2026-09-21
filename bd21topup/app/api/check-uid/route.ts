import { NextResponse } from "next/server";
import { checkFreeFireUid } from "../../../lib/uid-checker";
import { supabaseAdmin } from "@/lib/supabase-admin";

const RATE_LIMIT_WINDOW = 60;
const MAX_REQUESTS_PER_MINUTE = 15;
const CACHE_TTL_MINUTES = 5;
const MAX_USERNAME_LENGTH = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getClientIp(request: Request) {
  const vercelForwardedFor = request.headers.get("x-vercel-forwarded-for");

  if (vercelForwardedFor) {
    const first = vercelForwardedFor.split(",")[0]?.trim();

    if (first) {
      return first.slice(0, 100);
    }
  }

  const realIp = request.headers.get("x-real-ip");

  if (realIp?.trim()) {
    return realIp.trim().slice(0, 100);
  }

  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();

    if (first) {
      return first.slice(0, 100);
    }
  }

  return "unknown";
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);

    /* =====================================================
       RATE LIMIT
    ===================================================== */

    const { data: isAllowed, error: rateLimitError } = await supabaseAdmin.rpc(
      "check_uid_rate_limit",
      {
        p_ip: ip,
        p_max_requests: MAX_REQUESTS_PER_MINUTE,
        p_window_seconds: RATE_LIMIT_WINDOW,
      },
    );

    if (rateLimitError) {
      console.error("UID RATE LIMIT ERROR:", rateLimitError);

      return NextResponse.json(
        {
          success: false,
          message: "Service temporarily unavailable. Please try again.",
        },
        {
          status: 503,
        },
      );
    }

    if (isAllowed !== true) {
      return NextResponse.json(
        {
          success: false,
          message:
            "আপনি অনেক বেশি রিকোয়েস্ট পাঠাচ্ছেন। ১ মিনিট পর আবার চেষ্টা করুন।",
        },
        {
          status: 429,
        },
      );
    }

    /* =====================================================
       REQUEST BODY
    ===================================================== */

    let rawBody: unknown;

    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid JSON body.",
        },
        {
          status: 400,
        },
      );
    }

    if (!isRecord(rawBody)) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid request body.",
        },
        {
          status: 400,
        },
      );
    }

    if (typeof rawBody.uid !== "string" && typeof rawBody.uid !== "number") {
      return NextResponse.json(
        {
          success: false,
          message: "সঠিক Player UID লিখুন।",
        },
        {
          status: 400,
        },
      );
    }

    const uid = String(rawBody.uid).trim();

    if (!/^\d{5,15}$/.test(uid)) {
      return NextResponse.json(
        {
          success: false,
          message: "সঠিক Player UID লিখুন (৫ থেকে ১৫ সংখ্যার মধ্যে)।",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       CACHE
    ===================================================== */

    const { data: cachedUid, error: cacheReadError } = await supabaseAdmin
      .from("uid_cache")
      .select("username, expires_at")
      .eq("uid", uid)
      .maybeSingle();

    if (cacheReadError) {
      console.error("UID CACHE READ ERROR:", cacheReadError);
    }

    if (cachedUid) {
      const expiresAt = new Date(cachedUid.expires_at).getTime();

      if (
        Number.isFinite(expiresAt) &&
        expiresAt > Date.now() &&
        typeof cachedUid.username === "string" &&
        cachedUid.username.trim()
      ) {
        return NextResponse.json({
          success: true,
          uid,
          username: cachedUid.username.trim().slice(0, MAX_USERNAME_LENGTH),
        });
      }
    }

    /* =====================================================
       PROVIDER LOOKUP
    ===================================================== */

    const result = await checkFreeFireUid(uid);

    if (!result.success) {
      return NextResponse.json({
        success: false,
        message: result.message,
      });
    }

    const safeUsername = result.username.trim().slice(0, MAX_USERNAME_LENGTH);

    if (!safeUsername) {
      return NextResponse.json(
        {
          success: false,
          message: "UID check করা যাচ্ছে না",
        },
        {
          status: 502,
        },
      );
    }

    const safeUid = /^\d{5,15}$/.test(result.uid) ? result.uid : uid;

    const expiresAt = new Date(Date.now() + CACHE_TTL_MINUTES * 60 * 1000);

    const { error: upsertError } = await supabaseAdmin.from("uid_cache").upsert(
      {
        uid: safeUid,
        username: safeUsername,
        expires_at: expiresAt.toISOString(),
      },
      {
        onConflict: "uid",
      },
    );

    if (upsertError) {
      console.error("UID CACHE SAVE ERROR:", upsertError);
    }

    return NextResponse.json({
      success: true,
      uid: safeUid,
      username: safeUsername,
    });
  } catch (error) {
    console.error("UID CHECK ERROR:", error);

    return NextResponse.json(
      {
        success: false,
        message: "UID check করা যাচ্ছে না",
      },
      {
        status: 500,
      },
    );
  }
}
