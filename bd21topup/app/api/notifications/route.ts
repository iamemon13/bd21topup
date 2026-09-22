import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadUserSupportCases } from "@/lib/support-cases";

async function getUser(request: Request) {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "").trim();

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return null;
  }

  return user;
}

export async function GET(request: Request) {
  try {
    const user = await getUser(request);

    if (!user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("notifications")
      .select(
        `
        id,
        title,
        message,
        type,
        is_read,
        support_case_id,
        created_at
        `,
      )
      .eq("user_id", user.id)
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      console.error("NOTIFICATION LOAD ERROR:", error);

      return NextResponse.json(
        {
          error: "Notification load failed",
        },
        {
          status: 500,
        },
      );
    }

    const cases = await loadUserSupportCases(user.id);
    return NextResponse.json({
      success: true,

      notifications: (data ?? []).map(({ support_case_id, ...notification }) => ({
        ...notification,
        support: cases.byId.get(support_case_id) ?? null,
      })),
    }, { headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });
  } catch (error) {
    console.error("NOTIFICATION API ERROR:", error);

    return NextResponse.json(
      {
        error: "Server error",
      },
      {
        status: 500,
      },
    );
  }
}
