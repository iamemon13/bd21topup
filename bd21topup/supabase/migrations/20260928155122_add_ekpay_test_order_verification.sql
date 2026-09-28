BEGIN;

CREATE TABLE public.ekpay_payment_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('bkash', 'nagad')),
  provider_transaction_id text NOT NULL CHECK (
    length(provider_transaction_id) BETWEEN 4 AND 80
    AND provider_transaction_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  ),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 100000000),
  currency text NOT NULL DEFAULT 'BDT' CHECK (currency = 'BDT'),
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'reserved', 'consumed')),
  verify_idempotency_key text NOT NULL UNIQUE,
  confirm_idempotency_key text NOT NULL UNIQUE,
  ekpay_verification_id text UNIQUE CHECK (
    ekpay_verification_id IS NULL OR ekpay_verification_id ~ '^vr_[a-f0-9]{32}$'
  ),
  provider_timestamp timestamptz,
  reserved_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ekpay_payment_verifications_state_check CHECK (
    (status = 'prepared' AND ekpay_verification_id IS NULL AND reserved_at IS NULL AND consumed_at IS NULL)
    OR (status = 'reserved' AND ekpay_verification_id IS NOT NULL AND reserved_at IS NOT NULL AND consumed_at IS NULL)
    OR (status = 'consumed' AND ekpay_verification_id IS NOT NULL AND reserved_at IS NOT NULL AND consumed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX ekpay_payment_verifications_provider_reference_key
ON public.ekpay_payment_verifications(provider, lower(provider_transaction_id));

ALTER TABLE public.ekpay_payment_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ekpay_payment_verifications FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prepare_ekpay_order_verification(
  p_user_id uuid,
  p_order_id uuid,
  p_transaction_id text
)
RETURNS TABLE(
  attempt_id uuid,
  order_id uuid,
  provider text,
  provider_transaction_id text,
  amount_minor bigint,
  status text,
  ekpay_verification_id text,
  verify_idempotency_key text,
  confirm_idempotency_key text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  order_row public.orders%ROWTYPE;
  attempt public.ekpay_payment_verifications%ROWTYPE;
  clean_transaction_id text := btrim(p_transaction_id);
  normalized_provider text;
  exact_minor numeric;
BEGIN
  IF p_user_id IS NULL OR p_order_id IS NULL
    OR clean_transaction_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{3,79}$' THEN
    RAISE EXCEPTION 'Invalid verification request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO order_row
  FROM public.orders
  WHERE id = p_order_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order unavailable' USING ERRCODE = 'P0002';
  END IF;

  normalized_provider := lower(btrim(order_row.payment_method));
  IF normalized_provider NOT IN ('bkash', 'nagad') THEN
    RAISE EXCEPTION 'Provider unsupported' USING ERRCODE = 'EKP04';
  END IF;

  IF order_row.status <> 'pending' OR order_row.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Order unavailable' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO attempt
  FROM public.ekpay_payment_verifications
  WHERE ekpay_payment_verifications.order_id = p_order_id
  FOR UPDATE;

  IF order_row.payment_verified_at IS NOT NULL THEN
    IF FOUND AND attempt.status = 'consumed'
      AND order_row.payment_verification_source = 'gateway_api' THEN
      RETURN QUERY SELECT attempt.id, attempt.order_id, attempt.provider,
        attempt.provider_transaction_id, attempt.amount_minor, attempt.status,
        attempt.ekpay_verification_id, attempt.verify_idempotency_key,
        attempt.confirm_idempotency_key;
      RETURN;
    END IF;
    RAISE EXCEPTION 'Payment already verified' USING ERRCODE = 'EKP03';
  END IF;

  IF order_row.amount IS NULL OR order_row.amount <= 0
    OR order_row.amount::text IN ('NaN', 'Infinity', '-Infinity')
    OR trunc(order_row.amount, 2) IS DISTINCT FROM order_row.amount THEN
    RAISE EXCEPTION 'Invalid order amount' USING ERRCODE = '22023';
  END IF;

  exact_minor := order_row.amount * 100;
  IF exact_minor <> trunc(exact_minor) OR exact_minor NOT BETWEEN 1 AND 100000000 THEN
    RAISE EXCEPTION 'Invalid order amount' USING ERRCODE = '22023';
  END IF;

  IF FOUND THEN
    IF attempt.status <> 'prepared' AND (
      attempt.provider <> normalized_provider
      OR lower(attempt.provider_transaction_id) <> lower(clean_transaction_id)
      OR attempt.amount_minor <> exact_minor::bigint
    ) THEN
      RAISE EXCEPTION 'Verification already reserved' USING ERRCODE = '55000';
    END IF;

    IF attempt.status = 'prepared' AND (
      attempt.provider <> normalized_provider
      OR lower(attempt.provider_transaction_id) <> lower(clean_transaction_id)
      OR attempt.amount_minor <> exact_minor::bigint
    ) THEN
      UPDATE public.orders SET transaction_id = clean_transaction_id WHERE id = p_order_id;
      UPDATE public.ekpay_payment_verifications
      SET provider = normalized_provider,
          provider_transaction_id = clean_transaction_id,
          amount_minor = exact_minor::bigint,
          verify_idempotency_key = 'bd21:verify:' || p_order_id::text || ':' || md5(normalized_provider || ':' || lower(clean_transaction_id)),
          updated_at = clock_timestamp()
      WHERE id = attempt.id
      RETURNING * INTO attempt;
    END IF;
  ELSE
    UPDATE public.orders SET transaction_id = clean_transaction_id WHERE id = p_order_id;
    INSERT INTO public.ekpay_payment_verifications(
      order_id, user_id, provider, provider_transaction_id, amount_minor,
      verify_idempotency_key, confirm_idempotency_key
    ) VALUES (
      p_order_id, p_user_id, normalized_provider, clean_transaction_id, exact_minor::bigint,
      'bd21:verify:' || p_order_id::text || ':' || md5(normalized_provider || ':' || lower(clean_transaction_id)),
      'bd21:confirm:' || p_order_id::text
    ) RETURNING * INTO attempt;
  END IF;

  RETURN QUERY SELECT attempt.id, attempt.order_id, attempt.provider,
    attempt.provider_transaction_id, attempt.amount_minor, attempt.status,
    attempt.ekpay_verification_id, attempt.verify_idempotency_key,
    attempt.confirm_idempotency_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_ekpay_order_reservation(
  p_user_id uuid,
  p_order_id uuid,
  p_verification_id text,
  p_provider text,
  p_transaction_id text,
  p_amount_minor bigint,
  p_provider_timestamp timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE attempt public.ekpay_payment_verifications%ROWTYPE;
BEGIN
  IF p_verification_id !~ '^vr_[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'Invalid reservation' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO attempt FROM public.ekpay_payment_verifications
  WHERE order_id = p_order_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE = 'P0002'; END IF;
  IF attempt.provider <> p_provider OR lower(attempt.provider_transaction_id) <> lower(btrim(p_transaction_id))
    OR attempt.amount_minor <> p_amount_minor THEN
    RAISE EXCEPTION 'Reservation mismatch' USING ERRCODE = '23514';
  END IF;
  IF attempt.status IN ('reserved', 'consumed') THEN
    IF attempt.ekpay_verification_id <> p_verification_id THEN
      RAISE EXCEPTION 'Reservation mismatch' USING ERRCODE = '23514';
    END IF;
    RETURN;
  END IF;
  UPDATE public.ekpay_payment_verifications
  SET status = 'reserved', ekpay_verification_id = p_verification_id,
      provider_timestamp = p_provider_timestamp, reserved_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = attempt.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_ekpay_order_verification(
  p_user_id uuid,
  p_order_id uuid,
  p_verification_id text,
  p_provider text,
  p_transaction_id text,
  p_amount_minor bigint,
  p_consumed_at timestamptz
)
RETURNS TABLE(verified boolean, verified_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  attempt public.ekpay_payment_verifications%ROWTYPE;
  order_row public.orders%ROWTYPE;
  effective_time timestamptz;
BEGIN
  SELECT * INTO attempt FROM public.ekpay_payment_verifications
  WHERE order_id = p_order_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO order_row FROM public.orders
  WHERE id = p_order_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE = 'P0002'; END IF;

  IF attempt.ekpay_verification_id <> p_verification_id OR attempt.provider <> p_provider
    OR lower(attempt.provider_transaction_id) <> lower(btrim(p_transaction_id))
    OR attempt.amount_minor <> p_amount_minor OR p_consumed_at IS NULL THEN
    RAISE EXCEPTION 'Confirmation mismatch' USING ERRCODE = '23514';
  END IF;

  IF attempt.status = 'consumed' THEN
    IF order_row.payment_verified_at IS NULL OR order_row.payment_verification_source <> 'gateway_api' THEN
      RAISE EXCEPTION 'Local verification state mismatch' USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT true, order_row.payment_verified_at;
    RETURN;
  END IF;

  IF attempt.status <> 'reserved' OR order_row.status <> 'pending'
    OR order_row.cancelled_at IS NOT NULL OR order_row.payment_verified_at IS NOT NULL THEN
    RAISE EXCEPTION 'Order unavailable' USING ERRCODE = '55000';
  END IF;

  effective_time := clock_timestamp();
  UPDATE public.orders
  SET transaction_id = attempt.provider_transaction_id,
      payment_verified_at = effective_time,
      payment_verified_by = NULL,
      payment_verification_source = 'gateway_api'
  WHERE id = p_order_id;

  UPDATE public.ekpay_payment_verifications
  SET status = 'consumed', consumed_at = p_consumed_at, updated_at = effective_time
  WHERE id = attempt.id;

  RETURN QUERY SELECT true, effective_time;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_ekpay_order_verification(uuid,uuid,text),
  public.record_ekpay_order_reservation(uuid,uuid,text,text,text,bigint,timestamptz),
  public.finalize_ekpay_order_verification(uuid,uuid,text,text,text,bigint,timestamptz)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.prepare_ekpay_order_verification(uuid,uuid,text),
  public.record_ekpay_order_reservation(uuid,uuid,text,text,text,bigint,timestamptz),
  public.finalize_ekpay_order_verification(uuid,uuid,text,text,text,bigint,timestamptz)
TO service_role, postgres;

COMMIT;
