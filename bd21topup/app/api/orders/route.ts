import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { paymentConfig } from "@/lib/payment-config";

type PaymentMethod = keyof typeof paymentConfig;

async function getRequiredUserId(request: Request) {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return {
      userId: null as string | null,
      error: "Order করতে আগে Login করুন।",
    };
  }

  const accessToken = authHeader.replace("Bearer ", "").trim();

  if (!accessToken) {
    return {
      userId: null,
      error: "Order করতে আগে Login করুন।",
    };
  }

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !user) {
    return {
      userId: null,
      error: "আপনার Login session শেষ হয়েছে। আবার Login করুন।",
    };
  }

  return {
    userId: user.id,
    error: null,
  };
}

export async function POST(request: Request) {
  try {
    const auth = await getRequiredUserId(request);

    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const body = await request.json();

    const uid = String(body.uid || "").trim();
    const playerName = String(body.playerName || "").trim();
    const packageName = String(body.packageName || "").trim();
    const paymentMethod = String(body.paymentMethod || "").trim();
    const transactionId = String(body.transactionId || "").trim();

    if (
      !uid ||
      !playerName ||
      !packageName ||
      !paymentMethod ||
      !transactionId
    ) {
      return NextResponse.json(
        { error: "সব তথ্য পূরণ করুন।" },
        { status: 400 },
      );
    }

    if (!/^\d+$/.test(uid)) {
      return NextResponse.json({ error: "Invalid UID." }, { status: 400 });
    }

    // ডাটাবেস থেকে রিয়েল-টাইম প্যাকেজের দাম চেক করা হচ্ছে
    const { data: packageData, error: packageError } = await supabaseAdmin
      .from("packages")
      .select("price")
      .eq("name", packageName)
      .single();

    if (packageError || !packageData) {
      return NextResponse.json({ error: "Invalid package." }, { status: 400 });
    }

    const amount = packageData.price;

    if (!(paymentMethod in paymentConfig)) {
      return NextResponse.json(
        { error: "Invalid payment method." },
        { status: 400 },
      );
    }

    const method = paymentMethod as PaymentMethod;
    const receiverNumber = paymentConfig[method].number;

    const { data, error } = await supabaseAdmin
      .from("orders")
      .insert({
        user_id: auth.userId,
        uid,
        player_name: playerName,
        product_name: "Free Fire UID TopUp",
        package_name: packageName,
        amount,
        payment_method: method,
        receiver_number: receiverNumber,
        transaction_id: transactionId,
        status: "pending",
      })
      .select("id, user_id, status, created_at")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "এই Transaction ID আগে ব্যবহার করা হয়েছে।" },
          { status: 409 },
        );
      }

      console.error("ORDER CREATE ERROR:", error);

      return NextResponse.json(
        { error: "Order তৈরি করা যায়নি।" },
        { status: 500 },
      );
    }

    console.log("PENDING ORDER CREATED:", data.id, `user=${data.user_id}`);

    return NextResponse.json({
      success: true,
      message: "Order successfully submitted.",
      order: data,
    });
  } catch (error) {
    console.error("ORDER API ERROR:", error);

    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
