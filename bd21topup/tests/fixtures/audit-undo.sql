CREATE OR REPLACE FUNCTION public.admin_undo_add_money(p_request_id uuid, p_admin_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

DECLARE
  v_request public.add_money_requests%rowtype;

  v_current_balance numeric(12,2);
  v_new_balance numeric(12,2);

BEGIN

  /* =====================================================
     1. Lock Add Money request
  ===================================================== */

  SELECT *
  INTO v_request
  FROM public.add_money_requests
  WHERE id = p_request_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION 'Add Money request not found';
  END IF;


  /* =====================================================
     2. Only Approved / Rejected can be undone
  ===================================================== */

  IF v_request.status NOT IN ('approved', 'rejected') THEN

    RAISE EXCEPTION
      'Only approved or rejected requests can be undone';

  END IF;


  /* =====================================================
     3. REJECTED → PENDING
     
     No wallet change needed.
  ===================================================== */

  IF v_request.status = 'rejected' THEN

    UPDATE public.add_money_requests

    SET
      status = 'pending',
      admin_note =
        CASE
          WHEN p_admin_note IS NULL
          THEN admin_note
          ELSE nullif(trim(p_admin_note), '')
        END,
      reviewed_at = NULL

    WHERE id = p_request_id;


    RETURN jsonb_build_object(
      'success', true,
      'status', 'pending',
      'request_id', p_request_id,
      'wallet_changed', false
    );

  END IF;


  /* =====================================================
     4. APPROVED → PENDING
     
     Lock user's wallet row.
  ===================================================== */

  SELECT wallet_balance
  INTO v_current_balance

  FROM public.profiles

  WHERE id = v_request.user_id

  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;


  v_current_balance :=
    COALESCE(v_current_balance, 0);


  /* =====================================================
     5. Safety Check
     
     Never allow wallet to become negative.
  ===================================================== */

  IF v_current_balance < v_request.amount THEN

    RAISE EXCEPTION
      'Cannot undo this request because the user wallet balance is lower than the approved amount';

  END IF;


  /* =====================================================
     6. Reverse wallet balance
  ===================================================== */

  v_new_balance :=
    v_current_balance - v_request.amount;


  UPDATE public.profiles

  SET
    wallet_balance = v_new_balance,
    updated_at = now()

  WHERE id = v_request.user_id;


  /* =====================================================
     7. Create reversal wallet transaction
  ===================================================== */

  INSERT INTO public.wallet_transactions
  (
    user_id,
    type,
    direction,
    amount,
    balance_after,
    reference_id,
    description
  )

  VALUES
  (
    v_request.user_id,
    'add_money_reversal',
    'debit',
    v_request.amount,
    v_new_balance,
    v_request.id,
    'Add Money approval undone'
  );


  /* =====================================================
     8. Change request back to Pending
  ===================================================== */

  UPDATE public.add_money_requests

  SET
    status = 'pending',

    admin_note =
      CASE
        WHEN p_admin_note IS NULL
        THEN admin_note
        ELSE nullif(trim(p_admin_note), '')
      END,

    reviewed_at = NULL

  WHERE id = p_request_id;


  /* =====================================================
     9. Return result
  ===================================================== */

  RETURN jsonb_build_object(

    'success', true,

    'status', 'pending',

    'request_id', p_request_id,

    'user_id', v_request.user_id,

    'amount', v_request.amount,

    'balance_after', v_new_balance,

    'wallet_changed', true

  );

END;

$function$;
