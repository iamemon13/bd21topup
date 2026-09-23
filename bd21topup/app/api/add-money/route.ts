import { checkFinancialRateLimit } from "@/lib/financial-rate-limit";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { paymentConfig } from "@/lib/payment-config";
import { z } from "zod";

const allowedMethods = ["bkash", "nagad", "rocket", "upay"] as const;

const addMoneySchema = z.object({
  amount: z.coerce
    .number()
    .finite()
    .min(10, "Amount কমপক্ষে ৳10 হতে হবে।")
    .max(100000, "Amount সর্বোচ্চ ৳100,000 হতে পারবে।"),

  paymentMethod: z.enum(allowedMethods, {
    message: "সঠিক payment method select করুন।",
  }),

  transactionId: z
    .string()
    .trim()
    .min(4, "সঠিক Transaction ID দিন।")
    .max(80, "Transaction ID সর্বোচ্চ ৮০ অক্ষরের হতে পারবে।"),
});

async function getUserFromRequest(request: Request) {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return {
      user: null,
      response: NextResponse.json(
        { error: "Login required." },
        { status: 401 },
      ),
    };
  }

  const token = authHeader.slice(7).trim();

  if (!token) {
    return {
      user: null,
      response: NextResponse.json(
        { error: "Login required." },
        { status: 401 },
      ),
    };
  }

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return {
      user: null,
      response: NextResponse.json(
        { error: "Invalid or expired session." },
        { status: 401 },
      ),
    };
  }

  return {
    user,
    response: null,
  };
}

/* =========================================================
   GET
   Load authenticated user's Add Money history
========================================================= */

export async function GET(request: Request) {
  try {
    const auth = await getUserFromRequest(request);

    if (!auth.user) {
      return auth.response!;
    }

    const { data, error } = await supabaseAdmin
      .from("add_money_requests")
      .select(
        `
        id,
        amount,
        payment_method,
        receiver_number,
        transaction_id,
        status,
        admin_note,
        created_at,
        reviewed_at
        `,
      )
      .eq("user_id", auth.user.id)
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      console.error("ADD MONEY GET ERROR:", error);

      return NextResponse.json(
        { error: "Add Money history load করা যায়নি।" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      requests: data ?? [],
    });
  } catch (error) {
    console.error("ADD MONEY GET SERVER ERROR:", error);

    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}

/* =========================================================
   POST
   Submit new Add Money request
========================================================= */

export async function POST(request: Request) {
  try {
    /* -----------------------------------------------------
       1. Authenticate user
    ----------------------------------------------------- */

    const auth = await getUserFromRequest(request);

    if (!auth.user) {
      return auth.response!;
    }

    /* -----------------------------------------------------
       2. Parse JSON safely
    ----------------------------------------------------- */

    const limited = await checkFinancialRateLimit(request, auth.user.id, "add-money");
    if (limited) return limited;

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400 },
      );
    }

    /* -----------------------------------------------------
       3. Validate request body
    ----------------------------------------------------- */

    const validationResult = addMoneySchema.safeParse(body);

    if (!validationResult.success) {
      const firstIssue = validationResult.error.issues[0];

      return NextResponse.json(
        {
          error: firstIssue?.message || "Invalid Add Money request.",
        },
        { status: 400 },
      );
    }

    const { amount, paymentMethod, transactionId } = validationResult.data;

    /* -----------------------------------------------------
       4. Resolve receiver server-side
       
       Client cannot choose/forge receiver number.
    ----------------------------------------------------- */

    const receiverNumber = paymentConfig[paymentMethod]?.number;

    if (!receiverNumber) {
      console.error(
        `ADD MONEY CONFIG ERROR: Receiver missing for ${paymentMethod}`,
      );

      return NextResponse.json(
        { error: "Payment receiver configured না।" },
        { status: 500 },
      );
    }

    /* -----------------------------------------------------
       5. Insert request

       Important:
       - user_id comes from verified Auth session
       - receiver_number comes from server config
       - status is forced to pending
    ----------------------------------------------------- */

    const { data, error } = await supabaseAdmin
      .from("add_money_requests")
      .insert({
        user_id: auth.user.id,
        amount,
        payment_method: paymentMethod,
        receiver_number: receiverNumber,
        transaction_id: transactionId,
        status: "pending",
      })
      .select(
        `
        id,
        amount,
        payment_method,
        receiver_number,
        transaction_id,
        status,
        created_at
        `,
      )
      .single();

    if (error) {
      /*
       * PostgreSQL UNIQUE violation.
       * transaction_id already exists.
       */
      if (error.code === "23505") {
        return NextResponse.json(
          {
            error: "এই Transaction ID আগে ব্যবহার করা হয়েছে।",
          },
          { status: 409 },
        );
      }

      /*
       * PostgreSQL CHECK constraint violation.
       */
      if (error.code === "23514") {
        return NextResponse.json(
          {
            error: "Add Money request-এর তথ্য সঠিক নয়।",
          },
          { status: 400 },
        );
      }

      /*
       * Foreign key violation.
       */
      if (error.code === "23503") {
        return NextResponse.json(
          {
            error: "User account পাওয়া যায়নি।",
          },
          { status: 404 },
        );
      }

      console.error("ADD MONEY CREATE ERROR:", error);

      return NextResponse.json(
        {
          error: "Add Money request submit করা যায়নি।",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Add Money request submitted.",
      request: data,
    });
  } catch (error) {
    console.error("ADD MONEY POST SERVER ERROR:", error);

    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
