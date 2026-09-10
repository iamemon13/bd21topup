import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function getUser(request: Request) {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "").trim();

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

/*
  Mark notification as read.

  Body:
  {
    "notificationId": "uuid"
  }

  Or mark all:
  {
    "all": true
  }
*/

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

    const body = await request.json();

    const notificationId = String(body.notificationId || "").trim();

    const markAll = body.all === true;

    // =====================================================
    // MARK ALL AS READ
    // =====================================================

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

    // =====================================================
    // SINGLE NOTIFICATION
    // =====================================================

    if (!notificationId) {
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
