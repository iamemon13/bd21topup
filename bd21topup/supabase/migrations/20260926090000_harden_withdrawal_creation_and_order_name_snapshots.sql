BEGIN;

-- Historical rows may legitimately use Rocket or Upay. Keep the table-level
-- compatibility constraint and restrict only the creation RPC used for new rows.
CREATE OR REPLACE FUNCTION public.process_withdrawal(
  p_user_id uuid,
  p_amount numeric,
  p_method text,
  p_account_number text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_current_balance numeric;
  v_new_balance numeric;
  v_withdrawal_id uuid;
  v_clean_method text;
BEGIN
  IF p_amount IS NULL OR p_amount < 100 OR p_amount > 100000 THEN
    RAISE EXCEPTION 'Withdrawal amount must be between 100 and 100000';
  END IF;

  v_clean_method := lower(trim(p_method));
  IF v_clean_method IS NULL OR v_clean_method NOT IN ('bkash', 'nagad') THEN
    RAISE EXCEPTION 'Invalid withdrawal method';
  END IF;

  IF p_account_number IS NULL OR p_account_number !~ '^01[0-9]{9}$' THEN
    RAISE EXCEPTION 'Invalid withdrawal account number';
  END IF;

  SELECT wallet_balance INTO v_current_balance
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  v_current_balance := coalesce(v_current_balance, 0);
  IF v_current_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  v_new_balance := v_current_balance - p_amount;
  UPDATE public.profiles
  SET wallet_balance = v_new_balance, updated_at = now()
  WHERE id = p_user_id;

  INSERT INTO public.withdrawals (
    user_id, amount, method, account_number, status, balance_after
  ) VALUES (
    p_user_id, p_amount, v_clean_method, p_account_number, 'pending', v_new_balance
  ) RETURNING id INTO v_withdrawal_id;

  INSERT INTO public.wallet_transactions (
    user_id, type, direction, amount, balance_after, reference_id, description
  ) VALUES (
    p_user_id, 'withdrawal', 'debit', p_amount, v_new_balance, v_withdrawal_id,
    'Withdrawal request via ' || v_clean_method
  );

  RETURN json_build_object(
    'success', true,
    'withdrawal_id', v_withdrawal_id,
    'new_balance', v_new_balance
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.process_withdrawal(uuid, numeric, text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_withdrawal(uuid, numeric, text, text)
TO service_role, postgres;

COMMIT;
