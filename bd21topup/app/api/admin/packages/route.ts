import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

  // অ্যাডমিন আইডি চেক (আপনার আগের সিস্টেম অনুযায়ী)
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
      .order("price", { ascending: true }); // দাম অনুযায়ী সাজানো থাকবে

    if (error) {
      return NextResponse.json(
        { error: "Failed to load packages" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, packages: data });
  } catch (error) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// দাম আপডেট করার জন্য PUT মেথড
export async function PUT(request: Request) {
  try {
    const admin = await getAdminUser(request);
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, price } = await request.json();

    if (!id || typeof price !== "number") {
      return NextResponse.json({ error: "সঠিক ডাটা দিন" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("packages")
      .update({
        price,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      return NextResponse.json(
        { error: "দাম আপডেট করা যায়নি" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "প্যাকেজের দাম সফলভাবে আপডেট হয়েছে!",
    });
  } catch (error) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
