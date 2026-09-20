import { NextResponse } from "next/server";
import { checkFreeFireUid } from "../../../lib/uid-checker";
import { supabaseAdmin } from "@/lib/supabase-admin";

const RATE_LIMIT_WINDOW = 60; // 1 মিনিট (সেকেন্ডে)
const MAX_REQUESTS_PER_MINUTE = 15; // মিনিটে সর্বোচ্চ ১৫ বার
const CACHE_TTL_MINUTES = 5; // ৫ মিনিট ক্যাশ

export async function POST(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for") || "unknown_ip";

    // ==========================================
    // ১. Global Rate Limiting (Supabase RPC)
    // ==========================================
    const { data: isAllowed, error: rateLimitError } = await supabaseAdmin.rpc(
      "check_uid_rate_limit",
      {
        p_ip: ip,
        p_max_requests: MAX_REQUESTS_PER_MINUTE,
        p_window_seconds: RATE_LIMIT_WINDOW,
      },
    );

    if (rateLimitError) {
      console.error("RATE LIMIT DB ERROR:", rateLimitError);
    }

    if (isAllowed === false) {
      return NextResponse.json(
        {
          success: false,
          message:
            "আপনি অনেক বেশি রিকোয়েস্ট পাঠাচ্ছেন। ১ মিনিট পর আবার চেষ্টা করুন।",
        },
        { status: 429 }, // Too Many Requests
      );
    }

    const body = await request.json();
    const uid = String(body.uid || "").trim();

    if (!uid || !/^\d+$/.test(uid)) {
      return NextResponse.json(
        { success: false, message: "সঠিক Player UID লিখুন" },
        { status: 400 },
      );
    }

    // ==========================================
    // ২. Global Cache চেকিং
    // ==========================================
    const { data: cachedUid, error: cacheReadError } = await supabaseAdmin
      .from("uid_cache")
      .select("username, expires_at")
      .eq("uid", uid)
      .single();

    if (cacheReadError && cacheReadError.code !== "PGRST116") {
      console.error("CACHE READ ERROR:", cacheReadError);
    }

    if (cachedUid && new Date(cachedUid.expires_at) > new Date()) {
      console.log(`UID VERIFIED FROM GLOBAL CACHE: ${uid}`);
      return NextResponse.json({
        success: true,
        uid: uid,
        username: cachedUid.username,
      });
    }

    // ==========================================
    // ৩. External Provider কল (ক্যাশে না থাকলে)
    // ==========================================
    const result = await checkFreeFireUid(uid);

    if (result.success) {
      console.log(`UID VERIFIED: ${result.uid} via ${result.provider}`);

      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + CACHE_TTL_MINUTES);

      // ⚠️ ERROR LOGGING ⚠️
      const { error: upsertError } = await supabaseAdmin
        .from("uid_cache")
        .upsert({
          uid: result.uid,
          username: result.username,
          expires_at: expiresAt.toISOString(),
        });

      if (upsertError) {
        console.error("❌ CACHE SAVE ERROR:", upsertError);
      } else {
        console.log("✅ CACHE SAVED SUCCESSFULLY");
      }

      return NextResponse.json({
        success: true,
        uid: result.uid,
        username: result.username,
      });
    }

    return NextResponse.json({
      success: false,
      message: result.message,
    });
  } catch (error) {
    console.error("UID CHECK ERROR:", error);
    return NextResponse.json(
      { success: false, message: "UID check করা যাচ্ছে না" },
      { status: 500 },
    );
  }
}
