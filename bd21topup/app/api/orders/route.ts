import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { paymentConfig } from "@/lib/payment-config";

const externalPaymentMethods = ["bkash", "nagad", "rocket", "upay"] as const;

const orderSchema = z.object({
  uid: z.coerce
    .string()
    .trim()
    .min(1, "UID required.")
    .max(100, "UID is too long."),

  playerName: z.coerce
    .string()
    .trim()
    .max(100, "Player name is too long.")
    .optional()
    .default(""),

  packageName: z.coerce
    .string()
    .trim()
    .min(1, "Package required.")
    .max(200, "Package name is too long."),

  paymentMethod: z.enum(externalPaymentMethods),

  transactionId: z.coerce
    .string()
    .trim()
    .min(4, "Transaction ID is too short.")
    .max(80, "Transaction ID is too long."),
});

export async function POST(request: Request) {
  try {
    /* =====================================================
       1. AUTH
    ===================================================== */

    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          success: false,
          error: "Login required.",
        },
        {
          status: 401,
        },
      );
    }

    const accessToken = authHeader.slice(7).trim();

    if (!accessToken) {
      return NextResponse.json(
        {
          success: false,
          error: "Login required.",
        },
        {
          status: 401,
        },
      );
    }

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(accessToken);

    if (authError || !user) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid or expired session.",
        },
        {
          status: 401,
        },
      );
    }

    /* =====================================================
       2. SAFE JSON PARSING
    ===================================================== */

    let rawBody: unknown;

    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid JSON body.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       3. VALIDATE INPUT
    ===================================================== */

    const parsed = orderSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error:
            parsed.error.issues[0]?.message || "Invalid order information.",
        },
        {
          status: 400,
        },
      );
    }

    const { uid, playerName, packageName, paymentMethod, transactionId } =
      parsed.data;

    /*
     * Wallet payment is intentionally impossible in this route.
     * Zod enum only allows external payment methods.
     */

    /* =====================================================
       4. SERVER-SIDE RECEIVER NUMBER
    ===================================================== */

    const paymentDetails = paymentConfig[paymentMethod];

    if (!paymentDetails?.number) {
      return NextResponse.json(
        {
          success: false,
          error: "Payment method configuration পাওয়া যায়নি।",
        },
        {
          status: 500,
        },
      );
    }

    const secureReceiverNumber = paymentDetails.number;

    /* =====================================================
       5. SERVER-SIDE PACKAGE LOOKUP
    ===================================================== */

    const { data: pkg, error: pkgError } = await supabaseAdmin
      .from("packages")
      .select("name, price")
      .eq("name", packageName)
      .maybeSingle();

    if (pkgError) {
      console.error("PACKAGE LOOKUP ERROR:", pkgError);

      return NextResponse.json(
        {
          success: false,
          error: "Package verify করা যায়নি।",
        },
        {
          status: 500,
        },
      );
    }

    if (!pkg) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid package. সঠিক package নির্বাচন করুন।",
        },
        {
          status: 400,
        },
      );
    }

    const secureAmount = Number(pkg.price);

    if (!Number.isFinite(secureAmount) || secureAmount <= 0) {
      console.error("INVALID PACKAGE PRICE:", {
        packageName: pkg.name,
        price: pkg.price,
      });

      return NextResponse.json(
        {
          success: false,
          error: "Package price configuration invalid.",
        },
        {
          status: 500,
        },
      );
    }

    /* =====================================================
       6. ACCOUNT NAME
    ===================================================== */

    const accountName =
      typeof user.user_metadata?.full_name === "string" &&
      user.user_metadata.full_name.trim()
        ? user.user_metadata.full_name.trim().slice(0, 150)
        : typeof user.user_metadata?.name === "string" &&
            user.user_metadata.name.trim()
          ? user.user_metadata.name.trim().slice(0, 150)
          : user.email?.split("@")[0]?.slice(0, 150) || "User";

    /* =====================================================
       7. CREATE ORDER
    ===================================================== */

    const { data: order, error: insertError } = await supabaseAdmin
      .from("orders")
      .insert({
        user_id: user.id,
        account_name: accountName,
        uid,
        player_name: playerName,
        package_name: pkg.name,
        amount: secureAmount,
        receiver_number: secureReceiverNumber,
        payment_method: paymentMethod,
        transaction_id: transactionId,
        status: "pending",
      })
      .select(
        `
          id,
          user_id,
          uid,
          player_name,
          package_name,
          amount,
          payment_method,
          receiver_number,
          transaction_id,
          status,
          created_at
        `,
      )
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json(
          {
            success: false,
            error: "এই Transaction ID ইতিমধ্যে ব্যবহার করা হয়েছে।",
          },
          {
            status: 409,
          },
        );
      }

      if (insertError.code === "23503") {
        return NextResponse.json(
          {
            success: false,
            error: "User account পাওয়া যায়নি।",
          },
          {
            status: 404,
          },
        );
      }

      if (insertError.code === "23514") {
        return NextResponse.json(
          {
            success: false,
            error: "Order information database rules পূরণ করেনি।",
          },
          {
            status: 400,
          },
        );
      }

      console.error("ORDER INSERT ERROR:", insertError);

      return NextResponse.json(
        {
          success: false,
          error: "Order save করা যায়নি। সার্ভারে সমস্যা হয়েছে।",
        },
        {
          status: 500,
        },
      );
    }

    return NextResponse.json({
      success: true,
      order,
    });
  } catch (error) {
    console.error("ORDERS API SERVER ERROR:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Server error.",
      },
      {
        status: 500,
      },
    );
  }
}
