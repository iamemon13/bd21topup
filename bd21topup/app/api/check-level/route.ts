import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const uid = searchParams.get("uid");

  if (!uid) {
    return NextResponse.json({ success: false, error: "UID is required" }, { status: 400 });
  }

  try {
    // ফ্রি এপিআই কল করা হচ্ছে
    const response = await fetch(`https://glob-info2.vercel.app/info?uid=${uid}`, {
      cache: "no-store",
    });

    const data = await response.json();

    if (!data || !data.basicInfo) {
      return NextResponse.json({ success: false, error: "Player not found" }, { status: 404 });
    }

    // প্রয়োজনীয় ডাটাগুলো রিটার্ন করা
    return NextResponse.json({
      success: true,
      data: {
        nickname: data.basicInfo.nickname,    // প্লেয়ারের নাম
        level: data.basicInfo.level,          // প্লেয়ারের লেভেল
        region: data.basicInfo.region,        // রিজিয়ন
        likes: data.basicInfo.liked,          // লাইক সংখ্যা
      },
    });
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch player info" }, { status: 500 });
  }
}
