BEGIN;

DO $$
DECLARE
  v_user_id uuid := 'ff05ca06-1160-4b59-bc22-32805a11dac6'::uuid;
  v_balance numeric;
  v_debit_count integer;
  v_reversal_count integer;
  r record;
BEGIN
  SELECT wallet_balance
  INTO v_balance
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found';
  END IF;

  FOR r IN
    SELECT
      w.id,
      w.amount,
      w.status,
      w.user_id,
      w.created_at,
      m.expected_amount
    FROM (
      VALUES
        (
          'd2cea779-a156-4497-89a5-13259351aa4d'::uuid,
          314::numeric
        ),
        (
          '4358b984-3432-4894-8b9a-24ac31b86420'::uuid,
          100::numeric
        )
    ) AS m(withdrawal_id, expected_amount)
    JOIN public.withdrawals w
      ON w.id = m.withdrawal_id
    ORDER BY w.created_at
  LOOP
    IF r.user_id <> v_user_id THEN
      RAISE EXCEPTION 'Unexpected user for withdrawal %', r.id;
    END IF;

    IF lower(trim(coalesce(r.status, ''))) <> 'rejected' THEN
      RAISE EXCEPTION 'Withdrawal % is not rejected', r.id;
    END IF;

    IF r.amount <> r.expected_amount THEN
      RAISE EXCEPTION
        'Unexpected amount for withdrawal %: expected %, found %',
        r.id,
        r.expected_amount,
        r.amount;
    END IF;

    SELECT count(*)
    INTO v_debit_count
    FROM public.wallet_transactions
    WHERE reference_id = r.id
      AND type = 'withdrawal'
      AND direction = 'debit'
      AND amount = r.expected_amount;

    IF v_debit_count <> 1 THEN
      RAISE EXCEPTION
        'Expected exactly 1 withdrawal debit for %, found %',
        r.id,
        v_debit_count;
    END IF;

    SELECT count(*)
    INTO v_reversal_count
    FROM public.wallet_transactions
    WHERE reference_id = r.id
      AND type = 'withdrawal_reversal'
      AND direction = 'credit';

    IF v_reversal_count <> 0 THEN
      RAISE EXCEPTION
        'Withdrawal % already has % reversal(s)',
        r.id,
        v_reversal_count;
    END IF;

    v_balance := v_balance + r.expected_amount;

    UPDATE public.profiles
    SET
      wallet_balance = v_balance,
      updated_at = now()
    WHERE id = v_user_id;

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
      v_user_id,
      'withdrawal_reversal',
      'credit',
      r.expected_amount,
      v_balance,
      r.id,
      'Legacy correction: refund for rejected withdrawal request'
    );

    UPDATE public.withdrawals
    SET balance_after = v_balance
    WHERE id = r.id;
  END LOOP;
END;
$$;

COMMIT;
