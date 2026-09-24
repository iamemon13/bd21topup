-- Make important non-financial admin mutations and their audit entries atomic.
-- These functions are intentionally SECURITY INVOKER and callable only by service_role.
-- They also re-check the stored admin role/permission inside the database transaction.

CREATE OR REPLACE FUNCTION public.admin_update_package_audited(
  p_admin_id uuid,
  p_package_id uuid,
  p_name text,
  p_price numeric,
  p_ip text DEFAULT 'unknown'
)
RETURNS TABLE(
  id uuid,
  name text,
  price numeric,
  category text,
  sort_order integer,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_permissions text[];
  v_package public.packages%ROWTYPE;
BEGIN
  SELECT
    ar.role,
    COALESCE(ar.permissions, '{}'::text[])
  INTO
    v_role,
    v_permissions
  FROM public.admin_roles AS ar
  WHERE ar.user_id = p_admin_id
  FOR SHARE;

  IF
    v_role IS NULL
    OR v_role NOT IN ('super_admin', 'admin', 'editor')
    OR (
      v_role <> 'super_admin'
      AND NOT ('manage_packages' = ANY(v_permissions))
    )
  THEN
    RAISE EXCEPTION 'Missing manage_packages permission'
      USING ERRCODE = '42501';
  END IF;

  IF
    p_package_id IS NULL
    OR p_name IS NULL
    OR char_length(btrim(p_name)) = 0
    OR char_length(btrim(p_name)) > 200
    OR p_price IS NULL
    OR p_price <= 0
    OR p_price > 1000000
  THEN
    RAISE EXCEPTION 'Invalid package update'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.packages AS p
  SET
    name = btrim(p_name),
    price = p_price,
    updated_at = now()
  WHERE p.id = p_package_id
  RETURNING p.*
  INTO v_package;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO public.admin_audit_logs(
    admin_id,
    action_type,
    target_id,
    details,
    ip_address
  )
  VALUES (
    p_admin_id,
    'UPDATE_PACKAGE',
    p_package_id::text,
    jsonb_build_object(
      'name', v_package.name,
      'price', v_package.price
    )::text,
    left(COALESCE(NULLIF(btrim(p_ip), ''), 'unknown'), 200)
  );

  RETURN QUERY
  SELECT
    v_package.id,
    v_package.name,
    v_package.price,
    v_package.category,
    v_package.sort_order,
    v_package.updated_at;
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_update_order_status_audited(
  p_admin_id uuid,
  p_order_id uuid,
  p_expected_status text,
  p_next_status text,
  p_admin_note text DEFAULT NULL,
  p_ip text DEFAULT 'unknown'
)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  uid text,
  player_name text,
  product_name text,
  package_name text,
  amount numeric,
  status text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_permissions text[];
  v_order public.orders%ROWTYPE;
  v_previous_status text;
  v_audit_action text;
  v_note text;
BEGIN
  SELECT
    ar.role,
    COALESCE(ar.permissions, '{}'::text[])
  INTO
    v_role,
    v_permissions
  FROM public.admin_roles AS ar
  WHERE ar.user_id = p_admin_id
  FOR SHARE;

  IF
    v_role IS NULL
    OR v_role NOT IN ('super_admin', 'admin', 'editor')
    OR (
      v_role <> 'super_admin'
      AND NOT ('manage_orders' = ANY(v_permissions))
    )
  THEN
    RAISE EXCEPTION 'Missing manage_orders permission'
      USING ERRCODE = '42501';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_admin_note, '')), '');

  IF
    p_order_id IS NULL
    OR p_expected_status IS NULL
    OR p_next_status IS NULL
    OR char_length(COALESCE(v_note, '')) > 500
    OR p_next_status = 'cancelled'
  THEN
    RAISE EXCEPTION 'Invalid order status update'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (
    (p_expected_status = 'pending'
      AND p_next_status IN ('processing', 'completed', 'rejected'))
    OR
    (p_expected_status = 'approved'
      AND p_next_status IN ('processing', 'completed'))
    OR
    (p_expected_status = 'processing'
      AND p_next_status = 'completed')
  ) THEN
    RAISE EXCEPTION 'Invalid order status transition'
      USING ERRCODE = '22023';
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders AS o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF
    v_order.status IS DISTINCT FROM p_expected_status
    OR v_order.user_id IS NULL
  THEN
    RETURN;
  END IF;

  v_previous_status := v_order.status;

  UPDATE public.orders AS o
  SET
    status = p_next_status,
    admin_note = v_note,
    cancelled_at = NULL
  WHERE o.id = p_order_id
  RETURNING o.*
  INTO v_order;

  v_audit_action :=
    CASE p_next_status
      WHEN 'rejected' THEN 'REJECT_ORDER'
      WHEN 'processing' THEN 'PROCESS_ORDER'
      WHEN 'completed' THEN 'COMPLETE_ORDER'
      ELSE 'UPDATE_ORDER_STATUS'
    END;

  INSERT INTO public.admin_audit_logs(
    admin_id,
    action_type,
    target_id,
    details,
    ip_address
  )
  VALUES (
    p_admin_id,
    v_audit_action,
    p_order_id::text,
    jsonb_build_object(
      'previous_status', v_previous_status,
      'new_status', p_next_status,
      'admin_note', v_note
    )::text,
    left(COALESCE(NULLIF(btrim(p_ip), ''), 'unknown'), 200)
  );

  RETURN QUERY
  SELECT
    v_order.id,
    v_order.user_id,
    v_order.uid,
    v_order.player_name,
    v_order.product_name,
    v_order.package_name,
    v_order.amount,
    v_order.status;
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_bulk_complete_orders_audited(
  p_admin_id uuid,
  p_order_ids uuid[],
  p_ip text DEFAULT 'unknown'
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_permissions text[];
  v_order_id uuid;
  v_completed uuid[] := '{}'::uuid[];
BEGIN
  SELECT
    ar.role,
    COALESCE(ar.permissions, '{}'::text[])
  INTO
    v_role,
    v_permissions
  FROM public.admin_roles AS ar
  WHERE ar.user_id = p_admin_id
  FOR SHARE;

  IF
    v_role IS NULL
    OR v_role NOT IN ('super_admin', 'admin', 'editor')
    OR (
      v_role <> 'super_admin'
      AND NOT ('manage_orders' = ANY(v_permissions))
    )
  THEN
    RAISE EXCEPTION 'Missing manage_orders permission'
      USING ERRCODE = '42501';
  END IF;

  IF
    p_order_ids IS NULL
    OR cardinality(p_order_ids) = 0
    OR cardinality(p_order_ids) > 100
    OR array_position(p_order_ids, NULL) IS NOT NULL
  THEN
    RAISE EXCEPTION 'Invalid bulk order list'
      USING ERRCODE = '22023';
  END IF;

  FOR v_order_id IN
    SELECT o.id
    FROM public.orders AS o
    WHERE
      o.id = ANY(p_order_ids)
      AND o.status IN ('pending', 'approved', 'processing')
    ORDER BY o.id
    FOR UPDATE
  LOOP
    UPDATE public.orders AS o
    SET status = 'completed'
    WHERE
      o.id = v_order_id
      AND o.status IN ('pending', 'approved', 'processing');

    IF FOUND THEN
      INSERT INTO public.admin_audit_logs(
        admin_id,
        action_type,
        target_id,
        details,
        ip_address
      )
      VALUES (
        p_admin_id,
        'BULK_COMPLETE_ORDER',
        v_order_id::text,
        jsonb_build_object(
          'new_status', 'completed',
          'bulk_operation', true
        )::text,
        left(COALESCE(NULLIF(btrim(p_ip), ''), 'unknown'), 200)
      );

      v_completed := array_append(v_completed, v_order_id);
    END IF;
  END LOOP;

  RETURN v_completed;
END;
$$;


REVOKE ALL ON FUNCTION
  public.admin_update_package_audited(uuid, uuid, text, numeric, text)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
  public.admin_update_order_status_audited(uuid, uuid, text, text, text, text)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
  public.admin_bulk_complete_orders_audited(uuid, uuid[], text)
FROM PUBLIC, anon, authenticated;


GRANT EXECUTE ON FUNCTION
  public.admin_update_package_audited(uuid, uuid, text, numeric, text)
TO service_role;

GRANT EXECUTE ON FUNCTION
  public.admin_update_order_status_audited(uuid, uuid, text, text, text, text)
TO service_role;

GRANT EXECUTE ON FUNCTION
  public.admin_bulk_complete_orders_audited(uuid, uuid[], text)
TO service_role;
