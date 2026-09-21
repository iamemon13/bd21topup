import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const ranks = [
  { name: "Bronze", min: 0, max: 100 },
  { name: "Silver", min: 101, max: 1000 },
  { name: "Gold", min: 1001, max: 5000 },
  { name: "Platinum", min: 5001, max: 10000 },
  { name: "Diamond", min: 10001, max: 25000 },
  { name: "Heroic", min: 25001, max: 50000 },
  { name: "Master", min: 50001, max: 100000 },
  { name: "Grand Master", min: 100001, max: null },
] as const;

function getRank(totalSpend: number) {
  const index = ranks.findIndex((rank) => {
    if (rank.max === null) {
      return totalSpend >= rank.min;
    }

    return totalSpend >= rank.min && totalSpend <= rank.max;
  });

  const safeIndex = index === -1 ? 0 : index;

  const current = ranks[safeIndex];
  const next = ranks[safeIndex + 1] ?? null;

  let progress = 100;
  let amountToNext = 0;

  if (next) {
    const rangeStart = current.min;
    const rangeEnd = next.min;

    const currentProgress = Math.max(0, totalSpend - rangeStart);

    progress = Math.min(
      100,
      Math.max(
        0,
        Math.round((currentProgress / (rangeEnd - rangeStart)) * 100),
      ),
    );

    amountToNext = Math.max(0, next.min - totalSpend);
  }

  return {
    current: current.name,
    level: safeIndex + 1,
    progress,
    next: next?.name ?? null,
    amountToNext,

    journey: ranks.map((rank, rankIndex) => ({
      name: rank.name,
      min: rank.min,
      max: rank.max,

      state:
        rankIndex < safeIndex
          ? "unlocked"
          : rankIndex === safeIndex
            ? "current"
            : "locked",
    })),
  };
}

async function getAuthenticatedUser(request: Request) {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return {
      user: null,
      errorResponse: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      ),
    };
  }

  const token = authHeader.replace("Bearer ", "").trim();

  if (!token) {
    return {
      user: null,
      errorResponse: NextResponse.json(
        { error: "Unauthorized" },
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
      errorResponse: NextResponse.json(
        { error: "Invalid session" },
        { status: 401 },
      ),
    };
  }

  return {
    user,
    errorResponse: null,
  };
}

export async function GET(request: Request) {
  try {
    const auth = await getAuthenticatedUser(request);

    if (!auth.user) {
      return auth.errorResponse!;
    }

    const user = auth.user;

    const fallbackName = String(
      user.user_metadata?.full_name || user.user_metadata?.name || "",
    ).trim();

    const fallbackPhone =
      String(user.user_metadata?.phone || "").trim() || null;

    const authEmail = user.email ?? null;

    // 🛠️ FIX 1: profiles টেবিল থেকে role কলাম রিমুভ করা হয়েছে
    let { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select(
        `
          id,
          full_name,
          phone,
          email,
          wallet_balance,
          created_at
        `,
      )
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("ACCOUNT PROFILE ERROR:", profileError);

      return NextResponse.json(
        { error: "Profile load করা যায়নি।" },
        { status: 500 },
      );
    }

    if (!profile) {
      // 🛠️ FIX 2: upsert থেকেও role রিমুভ করা হয়েছে
      const { error: createProfileError } = await supabaseAdmin
        .from("profiles")
        .upsert(
          {
            id: user.id,
            full_name: fallbackName,
            phone: fallbackPhone,
            email: authEmail,
            wallet_balance: 0,
          },
          { onConflict: "id" },
        );

      if (createProfileError) {
        console.error("PROFILE CREATE ERROR:", createProfileError);

        return NextResponse.json(
          { error: "Profile তৈরি করা যায়নি।" },
          { status: 500 },
        );
      }

      // 🛠️ FIX 3: Reload কোয়ারি থেকেও role রিমুভ করা হয়েছে
      const { data: loadedProfile, error: reloadError } = await supabaseAdmin
        .from("profiles")
        .select(
          `
            id,
            full_name,
            phone,
            email,
            wallet_balance,
            created_at
          `,
        )
        .eq("id", user.id)
        .single();

      if (reloadError || !loadedProfile) {
        return NextResponse.json(
          { error: "Profile load করা যায়নি।" },
          { status: 500 },
        );
      }

      profile = loadedProfile;
    }

    if (profile.email !== authEmail) {
      await supabaseAdmin
        .from("profiles")
        .update({
          email: authEmail,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      profile.email = authEmail;
    }

    // 🛠️ FIX 4: admin_roles টেবিল থেকে ইউজারের আসল রোল চেক করা
    const { data: adminRoleData } = await supabaseAdmin
      .from("admin_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    const userRole = adminRoleData?.role || "user";

    const { data: orders, error: ordersError } = await supabaseAdmin
      .from("orders")
      .select("id, amount, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (ordersError) {
      console.error("ACCOUNT ORDERS ERROR:", ordersError);

      return NextResponse.json(
        { error: "Orders load করা যায়নি." },
        { status: 500 },
      );
    }

    const allOrders = orders ?? [];

    const completedOrders = allOrders.filter(
      (order) => order.status === "completed",
    );

    const totalSpend = completedOrders.reduce(
      (sum, order) => sum + Number(order.amount || 0),
      0,
    );

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    const weeklySpend = completedOrders
      .filter((order) => {
        const createdAt = new Date(order.created_at).getTime();
        return createdAt >= sevenDaysAgo && createdAt <= now;
      })
      .reduce((sum, order) => sum + Number(order.amount || 0), 0);

    const rank = getRank(totalSpend);

    return NextResponse.json({
      success: true,
      account: {
        id: user.id,
        email: profile.email || authEmail || "",
        fullName: profile.full_name || fallbackName || "BD21 User",
        phone: profile.phone,
        role: userRole, // 🛠️ FIX 5: এখানে admin_roles থেকে পাওয়া রোল পাঠানো হচ্ছে
        walletBalance: Number(profile.wallet_balance || 0),
        avatarUrl:
          user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
        verified: Boolean(user.email_confirmed_at),
        createdAt: profile.created_at,
      },
      stats: {
        orders: allOrders.length,
        completedOrders: completedOrders.length,
        totalSpend,
        weeklySpend,
      },
      rank,
    });
  } catch (error) {
    console.error("ACCOUNT API ERROR:", error);

    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await getAuthenticatedUser(request);

    if (!auth.user) {
      return auth.errorResponse!;
    }

    const body = await request.json();
    const { fullName, phone } = body;

    if (!fullName) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({
        full_name: fullName,
        phone: phone || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", auth.user.id);

    if (profileError) {
      console.error("PROFILE UPDATE ERROR:", profileError);
      return NextResponse.json(
        { error: "Profile আপডেট করা যায়নি।" },
        { status: 500 },
      );
    }

    await supabaseAdmin.auth.admin.updateUserById(auth.user.id, {
      user_metadata: {
        ...auth.user.user_metadata,
        full_name: fullName,
        name: fullName,
      },
    });

    const { error: ordersUpdateError } = await supabaseAdmin
      .from("orders")
      .update({ account_name: fullName })
      .eq("user_id", auth.user.id);

    if (ordersUpdateError) {
      console.error("ORDERS ACCOUNT NAME UPDATE ERROR:", ordersUpdateError);
    }

    return NextResponse.json({
      success: true,
      message: "Profile updated successfully",
    });
  } catch (error) {
    console.error("ACCOUNT PATCH ERROR:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
