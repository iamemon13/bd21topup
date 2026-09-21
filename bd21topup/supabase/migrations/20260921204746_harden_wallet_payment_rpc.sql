CREATE OR REPLACE FUNCTION public.process_wallet_payment(
    p_user_id uuid,
    p_uid text,
    p_player_name text,
    p_package_name text,
    p_account_name text,
    p_tx_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_package_price numeric;
    v_current_balance numeric;
    v_new_balance numeric;
    v_order_id uuid;

    v_uid text;
    v_player_name text;
    v_package_name text;
    v_account_name text;
    v_tx_id text;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'Invalid user';
    END IF;

    v_uid := trim(COALESCE(p_uid, ''));
    v_player_name := trim(COALESCE(p_player_name, ''));
    v_package_name := trim(COALESCE(p_package_name, ''));
    v_account_name := trim(COALESCE(p_account_name, ''));
    v_tx_id := trim(COALESCE(p_tx_id, ''));

    IF length(v_uid) < 1 OR length(v_uid) > 100 THEN
        RAISE EXCEPTION 'Invalid UID';
    END IF;

    IF length(v_player_name) > 100 THEN
        RAISE EXCEPTION 'Invalid player name';
    END IF;

    IF length(v_package_name) < 1 OR length(v_package_name) > 200 THEN
        RAISE EXCEPTION 'Invalid package';
    END IF;

    IF length(v_account_name) > 150 THEN
        RAISE EXCEPTION 'Invalid account name';
    END IF;

    IF length(v_tx_id) < 4 OR length(v_tx_id) > 80 THEN
        RAISE EXCEPTION 'Invalid transaction ID';
    END IF;

    IF v_tx_id NOT LIKE 'WALLET-%' THEN
        RAISE EXCEPTION 'Invalid wallet transaction ID';
    END IF;

    SELECT price
    INTO v_package_price
    FROM public.packages
    WHERE name = v_package_name;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid package';
    END IF;

    IF v_package_price IS NULL OR v_package_price <= 0 THEN
        RAISE EXCEPTION 'Invalid package price';
    END IF;

    SELECT wallet_balance
    INTO v_current_balance
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Profile not found';
    END IF;

    v_current_balance := COALESCE(v_current_balance, 0);

    IF v_current_balance < v_package_price THEN
        RAISE EXCEPTION 'Insufficient balance';
    END IF;

    v_new_balance := v_current_balance - v_package_price;

    UPDATE public.profiles
    SET wallet_balance = v_new_balance
    WHERE id = p_user_id;

    INSERT INTO public.orders (
        user_id,
        account_name,
        uid,
        player_name,
        product_name,
        package_name,
        amount,
        payment_method,
        receiver_number,
        transaction_id,
        status
    )
    VALUES (
        p_user_id,
        NULLIF(v_account_name, ''),
        v_uid,
        v_player_name,
        'Free Fire UID TopUp',
        v_package_name,
        v_package_price,
        'wallet',
        'Wallet Payment',
        v_tx_id,
        'pending'
    )
    RETURNING id INTO v_order_id;

    INSERT INTO public.wallet_transactions (
        user_id,
        type,
        direction,
        amount,
        balance_after,
        reference_id,
        description
    )
    VALUES (
        p_user_id,
        'order_payment',
        'debit',
        v_package_price,
        v_new_balance,
        v_order_id,
        'Free Fire UID TopUp (' || v_package_name || ')'
    );

    RETURN jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'balance_after', v_new_balance,
        'amount_deducted', v_package_price
    );
END;
$function$;

REVOKE ALL
ON FUNCTION public.process_wallet_payment(uuid, text, text, text, text, text)
FROM PUBLIC;

REVOKE EXECUTE
ON FUNCTION public.process_wallet_payment(uuid, text, text, text, text, text)
FROM anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.process_wallet_payment(uuid, text, text, text, text, text)
TO service_role, postgres;