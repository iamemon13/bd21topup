import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// অ্যাডমিন চেক করার ফাংশন
async function getAdminUser(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.replace("Bearer ", "").trim();
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) return null;

  if (process.env.ADMIN_USER_ID && user.id !== process.env.ADMIN_USER_ID) {
    return null;
  }

  return user;
}

// প্যাকেজের লিস্ট দেখার জন্য GET মেথড
export async function GET(request: Request) {
  try {
    const admin = await getAdminUser(request);
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabaseAdmin
      .from("packages")
      .select("*")
      .order("price", { ascending: true });

    if (error) {
      console.error("DB Error:", error);
      return NextResponse.json(
        { error: "Failed to load packages", details: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, packages: data });
  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json(
      { error: "Server error", details: error.message },
      { status: 500 },
    );
  }
}

// প্যাকেজের নাম এবং দাম আপডেট করার জন্য PUT মেথড
export async function PUT(request: Request) {
  try {
    const admin = await getAdminUser(request);
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, name, price } = await request.json();

    if (!id || !name || typeof price !== "number") {
      return NextResponse.json({ error: "সঠিক ডাটা দিন" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("packages")
      .update({
        name: name.trim(),
        price,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      console.error("Update Error:", error);
      return NextResponse.json(
        { error: "আপডেট করা যায়নি", details: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "প্যাকেজ সফলভাবে আপডেট হয়েছে!",
    });
  } catch (error: any) {
    console.error("Update API Error:", error);
    return NextResponse.json(
      { error: "Server error", details: error.message },
      { status: 500 },
    );
  }
}
