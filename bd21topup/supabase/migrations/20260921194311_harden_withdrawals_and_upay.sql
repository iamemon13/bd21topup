BEGIN;

-- =========================================================
-- 1. Harden withdrawal status
-- =========================================================

ALTER TABLE public.withdrawals
  ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE public.withdrawals
  ALTER COLUMN status SET NOT NULL;


-- =========================================================
-- 2. Withdrawal method whitelist
-- =========================================================

ALTER TABLE public.withdrawals
  DROP CONSTRAINT IF EXISTS withdrawals_method_check;

ALTER TABLE public.withdrawals
  ADD CONSTRAINT withdrawals_method_check
  CHECK (
    lower(trim(method)) IN (
      'bkash',
      'nagad',
      'rocket',
      'upay'
    )
  );


-- =========================================================
-- 3. Withdrawal amount limits
-- =========================================================

ALTER TABLE public.withdrawals
  DROP CONSTRAINT IF EXISTS withdrawals_amount_check;

ALTER TABLE public.withdrawals
  ADD CONSTRAINT withdrawals_amount_check
  CHECK (
    amount >= 100
    AND amount <= 100000
  );


-- =========================================================
-- 4. Withdrawal account number validation
--    Bangladesh mobile number: 01XXXXXXXXX
-- =========================================================

ALTER TABLE public.withdrawals
  DROP CONSTRAINT IF EXISTS withdrawals_account_number_check;

ALTER TABLE public.withdrawals
  ADD CONSTRAINT withdrawals_account_number_check
  CHECK (
    account_number ~ '^01[0-9]{9}$'
  );


-- =========================================================
-- 5. Secure and harden process_withdrawal()
-- =========================================================

CREATE OR REPLACE FUNCTION public.process_withdrawal(
  p_user_id uuid,
  p_amount numeric,
  p_method text,
  p_account_number text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_current_balance NUMERIC;
    v_new_balance NUMERIC;
    v_withdrawal_id UUID;
    v_clean_method TEXT;
BEGIN
    -- Amount validation
    IF p_amount IS NULL
       OR p_amount < 100
       OR p_amount > 100000
    THEN
        RAISE EXCEPTION 'Withdrawal amount must be between 100 and 100000';
    END IF;

    -- Method validation
    v_clean_method := LOWER(TRIM(p_method));

    IF v_clean_method NOT IN (
        'bkash',
        'nagad',
        'rocket',
        'upay'
    ) THEN
        RAISE EXCEPTION 'Invalid withdrawal method';
    END IF;

    -- Account number validation
    IF p_account_number IS NULL
       OR p_account_number !~ '^01[0-9]{9}$'
    THEN
        RAISE EXCEPTION 'Invalid withdrawal account number';
    END IF;

    -- Lock wallet row to prevent concurrent double spending
    SELECT wallet_balance
    INTO v_current_balance
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Profile not found';
    END IF;

    v_current_balance := COALESCE(v_current_balance, 0);

    IF v_current_balance < p_amount THEN
        RAISE EXCEPTION 'Insufficient balance';
    END IF;

    v_new_balance := v_current_balance - p_amount;

    -- Deduct wallet balance
    UPDATE public.profiles
    SET
        wallet_balance = v_new_balance,
        updated_at = NOW()
    WHERE id = p_user_id;

    -- Create withdrawal request
    INSERT INTO public.withdrawals (
        user_id,
        amount,
        method,
        account_number,
        status,
        balance_after
    )
    VALUES (
        p_user_id,
        p_amount,
        v_clean_method,
        p_account_number,
        'pending',
        v_new_balance
    )
    RETURNING id INTO v_withdrawal_id;

    -- Wallet ledger entry
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
        'withdrawal',
        'debit',
        p_amount,
        v_new_balance,
        v_withdrawal_id,
        'Withdrawal request via ' || v_clean_method
    );

    RETURN json_build_object(
        'success', true,
        'withdrawal_id', v_withdrawal_id,
        'new_balance', v_new_balance
    );
END;
$function$;


-- =========================================================
-- 6. Restrict direct client execution of SECURITY DEFINER RPC
-- =========================================================

REVOKE ALL
ON FUNCTION public.process_withdrawal(uuid, numeric, text, text)
FROM PUBLIC;

REVOKE EXECUTE
ON FUNCTION public.process_withdrawal(uuid, numeric, text, text)
FROM anon;

REVOKE EXECUTE
ON FUNCTION public.process_withdrawal(uuid, numeric, text, text)
FROM authenticated;

GRANT EXECUTE
ON FUNCTION public.process_withdrawal(uuid, numeric, text, text)
TO service_role;

GRANT EXECUTE
ON FUNCTION public.process_withdrawal(uuid, numeric, text, text)
TO postgres;

COMMIT;