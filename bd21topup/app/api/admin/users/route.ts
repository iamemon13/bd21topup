import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function getAdminUser(request: Request) {
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

  if (user.id !== process.env.ADMIN_USER_ID) {
    return null;
  }

  return user;
}

export async function GET(request: Request) {
  try {
    const admin = await getAdminUser(request);

    if (!admin) {
      return NextResponse.json(
        {
          error: "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    const { data: users, error } = await supabaseAdmin
      .from("profiles")
      .select(
        `
          id,
          full_name,
          email,
          phone,
          wallet_balance,
          role,
          created_at
          `,
      )
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      console.error("ADMIN USERS ERROR:", error);

      return NextResponse.json(
        {
          error: "Users load failed",
        },
        {
          status: 500,
        },
      );
    }

    return NextResponse.json({
      success: true,
      users: users || [],
    });
  } catch (error) {
    console.error("ADMIN USERS API ERROR:", error);

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
