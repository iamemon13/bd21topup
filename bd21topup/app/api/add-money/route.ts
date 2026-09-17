import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function verifyAdmin(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: "Unauthorized", status: 401 };
  }

  const token = authHeader.replace("Bearer ", "").trim();
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return { error: "Invalid session", status: 401 };
  }

  // চেক করতে পারেন ইউজার অ্যাডমিন কি না (আপনার রোল সিস্টেমে যেভাবে করা আছে)
  return { user };
}

// GET: সব Add Money রিকোয়েস্ট লোড করা
export async function GET(request: Request) {
  try {
    const authCheck = await verifyAdmin(request);
    if ("error" in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const { data: requests, error } = await supabaseAdmin
      .from("add_money_requests")
      .select(`
        id,
        user_id,
        amount,
        payment_method,
        receiver_number,
        transaction_id,
        status,
        admin_note,
        created_at,
        reviewed_at,
        profiles:user_id (
          fullName:full_name,
          email,
          phone,
          walletBalance:wallet_balance
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("ADMIN ADD MONEY GET ERROR:", error);
      return NextResponse.json({ error: "Requests load করা যায়নি।" }, { status: 500 });
    }

    // ফ্রন্টএন্ডের সুবিধার জন্য অবজেক্ট স্ট্রাকচার ফরম্যাট করা
    const formattedRequests = (requests || []).map((item: any) => ({
      id: item.id,
      userId: item.user_id,
      amount: item.amount,
      paymentMethod: item.payment_method,
      receiverNumber: item.receiver_number,
      transactionId: item.transaction_id,
      status: item.status,
      adminNote: item.admin_note,
      createdAt: item.created_at,
      reviewedAt: item.reviewed_at,
      customer: {
        fullName: item.profiles?.fullName || "Unknown",
        email: item.profiles?.email || "",
        phone: item.profiles?.phone || "",
        walletBalance: item.profiles?.walletBalance || 0,
      },
    }));

    return NextResponse.json({ success: true, requests: formattedRequests });
  } catch (err) {
    console.error("ADMIN ADD MONEY GET SERVER ERROR:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}

// PATCH / POST: সিঙ্গেল বা বাল্ক রিভিউ (Approve / Reject)
export async function PATCH(request: Request) {
  try {
    const authCheck = await verifyAdmin(request);
    if ("error" in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const body = await request.json();
    const { requestId, action, adminNote } = body;

    if (!requestId || !["approved", "rejected"].includes(action)) {
      return NextResponse.json({ error: "Invalid parameters." }, { status: 400 });
    }

    // রিকোয়েস্ট ডাটা ফেচ করা
    const { data: reqItem, error: fetchErr } = await supabaseAdmin
      .from("add_money_requests")
      .select("*")
      .eq("id", requestId)
      .single();

    if (fetchErr || !reqItem) {
      return NextResponse.json({ error: "Request পাওয়া যায়নি।" }, { status: 404 });
    }

    if (reqItem.status !== "pending") {
      return NextResponse.json({ error: "এই রিকোয়েস্টটি ইতিমধ্যে রিভিউ করা হয়েছে।" }, { status: 400 });
    }

    if (action === "approved") {
      // ইউজারের বর্তমান ওয়ালেট ব্যালেন্স আনা
      const { data: profile, profileErr } = await supabaseAdmin
        .from("profiles")
        .select("wallet_balance")
        .eq("id", reqItem.user_id)
        .single();

      if (profileErr) {
        return NextResponse.json({ error: "User profile পাওয়া যায়নি।" }, { status: 404 });
      }

      const currentBalance = Number(profile?.wallet_balance || 0);
      const newBalance = currentBalance + Number(reqItem.amount);

      // ওয়ালেট ব্যালেন্স আপডেট
      const { error: walletErr } = await supabaseAdmin
        .from("profiles")
        .update({ wallet_balance: newBalance })
        .eq("id", reqItem.user_id);

      if (walletErr) {
        return NextResponse.json({ error: "Wallet balance আপডেট করা যায়নি।" }, { status: 500 });
      }
    }

    // রিকোয়েস্ট স্ট্যাটাস আপডেট
    const { error: updateErr } = await supabaseAdmin
      .from("add_money_requests")
      .update({
        status: action,
        admin_note: adminNote || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", requestId);

    if (updateErr) {
      return NextResponse.json({ error: "Status update করতে সমস্যা হয়েছে।" }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: `Request ${action} successfully.` });
  } catch (err) {
    console.error("ADMIN ADD MONEY PATCH ERROR:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
