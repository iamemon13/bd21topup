-- Read-only schema snapshot, 2026-09-22. Test fixture only; never a migration.
CREATE OR REPLACE FUNCTION public.admin_review_add_money(p_request_id uuid, p_action text, p_admin_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request public.add_money_requests%rowtype;
  v_current_balance numeric(12,2);
  v_new_balance numeric(12,2);
begin
  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action';
  end if;

  -- Lock the request so it cannot be approved twice at the same time.
  select *
  into v_request
  from public.add_money_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Add Money request not found';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Request already reviewed';
  end if;

  if p_action = 'rejected' then
    update public.add_money_requests
    set
      status = 'rejected',
      admin_note = nullif(trim(coalesce(p_admin_note, '')), ''),
      reviewed_at = now()
    where id = p_request_id;

    return jsonb_build_object(
      'success', true,
      'status', 'rejected',
      'request_id', p_request_id
    );
  end if;

  -- Lock the user's profile/wallet row.
  select wallet_balance
  into v_current_balance
  from public.profiles
  where id = v_request.user_id
  for update;

  if not found then
    raise exception 'User profile not found';
  end if;

  v_new_balance :=
    coalesce(v_current_balance, 0) + v_request.amount;

  update public.profiles
  set
    wallet_balance = v_new_balance,
    updated_at = now()
  where id = v_request.user_id;

  insert into public.wallet_transactions (
    user_id,
    type,
    direction,
    amount,
    balance_after,
    reference_id,
    description
  )
  values (
    v_request.user_id,
    'add_money',
    'credit',
    v_request.amount,
    v_new_balance,
    v_request.id,
    'Add Money approved'
  );

  update public.add_money_requests
  set
    status = 'approved',
    admin_note = nullif(trim(coalesce(p_admin_note, '')), ''),
    reviewed_at = now()
  where id = p_request_id;

  return jsonb_build_object(
    'success', true,
    'status', 'approved',
    'request_id', p_request_id,
    'user_id', v_request.user_id,
    'amount', v_request.amount,
    'balance_after', v_new_balance
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_review_withdrawal(p_withdrawal_id uuid, p_action text, p_admin_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_withdrawal public.withdrawals%rowtype;
  v_current_balance numeric;
  v_new_balance numeric;
  v_reason text;
begin
  p_action := lower(trim(coalesce(p_action, '')));
  v_reason := nullif(trim(coalesce(p_admin_note, '')), '');

  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action';
  end if;

  if p_action = 'rejected' and v_reason is null then
    raise exception 'Rejection reason is required';
  end if;

  select *
  into v_withdrawal
  from public.withdrawals
  where id = p_withdrawal_id
  for update;

  if not found then
    raise exception 'Withdrawal request not found';
  end if;

  if lower(trim(coalesce(v_withdrawal.status, ''))) <> 'pending' then
    raise exception 'Withdrawal request already reviewed';
  end if;

  if v_withdrawal.amount is null or v_withdrawal.amount <= 0 then
    raise exception 'Invalid withdrawal amount';
  end if;

  select wallet_balance
  into v_current_balance
  from public.profiles
  where id = v_withdrawal.user_id
  for update;

  if not found then
    raise exception 'User profile not found';
  end if;

  v_current_balance := coalesce(v_current_balance, 0);

  if p_action = 'rejected' then
    -- রিজেক্ট হলে ব্যালেন্স ফেরত দেওয়া হচ্ছে
    v_new_balance := v_current_balance + v_withdrawal.amount;

    update public.profiles
    set
      wallet_balance = v_new_balance,
      updated_at = now()
    where id = v_withdrawal.user_id;

    update public.withdrawals
    set
      status = 'rejected',
      admin_note = v_reason,
      balance_after = v_new_balance
    where id = p_withdrawal_id;

    -- লেজারে রিভার্সাল এন্ট্রি যোগ করা হচ্ছে
    insert into public.wallet_transactions (
      user_id,
      type,
      direction,
      amount,
      balance_after,
      reference_id,
      description
    ) values (
      v_withdrawal.user_id,
      'withdrawal_reversal',
      'credit',
      v_withdrawal.amount,
      v_new_balance,
      p_withdrawal_id,
      'Refund for rejected withdrawal request'
    );

    insert into public.notifications (
      user_id,
      title,
      message,
      type
    )
    values (
      v_withdrawal.user_id,
      'Withdrawal Rejected ❌',
      format(
        'Your withdrawal request of ৳%s was rejected. Reason: %s',
        v_withdrawal.amount,
        v_reason
      ),
      'general'
    );

    return jsonb_build_object(
      'success', true,
      'status', 'rejected',
      'withdrawal_id', p_withdrawal_id,
      'user_id', v_withdrawal.user_id,
      'amount', v_withdrawal.amount,
      'balance_after', v_new_balance
    );
  end if;

  if p_action = 'approved' then
    -- অ্যাপ্রুভ হলে নতুন করে ব্যালেন্স কাটা হবে না (আগে থেকেই কাটা আছে)
    update public.withdrawals
    set
      status = 'approved',
      admin_note = v_reason,
      balance_after = v_current_balance
    where id = p_withdrawal_id;

    insert into public.notifications (
      user_id,
      title,
      message,
      type
    )
    values (
      v_withdrawal.user_id,
      'Withdrawal Approved ✅',
      format(
        'Your withdrawal request of ৳%s has been approved and sent to your account.',
        v_withdrawal.amount
      ),
      'general'
    );

    return jsonb_build_object(
      'success', true,
      'status', 'approved',
      'withdrawal_id', p_withdrawal_id,
      'user_id', v_withdrawal.user_id,
      'amount', v_withdrawal.amount,
      'balance_after', v_current_balance
    );
  end if;
end;
$function$;
