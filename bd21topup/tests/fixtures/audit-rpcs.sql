-- Read-only production function snapshot for isolated tests, 2026-09-23.
CREATE OR REPLACE FUNCTION public.check_uid_rate_limit(p_ip text, p_max_requests integer, p_window_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ip text;
  v_current_count integer;
  v_reset_at timestamptz;
BEGIN
  v_ip := trim(coalesce(p_ip, ''));

  IF v_ip = '' OR length(v_ip) > 100 THEN
    RAISE EXCEPTION 'Invalid IP identifier';
  END IF;

  IF p_max_requests IS NULL
     OR p_max_requests < 1
     OR p_max_requests > 1000 THEN
    RAISE EXCEPTION 'Invalid rate limit';
  END IF;

  IF p_window_seconds IS NULL
     OR p_window_seconds < 1
     OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'Invalid rate limit window';
  END IF;

  SELECT request_count, reset_at
  INTO v_current_count, v_reset_at
  FROM public.api_rate_limits
  WHERE ip = v_ip
  FOR UPDATE;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.api_rate_limits (
        ip,
        request_count,
        reset_at
      )
      VALUES (
        v_ip,
        1,
        now() + make_interval(secs => p_window_seconds)
      );

      RETURN true;

    EXCEPTION
      WHEN unique_violation THEN
        SELECT request_count, reset_at
        INTO v_current_count, v_reset_at
        FROM public.api_rate_limits
        WHERE ip = v_ip
        FOR UPDATE;
    END;
  END IF;

  IF v_reset_at IS NULL OR now() >= v_reset_at THEN
    UPDATE public.api_rate_limits
    SET
      request_count = 1,
      reset_at = now() + make_interval(secs => p_window_seconds)
    WHERE ip = v_ip;

    RETURN true;
  END IF;

  IF v_current_count >= p_max_requests THEN
    RETURN false;
  END IF;

  UPDATE public.api_rate_limits
  SET request_count = request_count + 1
  WHERE ip = v_ip;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_adjust_wallet(p_user_id uuid, p_amount numeric, p_action text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_current_balance numeric(12,2);
    v_new_balance numeric(12,2);
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be greater than zero';
    END IF;

    IF p_action NOT IN ('add', 'remove') THEN
        RAISE EXCEPTION 'Invalid action. Use add or remove';
    END IF;

    SELECT wallet_balance INTO v_current_balance
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User profile not found';
    END IF;

    IF p_action = 'add' THEN
        v_new_balance := coalesce(v_current_balance, 0) + p_amount;
    ELSIF p_action = 'remove' THEN
        v_new_balance := coalesce(v_current_balance, 0) - p_amount;
        
        IF v_new_balance < 0 THEN
            RAISE EXCEPTION 'Insufficient balance for this adjustment';
        END IF;
    END IF;

    UPDATE public.profiles
    SET wallet_balance = v_new_balance,
        updated_at = now()
    WHERE id = p_user_id;

    INSERT INTO public.wallet_transactions (
        user_id,
        type,
        direction,
        amount,
        balance_after,
        description
    ) VALUES (
        p_user_id,
        'adjustment',
        CASE WHEN p_action = 'add' THEN 'credit' ELSE 'debit' END,
        p_amount,
        v_new_balance,
        coalesce(p_note, 'Admin wallet adjustment')
    );

    RETURN jsonb_build_object(
        'success', true,
        'new_balance', v_new_balance
    );
END;
$function$;
