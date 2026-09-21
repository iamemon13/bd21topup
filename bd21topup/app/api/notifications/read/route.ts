import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getUser(request: Request) {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7).trim();

  if (!token) {
    return null;
  }

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return null;
  }

  return user;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function PATCH(request: Request) {
  try {
    const user = await getUser(request);

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    let rawBody: unknown;

    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid JSON body.",
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
          error: "Invalid request body.",
        },
        {
          status: 400,
        },
      );
    }

    const markAll = rawBody.all === true;

    /* =====================================================
       MARK ALL AS READ
    ===================================================== */

    if (markAll) {
      const { error } = await supabaseAdmin
        .from("notifications")
        .update({
          is_read: true,
        })
        .eq("user_id", user.id)
        .eq("is_read", false);

      if (error) {
        console.error("MARK ALL NOTIFICATIONS READ ERROR:", error);

        return NextResponse.json(
          {
            success: false,
            error: "Notifications update করা যায়নি।",
          },
          {
            status: 500,
          },
        );
      }

      return NextResponse.json({
        success: true,
        message: "All notifications marked as read.",
      });
    }

    /* =====================================================
       SINGLE NOTIFICATION
    ===================================================== */

    if (typeof rawBody.notificationId !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "Notification ID required.",
        },
        {
          status: 400,
        },
      );
    }

    const notificationId = rawBody.notificationId.trim();

    if (!UUID_REGEX.test(notificationId)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid notification ID.",
        },
        {
          status: 400,
        },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("notifications")
      .update({
        is_read: true,
      })
      .eq("id", notificationId)
      .eq("user_id", user.id)
      .select("id, title, message, type, is_read, created_at")
      .maybeSingle();

    if (error) {
      console.error("MARK NOTIFICATION READ ERROR:", error);

      return NextResponse.json(
        {
          success: false,
          error: "Notification update করা যায়নি।",
        },
        {
          status: 500,
        },
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          success: false,
          error: "Notification পাওয়া যায়নি।",
        },
        {
          status: 404,
        },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Notification marked as read.",
      notification: data,
    });
  } catch (error) {
    console.error("NOTIFICATION READ API ERROR:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Server error.",
      },
      {
        status: 500,
      },
    );
  }
}
