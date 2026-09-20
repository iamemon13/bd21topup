import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkUserRole } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    // 🔒 PERMISSION FIX: Admin/Editor must have "manage_orders" permission
    const authCheck = await checkUserRole(
      request,
      ["super_admin", "admin", "editor"],
      "manage_orders",
    );

    if ("error" in authCheck) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status },
      );
    }

    const body = await request.json();
    const { orderIds, action, cancelReason } = body;

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: "কমপক্ষে একটি অর্ডার সিলেক্ট করুন।" },
        { status: 400 },
      );
    }

    // ১. কমপ্লিট করার লজিক (State Machine Enforced)
    if (action === "completed") {
      const { error } = await supabaseAdmin
        .from("orders")
        .update({
          status: "completed",
          updated_at: new Date().toISOString(),
        })
        .in("id", orderIds)
        .in("status", ["pending"]); // 🔒 STATE MACHINE FIX: Only update valid statuses

      if (error) {
        console.error("BULK COMPLETE ERROR:", error);
        return NextResponse.json(
          { error: error.message || "অর্ডার কমপ্লিট করা যায়নি।" },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        message:
          "অর্ডারগুলো সফলভাবে প্রসেস করা হয়েছে (শুধুমাত্র Valid অর্ডারের স্ট্যাটাস আপডেট হয়েছে)।",
      });
    }

    // ২. বাতিল করার লজিক (RPC কল করে অটো-রিফান্ড সহ আপডেট)
    if (action === "cancelled") {
      if (!cancelReason || !cancelReason.trim()) {
        return NextResponse.json(
          { error: "অর্ডার বাতিল করার কারণ উল্লেখ করা বাধ্যতামূলক।" },
          { status: 400 },
        );
      }

      // প্রতিটি অর্ডারের জন্য লুপ চালিয়ে RPC কল করা
      for (const orderId of orderIds) {
        const { data, error } = await supabaseAdmin.rpc(
          "admin_cancel_order_with_refund",
          {
            p_order_id: orderId,
            p_admin_note: cancelReason.trim(),
          },
        );

        // RPC এর ভেতরেই স্টেট মেশিন চেক আছে বলে ধরে নেওয়া হচ্ছে (cancelled -> cancelled হবে না)
        if (error || (data && data.success === false)) {
          console.error(
            `BULK CANCEL RPC ERROR for order ${orderId}:`,
            error?.message || data?.message,
          );
          return NextResponse.json(
            {
              error:
                data?.message ||
                error?.message ||
                "অর্ডার বাতিল বা রিফান্ড করতে সমস্যা হয়েছে।",
            },
            { status: 500 },
          );
        }
      }

      return NextResponse.json({
        success: true,
        message: `${orderIds.length} টি অর্ডার সফলভাবে বাতিল এবং ওয়ালেট পেমেন্ট হলে রিফান্ড করা হয়েছে।`,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    console.error("BULK ACTION SERVER ERROR:", error);
    return NextResponse.json(
      { error: error?.message || "সার্ভারে সমস্যা হয়েছে।" },
      { status: 500 },
    );
  }
}
