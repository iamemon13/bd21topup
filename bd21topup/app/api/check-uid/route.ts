import { NextResponse } from "next/server";
import { checkFreeFireUid } from "../../../lib/uid-checker";

// 🔒 SECURITY FIX: In-memory Cache & Rate Limiting Maps
const uidCache = new Map<string, { username: string; expiresAt: number }>();
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const RATE_LIMIT_WINDOW = 60 * 1000; // 1 মিনিট
const MAX_REQUESTS_PER_MINUTE = 15; // মিনিটে সর্বোচ্চ ১৫ বার
const CACHE_TTL = 5 * 60 * 1000; // ৫ মিনিট ক্যাশ

export async function POST(request: Request) {
  try {
    const now = Date.now();

    // আইপি অ্যাড্রেস বের করা (Vercel-এর জন্য x-forwarded-for)
    const ip = request.headers.get("x-forwarded-for") || "unknown_ip";

    // ১. Rate Limiting লজিক
    const userRate = rateLimitMap.get(ip);
    if (userRate && userRate.resetAt > now) {
      if (userRate.count >= MAX_REQUESTS_PER_MINUTE) {
        return NextResponse.json(
          {
            success: false,
            message:
              "আপনি অনেক বেশি রিকোয়েস্ট পাঠাচ্ছেন। ১ মিনিট পর আবার চেষ্টা করুন।",
          },
          { status: 429 }, // Too Many Requests
        );
      }
      userRate.count += 1;
    } else {
      rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    }

    const body = await request.json();
    const uid = String(body.uid || "").trim();

    if (!uid) {
      return NextResponse.json(
        { success: false, message: "আগে Player UID লিখুন" },
        { status: 400 },
      );
    }

    // Only numbers
    if (!/^\d+$/.test(uid)) {
      return NextResponse.json(
        { success: false, message: "সঠিক Player UID লিখুন" },
        { status: 400 },
      );
    }

    // ২. Cache চেকিং লজিক
    const cachedResult = uidCache.get(uid);
    if (cachedResult && cachedResult.expiresAt > now) {
      console.log(`UID VERIFIED FROM CACHE: ${uid}`);
      return NextResponse.json({
        success: true,
        uid: uid,
        username: cachedResult.username,
      });
    }

    // ৩. External Provider কল (যদি ক্যাশে না থাকে)
    const result = await checkFreeFireUid(uid);

    if (result.success) {
      console.log(`UID VERIFIED: ${result.uid} via ${result.provider}`);

      // নতুন রেজাল্ট ক্যাশে সেভ করা
      uidCache.set(result.uid, {
        username: result.username,
        expiresAt: now + CACHE_TTL,
      });

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
