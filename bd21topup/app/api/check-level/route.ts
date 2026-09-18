import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const uid = searchParams.get("uid");

  if (!uid) {
    return NextResponse.json({ success: false, error: "UID is required" }, { status: 400 });
  }

  try {
    // সচল ফ্রি ফায়ার এপিআই এন্ডপয়েন্ট ব্যবহার করা হচ্ছে
    const response = await fetch(`https://freefire-api-six.vercel.app/get_player_personal_show?server=ind&uid=${uid}`, {
      cache: "no-store",
    });

    const data = await response.json();

    // সোর্স অনুযায়ী এপিআই রেসপন্স স্ট্রাকচার হ্যান্ডেল করা
    if (!data || (!data.nickname && !data.name)) {
      return NextResponse.json({ success: false, error: "UID পাওয়া যায়নি" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      nickname: data.nickname || data.name || "Player",
      level: data.level || 0,
      region: data.server || "IND",
    });
  } catch (error) {
    console.error("Level Check Server Error:", error);
    return NextResponse.json({ success: false, error: "Server error" }, { status: 500 });
  }
}
