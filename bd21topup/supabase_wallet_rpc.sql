-- RPC for atomic and secure wallet payment
CREATE OR REPLACE FUNCTION public.process_wallet_payment(
    p_user_id uuid,
    p_uid text,
    p_player_name text,
    p_package_name text,
    p_account_name text,
    p_tx_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_package_price numeric;
    v_current_balance numeric;
    v_new_balance numeric;
    v_order_id uuid;
BEGIN
    -- ১. প্যাকেজের আসল দাম সার্ভার থেকে বের করা (Price Forgery ঠেকানো)
    SELECT price INTO v_package_price
    FROM packages
    WHERE name = p_package_name;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid package';
    END IF;

    -- ২. প্রোফাইল লক করা (FOR UPDATE) যাতে Race Condition না হয়
    SELECT wallet_balance INTO v_current_balance
    FROM profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Profile not found';
    END IF;

    -- ৩. ব্যালেন্স চেক
    IF v_current_balance < v_package_price THEN
        RAISE EXCEPTION 'Insufficient balance';
    END IF;

    -- ৪. নতুন ব্যালেন্স হিসাব ও আপডেট
    v_new_balance := v_current_balance - v_package_price;
    
    UPDATE profiles 
    SET wallet_balance = v_new_balance 
    WHERE id = p_user_id;

    -- ৫. অর্ডার তৈরি
    INSERT INTO orders (
        user_id, account_name, uid, player_name, product_name,
        package_name, amount, payment_method, receiver_number,
        transaction_id, status
    ) VALUES (
        p_user_id, p_account_name, p_uid, p_player_name, 'Free Fire UID TopUp',
        p_package_name, v_package_price, 'wallet', 'Wallet Payment',
        p_tx_id, 'pending'
    ) RETURNING id INTO v_order_id;

    -- ৬. ওয়ালেট হিস্ট্রি আপডেট
    INSERT INTO wallet_transactions (
        user_id, type, direction, amount, balance_after, reference_id, description
    ) VALUES (
        p_user_id, 'purchase', 'debit', v_package_price, v_new_balance, v_order_id::text, 'Free Fire UID TopUp (' || p_package_name || ')'
    );

    -- ৭. রিটার্ন ডাটা
    RETURN jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'balance_after', v_new_balance,
        'amount_deducted', v_package_price
    );
END;
$$;

-- পারমিশন সেট করা (শুধুমাত্র Admin API/Service Role চালাতে পারবে)
REVOKE ALL ON FUNCTION public.process_wallet_payment(uuid, text, text, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_wallet_payment(uuid, text, text, text, text, text) TO service_role;
