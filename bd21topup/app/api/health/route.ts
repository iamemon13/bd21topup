import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  try {
    // Supabase থেকে মাত্র ১টি রো কোয়েরি করে কানেকশন সচল রাখা
    await supabaseAdmin.from("orders").select("id").limit(1);

    return NextResponse.json({ status: "ok", timestamp: Date.now() }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ status: "error" }, { status: 500 });
  }
}
