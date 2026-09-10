import { NextResponse } from "next/server";
import { checkFreeFireUid } from "../../../lib/uid-checker";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const uid = String(body.uid || "").trim();

    if (!uid) {
      return NextResponse.json(
        {
          success: false,
          message: "আগে Player UID লিখুন",
        },
        { status: 400 }
      );
    }

    // Only numbers
    if (!/^\d+$/.test(uid)) {
      return NextResponse.json(
        {
          success: false,
          message: "সঠিক Player UID লিখুন",
        },
        { status: 400 }
      );
    }

    const result = await checkFreeFireUid(uid);

    if (result.success) {
      console.log(
        `UID VERIFIED: ${result.uid} via ${result.provider}`
      );

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
      {
        success: false,
        message: "UID check করা যাচ্ছে না",
      },
      { status: 500 }
    );
  }
}