import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const { data: orders, error } = await supabaseAdmin
      .from("orders")
      .select("id, account_name, package_name, amount, status, created_at, avatar_url")
      .order("created_at", { ascending: false })
      .limit(8);

    if (error) {
      console.error("RECENT ORDERS ERROR:", error);
      return NextResponse.json({ error: "ডাটা লোড করা যায়নি" }, { status: 500 });
    }

    return NextResponse.json({ success: true, orders: orders ?? [] });
  } catch (error) {
    console.error("API ERROR:", error);
    return NextResponse.json({ error: "সার্ভার এরর" }, { status: 500 });
  }
}

