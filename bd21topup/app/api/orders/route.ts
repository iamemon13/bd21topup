// POST: নতুন অর্ডার বা ইনস্ট্যান্ট পেমেন্ট সাবমিট করা
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const body = await request.json();
    const { uid, playerName, packageName, amount, receiverNumber, paymentMethod, transactionId } = body;

    if (!uid || !packageName || !paymentMethod || !transactionId) {
      return NextResponse.json({ error: "Required fields are missing." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("orders")
      .insert({
        user_id: user.id,
        uid: uid,
        player_name: playerName || "",
        package_name: packageName,
        amount: amount || 0,
        receiver_number: receiverNumber || "",
        payment_method: paymentMethod,
        transaction_id: transactionId.trim(),
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "এই Transaction ID ইতিমধ্যে ব্যবহার করা হয়েছে।" }, { status: 409 });
      }
      console.error("ORDER INSERT ERROR:", error);
      return NextResponse.json({ error: "Order save করা যায়নি।" }, { status: 500 });
    }

    return NextResponse.json({ success: true, order: data });
  } catch (err) {
    console.error("ORDERS API SERVER ERROR:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
