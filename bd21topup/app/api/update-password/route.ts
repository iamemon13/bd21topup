import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-admin";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createPasswordVerificationClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    throw new Error("Supabase public configuration missing");
  }

  return createClient(supabaseUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function POST(request: Request) {
  try {
    /* =====================================================
       AUTHENTICATION
    ===================================================== */

    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "অনুমোদিত নয় (Unauthorized)" },
        { status: 401 },
      );
    }

    const token = authHeader.slice(7).trim();

    if (!token) {
      return NextResponse.json(
        { error: "অনুমোদিত নয় (Unauthorized)" },
        { status: 401 },
      );
    }

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { error: "অবৈধ সেশন (Invalid session)" },
        { status: 401 },
      );
    }

    /* =====================================================
       SAFE JSON PARSING
    ===================================================== */

    let rawBody: unknown;

    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400 },
      );
    }

    if (!isRecord(rawBody)) {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 },
      );
    }

    if (typeof rawBody.newPassword !== "string") {
      return NextResponse.json(
        { error: "নতুন পাসওয়ার্ড দিতে হবে।" },
        { status: 400 },
      );
    }

    const newPassword = rawBody.newPassword;

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।" },
        { status: 400 },
      );
    }

    if (newPassword.length > 128) {
      return NextResponse.json(
        { error: "পাসওয়ার্ড সর্বোচ্চ ১২৮ অক্ষরের হতে পারবে।" },
        { status: 400 },
      );
    }

    let currentPassword: string | null = null;

    if (
      rawBody.currentPassword !== undefined &&
      rawBody.currentPassword !== null
    ) {
      if (typeof rawBody.currentPassword !== "string") {
        return NextResponse.json(
          { error: "বর্তমান পাসওয়ার্ড সঠিক নয়।" },
          { status: 400 },
        );
      }

      currentPassword = rawBody.currentPassword;

      if (currentPassword.length > 128) {
        return NextResponse.json(
          { error: "বর্তমান পাসওয়ার্ড সঠিক নয়।" },
          { status: 400 },
        );
      }
    }

    /* =====================================================
       DETERMINE WHETHER CURRENT PASSWORD IS REQUIRED

       app_metadata is server-controlled and is the trusted
       marker going forward.

       user_metadata.password_set is checked only for
       backwards compatibility with existing accounts.
    ===================================================== */

    const identities = user.identities ?? [];

    const hasEmailIdentity = identities.some(
      (identity) => identity.provider === "email",
    );

    const securePasswordSet = user.app_metadata?.password_set === true;

    const legacyPasswordSet = user.user_metadata?.password_set === true;

    const currentPasswordRequired =
      hasEmailIdentity || securePasswordSet || legacyPasswordSet;

    /* =====================================================
       VERIFY CURRENT PASSWORD
    ===================================================== */

    if (currentPasswordRequired) {
      if (!currentPassword) {
        return NextResponse.json(
          { error: "বর্তমান পাসওয়ার্ড দিতে হবে।" },
          { status: 400 },
        );
      }

      if (!user.email) {
        console.error(
          "PASSWORD VERIFY ERROR: authenticated user has no email",
          user.id,
        );

        return NextResponse.json(
          { error: "বর্তমান পাসওয়ার্ড যাচাই করা যায়নি।" },
          { status: 400 },
        );
      }

      const verificationClient = createPasswordVerificationClient();

      const { error: signInError } =
        await verificationClient.auth.signInWithPassword({
          email: user.email,
          password: currentPassword,
        });

      if (signInError) {
        return NextResponse.json(
          { error: "বর্তমান পাসওয়ার্ড সঠিক নয়।" },
          { status: 400 },
        );
      }

      if (currentPassword === newPassword) {
        return NextResponse.json(
          {
            error: "নতুন পাসওয়ার্ড বর্তমান পাসওয়ার্ড থেকে আলাদা হতে হবে।",
          },
          { status: 400 },
        );
      }
    }

    /* =====================================================
       UPDATE PASSWORD

       Store trusted password_set marker in app_metadata.
    ===================================================== */

    const { error: updateError } =
      await supabaseAdmin.auth.admin.updateUserById(user.id, {
        password: newPassword,

        app_metadata: {
          ...user.app_metadata,
          password_set: true,
        },

        // Keep this temporarily for compatibility with
        // any existing frontend code that reads this field.
        user_metadata: {
          ...user.user_metadata,
          password_set: true,
        },
      });

    if (updateError) {
      console.error("PASSWORD UPDATE ERROR:", updateError);

      return NextResponse.json(
        {
          error: "পাসওয়ার্ড আপডেট করা যায়নি। সার্ভারে সমস্যা হয়েছে।",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "পাসওয়ার্ড সফলভাবে আপডেট করা হয়েছে!",
    });
  } catch (error) {
    console.error("UPDATE PASSWORD API ERROR:", error);

    return NextResponse.json(
      { error: "সার্ভারে ত্রুটি দেখা দিয়েছে।" },
      { status: 500 },
    );
  }
}
