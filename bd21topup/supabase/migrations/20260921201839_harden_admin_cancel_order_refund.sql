CREATE OR REPLACE FUNCTION public.admin_cancel_order(
    p_order_id uuid,
    p_admin_note text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_order RECORD;
    v_current_balance numeric;
    v_new_balance numeric;
    v_refund_created boolean := false;
BEGIN
    SELECT *
    INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found';
    END IF;

    IF v_order.status NOT IN ('pending', 'approved', 'processing') THEN
        RAISE EXCEPTION
            'This order cannot be cancelled (current status: %)',
            v_order.status;
    END IF;

    IF lower(trim(COALESCE(v_order.payment_method, ''))) = 'wallet' THEN

        IF NOT EXISTS (
            SELECT 1
            FROM public.wallet_transactions
            WHERE reference_id = p_order_id
              AND type = 'order_payment'
              AND direction = 'debit'
              AND amount = v_order.amount
        ) THEN
            RAISE EXCEPTION
                'Original wallet payment transaction not found';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.wallet_transactions
            WHERE reference_id = p_order_id
              AND type = 'refund'
              AND direction = 'credit'
        ) THEN
            RAISE EXCEPTION
                'Refund already processed for this order';
        END IF;

        SELECT wallet_balance
        INTO v_current_balance
        FROM public.profiles
        WHERE id = v_order.user_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'User profile not found';
        END IF;

        v_new_balance :=
            COALESCE(v_current_balance, 0) + v_order.amount;

        UPDATE public.profiles
        SET wallet_balance = v_new_balance
        WHERE id = v_order.user_id;

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
            v_order.user_id,
            'refund',
            'credit',
            v_order.amount,
            v_new_balance,
            p_order_id,
            'Order cancelled wallet refund'
        );

        v_refund_created := true;
    END IF;

    UPDATE public.orders
    SET
        status = 'cancelled',
        admin_note = p_admin_note,
        cancelled_at = timezone('utc'::text, now())
    WHERE id = p_order_id;

    RETURN jsonb_build_object(
        'success', true,
        'order_id', p_order_id,
        'refund_created', v_refund_created,
        'balance_after',
            CASE
                WHEN v_refund_created THEN v_new_balance
                ELSE NULL
            END
    );
END;
$function$;