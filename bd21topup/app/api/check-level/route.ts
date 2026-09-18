import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const uid = searchParams.get("uid");

  if (!uid) {
    return NextResponse.json({ success: false, error: "UID is required" }, { status: 400 });
  }

  try {
    console.log("Checking UID from external API:", uid);

    const response = await fetch(`https://glob-info2.vercel.app/info?uid=${uid}`, {
      cache: "no-store",
    });

    const textResponse = await response.text();
    console.log("External API Raw Response:", textResponse);

    let data;
    try {
      data = JSON.parse(textResponse);
    } catch (parseError) {
      console.error("JSON Parse Error:", parseError);
      return NextResponse.json({ success: false, error: "Invalid response from game server" }, { status: 500 });
    }

    if (!data || !data.basicInfo) {
      return NextResponse.json({ success: false, error: "UID পাওয়া যায়নি" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      nickname: data.basicInfo.nickname,
      level: data.basicInfo.level,
      region: data.basicInfo.region,
    });
  } catch (error) {
    console.error("Level Check Server Error:", error);
    return NextResponse.json({ success: false, error: "Server error" }, { status: 500 });
  }
}
