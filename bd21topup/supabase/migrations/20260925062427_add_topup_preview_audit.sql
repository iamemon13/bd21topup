-- Preview only. No order/financial writes, backfill, or dispatch objects.
-- Apply only after local tests and explicit production approval.
BEGIN;
CREATE FUNCTION public.admin_audit_topup_preview(
  p_admin_id uuid,
  p_order_id uuid,
  p_package_id uuid,
  p_expected_uid text,
  p_expected_user_id uuid,
  p_expected_amount numeric,
  p_expected_package_name text,
  p_expected_category text,
  p_debit_id uuid,
  p_mapping_version text,
  p_command_hashes text[],
  p_ip text DEFAULT 'unknown'
)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  actor_role text;
  actor_permissions text[];
  order_row public.orders%ROWTYPE;
  package_row public.packages%ROWTYPE;
  debit public.wallet_transactions%ROWTYPE;
  evidence_count integer;
  generated_at timestamptz;
BEGIN
  SELECT role, permissions INTO actor_role, actor_permissions
  FROM public.admin_roles WHERE user_id = p_admin_id FOR SHARE;
  IF actor_role IS NULL OR actor_role NOT IN ('super_admin','admin','editor')
    OR (actor_role <> 'super_admin' AND NOT ('manage_orders' = ANY(COALESCE(actor_permissions, '{}'::text[])))) THEN
    RAISE EXCEPTION 'Preview permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_mapping_version IS DISTINCT FROM 'bd21-kaium-v1'
    OR p_command_hashes IS NULL OR cardinality(p_command_hashes) NOT BETWEEN 1 AND 3
    OR EXISTS (SELECT 1 FROM unnest(p_command_hashes) h WHERE h IS NULL OR length(h) <> 64 OR h !~ '^[0-9a-f]+$')
    OR length(COALESCE(p_ip,'')) > 100 THEN
    RAISE EXCEPTION 'Invalid preview metadata' USING ERRCODE = '22023';
  END IF;

  -- Shared order lock serializes with completion/cancellation; role and catalog
  -- locks similarly prevent revocation/rename between validation and audit.
  SELECT * INTO order_row FROM public.orders WHERE id = p_order_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order missing' USING ERRCODE = 'P0002'; END IF;
  IF order_row.status <> 'pending' OR order_row.user_id IS NULL
    OR order_row.cancelled_at IS NOT NULL OR lower(btrim(order_row.payment_method)) <> 'wallet'
    OR order_row.uid IS NULL OR length(order_row.uid) NOT BETWEEN 5 AND 15
    OR order_row.uid ~ '[^0-9]'
    OR order_row.uid IS DISTINCT FROM p_expected_uid
    OR order_row.user_id IS DISTINCT FROM p_expected_user_id
    OR order_row.amount IS DISTINCT FROM p_expected_amount
    OR order_row.package_name IS DISTINCT FROM p_expected_package_name THEN
    RAISE EXCEPTION 'Order changed or ineligible' USING ERRCODE = '55000';
  END IF;

  IF p_package_id IS NULL OR NOT (p_package_id = ANY(ARRAY[
    '95223d39-1880-4128-a222-08180089a229'::uuid,
    '99721284-0b1b-416e-a5e2-14b661eadb32'::uuid,
    'ae01ba14-3234-4fef-a4c2-95a582ff9968'::uuid,
    'bacd7950-2c99-4a19-8c66-14d86e18ff5b'::uuid,
    '54e6a71f-5a32-4cbd-a5fd-7140bed5da2c'::uuid,
    'c68e2176-f42b-4b1e-b714-c31e203fc721'::uuid,
    '871e33b3-01b4-4f91-9c95-3d5cf03f45e6'::uuid,
    '9b89a6ec-cf8d-4c8a-9dc0-a07becf405c4'::uuid,
    'b0561547-3a49-46a9-9f0e-bbd455643534'::uuid,
    '4e1cc660-4945-4693-a3e2-3290f107e30c'::uuid,
    'f82df3fd-2da0-4028-8a32-37f6beaaf1dd'::uuid,
    '2f59437c-8f6d-4c66-839f-ac6df83ebaf9'::uuid,
    'be4bae74-8dbf-4d9a-ae9a-849adb811c7b'::uuid,
    '7ef8fadf-8197-43d4-845e-9f98c1462a1b'::uuid,
    'b7235f00-8368-4558-a4b3-b6ffe3dc830c'::uuid,
    'b6f1312a-6508-4f94-af05-a48d45dfeeef'::uuid,
    '33102353-1d9a-4937-bb3a-7b797c2ded06'::uuid,
    '04948e15-7bee-491d-8db6-dbc398861967'::uuid,
    'c32ca0f0-778d-40e3-a7da-83a2fc58e8b2'::uuid,
    '29140eb1-2d29-4b9b-a34b-f8d71f9b9955'::uuid,
    '993bab44-d1bf-4331-a20f-107405a279a4'::uuid,
    '01e81c8e-01ab-40d7-af36-352660b19f76'::uuid,
    '7906c87d-827b-4fdd-9b2f-8c45ac0c0cce'::uuid,
    '222168ef-c8e2-4401-9997-62df9866ef8d'::uuid,
    'b2bfec13-2553-4173-af1d-fe11ae184df9'::uuid,
    '3bbfcdbe-8ac2-42bb-be6d-cd065e24a35d'::uuid,
    '6c4bba03-9dbf-4843-80f6-4130e285a76a'::uuid,
    'fd8341a6-ba2b-4578-9780-6fe8eaeaad99'::uuid,
    '0ccd017e-0cbe-4452-85e6-d1a6c8ad86e9'::uuid,
    'a158e780-cc8b-44bf-986b-3a72e3edc4db'::uuid,
    'a75690e6-3d0c-4d18-89a8-86c6b2ae0f77'::uuid,
    'd2872f8f-cf42-471c-b473-b6736aba3758'::uuid,
    'f8ecbbba-6776-4c37-b064-b3213c543de1'::uuid,
    '5e845458-ed7c-4095-adaa-d6246105f9bb'::uuid,
    '58b1af77-6ebc-4542-a279-1ecd01e3d958'::uuid,
    '78cc62f6-a354-4519-8430-fa643af00fd0'::uuid,
    'ea31ea9d-301b-463c-9b0f-3bdcbfa63c8f'::uuid
  ])) THEN
    RAISE EXCEPTION 'Package is not approved' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO package_row FROM public.packages WHERE id = p_package_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Package missing' USING ERRCODE = '55000'; END IF;
  IF package_row.name IS DISTINCT FROM order_row.package_name
    OR package_row.category IS DISTINCT FROM p_expected_category
    OR package_row.category IS NULL
    OR package_row.category NOT IN ('uid_bd','combo_offer','weekly_lite','level_up')
    OR (SELECT count(*) FROM public.packages WHERE name = order_row.package_name) <> 1 THEN
    RAISE EXCEPTION 'Package changed or unmapped' USING ERRCODE = '55000';
  END IF;

  -- Canonical checkout/cancellation hold the order lock. Do not filter away
  -- refunds, wrong-user rows, credits or adjustments when counting evidence.
  SELECT count(*) INTO evidence_count FROM public.wallet_transactions WHERE reference_id = p_order_id;
  IF evidence_count <> 1 THEN RAISE EXCEPTION 'Ambiguous wallet evidence' USING ERRCODE = '55000'; END IF;
  SELECT * INTO debit FROM public.wallet_transactions WHERE reference_id = p_order_id;
  IF debit.id IS DISTINCT FROM p_debit_id OR debit.user_id IS DISTINCT FROM order_row.user_id
    OR debit.amount IS DISTINCT FROM order_row.amount OR debit.type <> 'order_payment'
    OR debit.direction <> 'debit' OR order_row.amount <= 0
    OR order_row.amount::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'Wallet evidence changed or invalid' USING ERRCODE = '55000';
  END IF;

  generated_at := clock_timestamp();
  INSERT INTO public.admin_audit_logs(admin_id, action_type, target_id, details, ip_address)
  VALUES (p_admin_id, 'TOPUP_PREVIEW', p_order_id::text,
    jsonb_build_object('order_id',p_order_id,'package_id',p_package_id,
      'mapping_version',p_mapping_version,'operation_count',cardinality(p_command_hashes),
      'command_hashes',p_command_hashes,'payment_evidence_id',p_debit_id,
      'generated_at',generated_at)::text, COALESCE(p_ip,'unknown'));
  RETURN generated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_audit_topup_preview(uuid,uuid,uuid,text,uuid,numeric,text,text,uuid,text,text[],text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_audit_topup_preview(uuid,uuid,uuid,text,uuid,numeric,text,text,uuid,text,text[],text) TO service_role;
COMMIT;
