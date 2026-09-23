import { NextResponse } from "next/server";
import { supabaseAdmin, logAdminAction } from "@/lib/supabase-admin";
import { checkUserRole } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/* =========================================================
   GET - Load packages
========================================================= */

export async function GET(request: Request) {
  try {
    const authCheck = await checkUserRole(
      request,
      ["super_admin", "admin", "editor"],
      "manage_packages",
    );

    if ("error" in authCheck) {
      return NextResponse.json(
        {
          success: false,
          error: authCheck.error,
        },
        {
          status: authCheck.status,
        },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("packages")
      .select("id, name, price, category, sort_order, updated_at")
      .order("price", {
        ascending: true,
      });

    if (error) {
      console.error("ADMIN PACKAGES GET ERROR:", error);

      return NextResponse.json(
        {
          success: false,
          error: "Failed to load packages.",
        },
        {
          status: 500,
        },
      );
    }

    return NextResponse.json({
      success: true,
      packages: data ?? [],
    });
  } catch (error) {
    console.error("ADMIN PACKAGES GET API ERROR:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Server error. Request could not be processed.",
      },
      {
        status: 500,
      },
    );
  }
}

/* =========================================================
   PUT - Update package
========================================================= */

export async function PUT(request: Request) {
  try {
    /* -----------------------------------------------------
       1. AUTH + PERMISSION
    ----------------------------------------------------- */

    const authCheck = await checkUserRole(
      request,
      ["super_admin", "admin", "editor"],
      "manage_packages",
    );

    if ("error" in authCheck) {
      return NextResponse.json(
        {
          success: false,
          error: authCheck.error,
        },
        {
          status: authCheck.status,
        },
      );
    }

    const adminId = authCheck.user.id;
    const ipAddress = getClientIp(request);

    /* -----------------------------------------------------
       2. SAFE JSON PARSING
    ----------------------------------------------------- */

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

    if (!isRecord(rawBody)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body.",
        },
        {
          status: 400,
        },
      );
    }

    /* -----------------------------------------------------
       3. VALIDATE PACKAGE ID
    ----------------------------------------------------- */

    if (typeof rawBody.id !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "Package ID missing.",
        },
        {
          status: 400,
        },
      );
    }

    const packageId = rawBody.id.trim();

    if (!UUID_REGEX.test(packageId)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid Package ID.",
        },
        {
          status: 400,
        },
      );
    }

    /* -----------------------------------------------------
       4. VALIDATE PACKAGE NAME
    ----------------------------------------------------- */

    if (typeof rawBody.name !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "Package name must be text.",
        },
        {
          status: 400,
        },
      );
    }

    const packageName = rawBody.name.trim();

    if (!packageName) {
      return NextResponse.json(
        {
          success: false,
          error: "Package name required.",
        },
        {
          status: 400,
        },
      );
    }

    if (packageName.length > 200) {
      return NextResponse.json(
        {
          success: false,
          error: "Package name cannot exceed 200 characters.",
        },
        {
          status: 400,
        },
      );
    }

    /* -----------------------------------------------------
       5. VALIDATE PRICE
    ----------------------------------------------------- */

    if (
      typeof rawBody.price !== "number" ||
      !Number.isFinite(rawBody.price) ||
      rawBody.price <= 0
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "সঠিক এবং পজিটিভ দাম দিন।",
        },
        {
          status: 400,
        },
      );
    }

    const price = rawBody.price;

    /*
     * Avoid impractically large / accidental values.
     * DB still enforces price > 0.
     */
    if (price > 1000000) {
      return NextResponse.json(
        {
          success: false,
          error: "Package price is too large.",
        },
        {
          status: 400,
        },
      );
    }

    /* -----------------------------------------------------
       6. UPDATE + VERIFY ROW EXISTS
    ----------------------------------------------------- */

    const { data: updatedPackage, error: updateError } = await supabaseAdmin
      .from("packages")
      .update({
        name: packageName,
        price,
        updated_at: new Date().toISOString(),
      })
      .eq("id", packageId)
      .select("id, name, price, category, sort_order, updated_at")
      .maybeSingle();

    if (updateError) {
      if (updateError.code === "23505") {
        return NextResponse.json(
          {
            success: false,
            error: "এই নামে আরেকটি package ইতোমধ্যে আছে।",
          },
          {
            status: 409,
          },
        );
      }

      if (updateError.code === "23514") {
        return NextResponse.json(
          {
            success: false,
            error: "Package price database validation pass করেনি।",
          },
          {
            status: 400,
          },
        );
      }

      console.error("PACKAGE UPDATE ERROR:", updateError);

      return NextResponse.json(
        {
          success: false,
          error: "Package update করা যায়নি। সার্ভারে সমস্যা হয়েছে।",
        },
        {
          status: 500,
        },
      );
    }

    if (!updatedPackage) {
      return NextResponse.json(
        {
          success: false,
          error: "Package পাওয়া যায়নি।",
        },
        {
          status: 404,
        },
      );
    }

    /* -----------------------------------------------------
       7. AUDIT LOG
    ----------------------------------------------------- */

    await logAdminAction({
      adminId,
      actionType: "UPDATE_PACKAGE",
      targetId: packageId,
      details: JSON.stringify({
        name: updatedPackage.name,
        price: Number(updatedPackage.price),
      }),
      ipAddress,
    });

    /* -----------------------------------------------------
       8. RESPONSE
    ----------------------------------------------------- */

    return NextResponse.json({
      success: true,
      message: "প্যাকেজ সফলভাবে আপডেট হয়েছে!",
      package: {
        id: updatedPackage.id,
        name: updatedPackage.name,
        price: Number(updatedPackage.price),
        updatedAt: updatedPackage.updated_at,
      },
    });
  } catch (error) {
    console.error("PACKAGE UPDATE API ERROR:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Server error. Request could not be processed.",
      },
      {
        status: 500,
      },
    );
  }
}
