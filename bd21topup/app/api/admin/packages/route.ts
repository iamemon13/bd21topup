import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkUserRole } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

// প্যাকেজের লিস্ট দেখার জন্য GET মেথড
export async function GET(request: Request) {
  try {
    const authCheck = await checkUserRole(
      request,
      ["super_admin", "admin", "editor"],
      "manage_packages",
    );
    if ("error" in authCheck) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status },
      );
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
    const authCheck = await checkUserRole(
      request,
      ["super_admin", "admin", "editor"],
      "manage_packages",
    );
    if ("error" in authCheck) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status },
      );
    }

    const { id, name, price } = await request.json();

    if (
      !id ||
      !name ||
      typeof price !== "number" ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      return NextResponse.json(
        { error: "সঠিক এবং পজিটিভ দাম দিন" },
        { status: 400 },
      );
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
