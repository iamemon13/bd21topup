import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { orderIds, action, cancelReason } = body;

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: "কমপক্ষে একটি অর্ডার সিলেক্ট করুন।" },
        { status: 400 }
      );
    }

    // ১. কমপ্লিট করার লজিক
    if (action === "completed") {
      const { error } = await supabaseAdmin
        .from("orders")
        .update({
          status: "completed",
          updated_at: new Date().toISOString(),
        })
        .in("id", orderIds);

      if (error) {
        console.error("BULK COMPLETE ERROR:", error);
        throw error;
      }

      return NextResponse.json({
        success: true,
        message: `${orderIds.length} টি অর্ডার সফলভাবে কমপ্লিট করা হয়েছে।`,
      });
    }

    // ২. বাতিল করার লজিক (কারণ বাধ্যতামূলক)
    if (action === "cancelled") {
      if (!cancelReason || !cancelReason.trim()) {
        return NextResponse.json(
          { error: "অর্ডার বাতিল করার কারণ উল্লেখ করা বাধ্যতামূলক।" },
          { status: 400 }
        );
      }

      const { error } = await supabaseAdmin
        .from("orders")
        .update({
          status: "cancelled",
          cancel_reason: cancelReason.trim(),
          updated_at: new Date().toISOString(),
        })
        .in("id", orderIds);

      if (error) {
        console.error("BULK CANCEL ERROR:", error);
        throw error;
      }

      return NextResponse.json({
        success: true,
        message: `${orderIds.length} টি অর্ডার বাতিল করা হয়েছে।`,
      });
    }

    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("BULK ACTION SERVER ERROR:", error);
    return NextResponse.json(
      { error: "সার্ভারে সমস্যা হয়েছে।" },
      { status: 500 }
    );
  }
}

