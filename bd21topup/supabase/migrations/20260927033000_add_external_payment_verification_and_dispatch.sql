-- Phase 3: Admin-verified external payment and automatic top-up dispatch foundation.
-- Adds authoritative external payment verification columns to public.orders,
-- makes topup_dispatches.payment_evidence_id nullable for non-wallet dispatches,
-- and updates topup dispatch evidence validation to support verified external payments.
BEGIN;

-- 1. Add authoritative payment verification fields to public.orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_verified_by uuid,
  ADD COLUMN IF NOT EXISTS payment_verification_source text;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_payment_verification_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_verification_check
  CHECK (
    (payment_verified_at IS NULL AND payment_verified_by IS NULL AND payment_verification_source IS NULL)
    OR (
      payment_verified_at IS NOT NULL
      AND payment_verification_source IS NOT NULL
      AND payment_verification_source IN ('admin', 'sms_parser', 'gateway_api')
      AND lower(btrim(payment_method)) IN ('bkash', 'nagad', 'rocket', 'upay')
    )
  );

-- 2. Allow topup_dispatches to store external-payment dispatches without a wallet transaction
ALTER TABLE public.topup_dispatches
  ALTER COLUMN payment_evidence_id DROP NOT NULL;

-- 3. Update topup_dispatch_evidence_is_current to accept both wallet debits and verified external payments
CREATE OR REPLACE FUNCTION public.topup_dispatch_evidence_is_current(p_dispatch_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  d public.topup_dispatches%ROWTYPE;
  o public.orders%ROWTYPE;
  p public.packages%ROWTYPE;
  w public.wallet_transactions%ROWTYPE;
  evidence_count integer;
  operation_count integer;
  expected_manifest text;
  actual_manifest text;
BEGIN
  IF p_dispatch_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO d FROM public.topup_dispatches WHERE id=p_dispatch_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO o FROM public.orders WHERE id=d.order_id FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    1110721073,
    ('x' || substr(replace(d.order_id::text,'-',''),1,8))::bit(32)::integer
  );
  SELECT * INTO p FROM public.packages WHERE id=d.package_id FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;

  -- Common order & package invariant checks
  IF d.dry_run IS DISTINCT FROM true OR d.mapping_version IS DISTINCT FROM 'bd21-kaium-v1'
    OR o.status IS DISTINCT FROM 'pending'
    OR o.cancelled_at IS NOT NULL OR o.user_id IS NULL OR o.user_id IS DISTINCT FROM d.user_id
    OR o.uid !~ '^[0-9]{5,15}$' OR o.uid IS DISTINCT FROM d.uid_snapshot
    OR o.package_name IS DISTINCT FROM d.package_name_snapshot
    OR o.amount::text IN ('NaN','Infinity','-Infinity') OR o.amount <= 0 OR o.amount IS DISTINCT FROM d.amount_snapshot
    OR p.name IS DISTINCT FROM d.package_name_snapshot OR p.category IS DISTINCT FROM d.category_snapshot
    OR (SELECT count(*) FROM public.packages WHERE name=o.package_name) <> 1 THEN
    RETURN false;
  END IF;

  -- Payment Evidence Verification
  IF d.payment_evidence_id IS NOT NULL THEN
    -- Wallet payment branch
    IF lower(btrim(o.payment_method)) IS DISTINCT FROM 'wallet' THEN RETURN false; END IF;
    PERFORM 1 FROM public.wallet_transactions WHERE reference_id=d.order_id FOR SHARE;
    SELECT count(*) INTO evidence_count FROM public.wallet_transactions WHERE reference_id=d.order_id;
    IF evidence_count <> 1 THEN RETURN false; END IF;
    SELECT * INTO w FROM public.wallet_transactions WHERE reference_id=d.order_id;
    IF w.id IS DISTINCT FROM d.payment_evidence_id OR w.user_id IS DISTINCT FROM d.user_id
      OR w.amount::text IN ('NaN','Infinity','-Infinity') OR w.amount IS DISTINCT FROM d.amount_snapshot
      OR w.type IS DISTINCT FROM 'order_payment' OR w.direction IS DISTINCT FROM 'debit' THEN
      RETURN false;
    END IF;
  ELSE
    -- Verified external payment branch
    IF lower(btrim(o.payment_method)) NOT IN ('bkash', 'nagad', 'rocket', 'upay')
      OR o.payment_verified_at IS NULL
      OR o.payment_verification_source IS NULL
      OR o.payment_verification_source NOT IN ('admin', 'sms_parser', 'gateway_api')
      OR o.transaction_id IS NULL
      OR length(btrim(o.transaction_id)) < 4
      OR EXISTS (SELECT 1 FROM public.wallet_transactions WHERE reference_id=d.order_id) THEN
      RETURN false;
    END IF;
  END IF;

  SELECT count(*) INTO operation_count FROM public.topup_dispatch_operations WHERE dispatch_id=d.id;
  expected_manifest := CASE d.package_id
    WHEN '95223d39-1880-4128-a222-08180089a229'::uuid THEN 'weekly:1'
    WHEN '99721284-0b1b-416e-a5e2-14b661eadb32'::uuid THEN 'monthly:1'
    WHEN 'ae01ba14-3234-4fef-a4c2-95a582ff9968'::uuid THEN '25:1'
    WHEN 'bacd7950-2c99-4a19-8c66-14d86e18ff5b'::uuid THEN '50:1'
    WHEN '54e6a71f-5a32-4cbd-a5fd-7140bed5da2c'::uuid THEN '115:1'
    WHEN 'c68e2176-f42b-4b1e-b714-c31e203fc721'::uuid THEN '240:1'
    WHEN '871e33b3-01b4-4f91-9c95-3d5cf03f45e6'::uuid THEN '240:1,115:1'
    WHEN '9b89a6ec-cf8d-4c8a-9dc0-a07becf405c4'::uuid THEN '240:2'
    WHEN 'b0561547-3a49-46a9-9f0e-bbd455643534'::uuid THEN '240:2,25:1'
    WHEN '4e1cc660-4945-4693-a3e2-3290f107e30c'::uuid THEN '610:1'
    WHEN 'f82df3fd-2da0-4028-8a32-37f6beaaf1dd'::uuid THEN '610:1,240:1'
    WHEN '2f59437c-8f6d-4c66-839f-ac6df83ebaf9'::uuid THEN '610:1,240:2'
    WHEN 'be4bae74-8dbf-4d9a-ae9a-849adb811c7b'::uuid THEN '1240:1'
    WHEN '7ef8fadf-8197-43d4-845e-9f98c1462a1b'::uuid THEN '1240:1,610:1,240:1'
    WHEN 'b7235f00-8368-4558-a4b3-b6ffe3dc830c'::uuid THEN '2530:1'
    WHEN 'b6f1312a-6508-4f94-af05-a48d45dfeeef'::uuid THEN '2530:2'
    WHEN '33102353-1d9a-4937-bb3a-7b797c2ded06'::uuid THEN '2530:4'
    WHEN '04948e15-7bee-491d-8db6-dbc398861967'::uuid THEN 'weekly:1'
    WHEN 'c32ca0f0-778d-40e3-a7da-83a2fc58e8b2'::uuid THEN 'weekly:2'
    WHEN '29140eb1-2d29-4b9b-a34b-f8d71f9b9955'::uuid THEN 'weekly:3'
    WHEN '993bab44-d1bf-4331-a20f-107405a279a4'::uuid THEN 'weekly:4'
    WHEN '01e81c8e-01ab-40d7-af36-352660b19f76'::uuid THEN 'monthly:1'
    WHEN '7906c87d-827b-4fdd-9b2f-8c45ac0c0cce'::uuid THEN 'monthly:1,weekly:1'
    WHEN '222168ef-c8e2-4401-9997-62df9866ef8d'::uuid THEN 'monthly:1,weekly:4'
    WHEN 'b2bfec13-2553-4173-af1d-fe11ae184df9'::uuid THEN 'monthly:2'
    WHEN '3bbfcdbe-8ac2-42bb-be6d-cd065e24a35d'::uuid THEN 'monthly:3'
    WHEN '6c4bba03-9dbf-4843-80f6-4130e285a76a'::uuid THEN 'monthly:4'
    WHEN 'fd8341a6-ba2b-4578-9780-6fe8eaeaad99'::uuid THEN 'lite:1'
    WHEN '0ccd017e-0cbe-4452-85e6-d1a6c8ad86e9'::uuid THEN 'lite:2'
    WHEN 'a158e780-cc8b-44bf-986b-3a72e3edc4db'::uuid THEN 'lite:3'
    WHEN 'a75690e6-3d0c-4d18-89a8-86c6b2ae0f77'::uuid THEN 'lite:5'
    WHEN 'd2872f8f-cf42-471c-b473-b6736aba3758'::uuid THEN 'lvl6:1'
    WHEN 'f8ecbbba-6776-4c37-b064-b3213c543de1'::uuid THEN 'lvl10:1'
    WHEN '5e845458-ed7c-4095-adaa-d6246105f9bb'::uuid THEN 'lvl15:1'
    WHEN '58b1af77-6ebc-4542-a279-1ecd01e3d958'::uuid THEN 'lvl20:1'
    WHEN '78cc62f6-a354-4519-8430-fa643af00fd0'::uuid THEN 'lvl25:1'
    WHEN 'ea31ea9d-301b-463c-9b0f-3bdcbfa63c8f'::uuid THEN 'lvl30:1'
    ELSE NULL END;
  IF expected_manifest IS NULL THEN RETURN false; END IF;
  SELECT string_agg(op.product_code || ':' || op.quantity::text, ',' ORDER BY op.sequence_no)
    INTO actual_manifest FROM public.topup_dispatch_operations op WHERE op.dispatch_id=d.id;
  IF actual_manifest IS DISTINCT FROM expected_manifest THEN RETURN false; END IF;
  RETURN true;
END;
$$;

-- 4. Update admin_create_topup_dispatch_dry_run to support verified external payment orders
CREATE OR REPLACE FUNCTION public.admin_create_topup_dispatch_dry_run(
  p_admin_id uuid,
  p_order_id uuid,
  p_package_id uuid,
  p_mapping_version text,
  p_operations jsonb,
  p_ip text DEFAULT NULL
)
RETURNS TABLE(dispatch_id uuid, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  order_row public.orders%ROWTYPE;
  package_row public.packages%ROWTYPE;
  debit public.wallet_transactions%ROWTYPE;
  evidence_count integer;
  expected_operations jsonb;
  normalized_operations jsonb;
  expected_category text;
  expected_name text;
  new_dispatch_id uuid;
  existing_operations jsonb;
  target_payment_evidence_id uuid := NULL;
BEGIN
  IF p_admin_id IS NULL OR p_order_id IS NULL OR p_package_id IS NULL
    OR p_mapping_version IS DISTINCT FROM 'bd21-kaium-v1'
    OR p_operations IS NULL OR jsonb_typeof(p_operations) <> 'array'
    OR jsonb_array_length(p_operations) = 0 THEN
    RAISE EXCEPTION 'Invalid parameters' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = p_admin_id AND 'manage_orders' = ANY(permissions)
  ) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO order_row FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR order_row.status <> 'pending' OR order_row.cancelled_at IS NOT NULL
    OR order_row.user_id IS NULL OR order_row.uid !~ '^[0-9]{5,15}$' THEN
    RAISE EXCEPTION 'Order is not eligible for dispatch' USING ERRCODE = '55000';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    1110721073,
    ('x' || substr(replace(p_order_id::text,'-',''),1,8))::bit(32)::integer
  );

  SELECT * INTO package_row FROM public.packages WHERE id = p_package_id FOR SHARE;
  IF NOT FOUND OR (SELECT count(*) FROM public.packages WHERE name = order_row.package_name) <> 1
    OR package_row.name IS DISTINCT FROM order_row.package_name THEN
    RAISE EXCEPTION 'Package mismatch or ambiguous catalog' USING ERRCODE = '55000';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('productCode',value->>'productCode','quantity',(value->>'quantity')::integer))
    INTO normalized_operations FROM jsonb_array_elements(p_operations) AS value;

  expected_operations := CASE p_package_id
    WHEN '95223d39-1880-4128-a222-08180089a229'::uuid THEN '[{"productCode":"weekly","quantity":1}]'::jsonb
    WHEN '99721284-0b1b-416e-a5e2-14b661eadb32'::uuid THEN '[{"productCode":"monthly","quantity":1}]'::jsonb
    WHEN 'ae01ba14-3234-4fef-a4c2-95a582ff9968'::uuid THEN '[{"productCode":"25","quantity":1}]'::jsonb
    WHEN 'bacd7950-2c99-4a19-8c66-14d86e18ff5b'::uuid THEN '[{"productCode":"50","quantity":1}]'::jsonb
    WHEN '54e6a71f-5a32-4cbd-a5fd-7140bed5da2c'::uuid THEN '[{"productCode":"115","quantity":1}]'::jsonb
    WHEN 'c68e2176-f42b-4b1e-b714-c31e203fc721'::uuid THEN '[{"productCode":"240","quantity":1}]'::jsonb
    WHEN '871e33b3-01b4-4f91-9c95-3d5cf03f45e6'::uuid THEN '[{"productCode":"240","quantity":1},{"productCode":"115","quantity":1}]'::jsonb
    WHEN '9b89a6ec-cf8d-4c8a-9dc0-a07becf405c4'::uuid THEN '[{"productCode":"240","quantity":2}]'::jsonb
    WHEN 'b0561547-3a49-46a9-9f0e-bbd455643534'::uuid THEN '[{"productCode":"240","quantity":2},{"productCode":"25","quantity":1}]'::jsonb
    WHEN '4e1cc660-4945-4693-a3e2-3290f107e30c'::uuid THEN '[{"productCode":"610","quantity":1}]'::jsonb
    WHEN 'f82df3fd-2da0-4028-8a32-37f6beaaf1dd'::uuid THEN '[{"productCode":"610","quantity":1},{"productCode":"240","quantity":1}]'::jsonb
    WHEN '2f59437c-8f6d-4c66-839f-ac6df83ebaf9'::uuid THEN '[{"productCode":"610","quantity":1},{"productCode":"240","quantity":2}]'::jsonb
    WHEN 'be4bae74-8dbf-4d9a-ae9a-849adb811c7b'::uuid THEN '[{"productCode":"1240","quantity":1}]'::jsonb
    WHEN '7ef8fadf-8197-43d4-845e-9f98c1462a1b'::uuid THEN '[{"productCode":"1240","quantity":1},{"productCode":"610","quantity":1},{"productCode":"240","quantity":1}]'::jsonb
    WHEN 'b7235f00-8368-4558-a4b3-b6ffe3dc830c'::uuid THEN '[{"productCode":"2530","quantity":1}]'::jsonb
    WHEN 'b6f1312a-6508-4f94-af05-a48d45dfeeef'::uuid THEN '[{"productCode":"2530","quantity":2}]'::jsonb
    WHEN '33102353-1d9a-4937-bb3a-7b797c2ded06'::uuid THEN '[{"productCode":"2530","quantity":4}]'::jsonb
    WHEN '04948e15-7bee-491d-8db6-dbc398861967'::uuid THEN '[{"productCode":"weekly","quantity":1}]'::jsonb
    WHEN 'c32ca0f0-778d-40e3-a7da-83a2fc58e8b2'::uuid THEN '[{"productCode":"weekly","quantity":2}]'::jsonb
    WHEN '29140eb1-2d29-4b9b-a34b-f8d71f9b9955'::uuid THEN '[{"productCode":"weekly","quantity":3}]'::jsonb
    WHEN '993bab44-d1bf-4331-a20f-107405a279a4'::uuid THEN '[{"productCode":"weekly","quantity":4}]'::jsonb
    WHEN '01e81c8e-01ab-40d7-af36-352660b19f76'::uuid THEN '[{"productCode":"monthly","quantity":1}]'::jsonb
    WHEN '7906c87d-827b-4fdd-9b2f-8c45ac0c0cce'::uuid THEN '[{"productCode":"monthly","quantity":1},{"productCode":"weekly","quantity":1}]'::jsonb
    WHEN '222168ef-c8e2-4401-9997-62df9866ef8d'::uuid THEN '[{"productCode":"monthly","quantity":1},{"productCode":"weekly","quantity":4}]'::jsonb
    WHEN 'b2bfec13-2553-4173-af1d-fe11ae184df9'::uuid THEN '[{"productCode":"monthly","quantity":2}]'::jsonb
    WHEN '3bbfcdbe-8ac2-42bb-be6d-cd065e24a35d'::uuid THEN '[{"productCode":"monthly","quantity":3}]'::jsonb
    WHEN '6c4bba03-9dbf-4843-80f6-4130e285a76a'::uuid THEN '[{"productCode":"monthly","quantity":4}]'::jsonb
    WHEN 'fd8341a6-ba2b-4578-9780-6fe8eaeaad99'::uuid THEN '[{"productCode":"lite","quantity":1}]'::jsonb
    WHEN '0ccd017e-0cbe-4452-85e6-d1a6c8ad86e9'::uuid THEN '[{"productCode":"lite","quantity":2}]'::jsonb
    WHEN 'a158e780-cc8b-44bf-986b-3a72e3edc4db'::uuid THEN '[{"productCode":"lite","quantity":3}]'::jsonb
    WHEN 'a75690e6-3d0c-4d18-89a8-86c6b2ae0f77'::uuid THEN '[{"productCode":"lite","quantity":5}]'::jsonb
    WHEN 'd2872f8f-cf42-471c-b473-b6736aba3758'::uuid THEN '[{"productCode":"lvl6","quantity":1}]'::jsonb
    WHEN 'f8ecbbba-6776-4c37-b064-b3213c543de1'::uuid THEN '[{"productCode":"lvl10","quantity":1}]'::jsonb
    WHEN '5e845458-ed7c-4095-adaa-d6246105f9bb'::uuid THEN '[{"productCode":"lvl15","quantity":1}]'::jsonb
    WHEN '58b1af77-6ebc-4542-a279-1ecd01e3d958'::uuid THEN '[{"productCode":"lvl20","quantity":1}]'::jsonb
    WHEN '78cc62f6-a354-4519-8430-fa643af00fd0'::uuid THEN '[{"productCode":"lvl25","quantity":1}]'::jsonb
    WHEN 'ea31ea9d-301b-463c-9b0f-3bdcbfa63c8f'::uuid THEN '[{"productCode":"lvl30","quantity":1}]'::jsonb
    ELSE NULL
  END;
  expected_category := CASE
    WHEN p_package_id = ANY(ARRAY['95223d39-1880-4128-a222-08180089a229','99721284-0b1b-416e-a5e2-14b661eadb32','ae01ba14-3234-4fef-a4c2-95a582ff9968','bacd7950-2c99-4a19-8c66-14d86e18ff5b','54e6a71f-5a32-4cbd-a5fd-7140bed5da2c','c68e2176-f42b-4b1e-b714-c31e203fc721','871e33b3-01b4-4f91-9c95-3d5cf03f45e6','9b89a6ec-cf8d-4c8a-9dc0-a07becf405c4','b0561547-3a49-46a9-9f0e-bbd455643534','4e1cc660-4945-4693-a3e2-3290f107e30c','f82df3fd-2da0-4028-8a32-37f6beaaf1dd','2f59437c-8f6d-4c66-839f-ac6df83ebaf9','be4bae74-8dbf-4d9a-ae9a-849adb811c7b','7ef8fadf-8197-43d4-845e-9f98c1462a1b','b7235f00-8368-4558-a4b3-b6ffe3dc830c','b6f1312a-6508-4f94-af05-a48d45dfeeef','33102353-1d9a-4937-bb3a-7b797c2ded06']::uuid[]) THEN 'uid_bd'
    WHEN p_package_id = ANY(ARRAY['04948e15-7bee-491d-8db6-dbc398861967','c32ca0f0-778d-40e3-a7da-83a2fc58e8b2','29140eb1-2d29-4b9b-a34b-f8d71f9b9955','993bab44-d1bf-4331-a20f-107405a279a4','01e81c8e-01ab-40d7-af36-352660b19f76','7906c87d-827b-4fdd-9b2f-8c45ac0c0cce','222168ef-c8e2-4401-9997-62df9866ef8d','b2bfec13-2553-4173-af1d-fe11ae184df9','3bbfcdbe-8ac2-42bb-be6d-cd065e24a35d','6c4bba03-9dbf-4843-80f6-4130e285a76a']::uuid[]) THEN 'combo_offer'
    WHEN p_package_id = ANY(ARRAY['fd8341a6-ba2b-4578-9780-6fe8eaeaad99','0ccd017e-0cbe-4452-85e6-d1a6c8ad86e9','a158e780-cc8b-44bf-986b-3a72e3edc4db','a75690e6-3d0c-4d18-89a8-86c6b2ae0f77']::uuid[]) THEN 'weekly_lite'
    WHEN p_package_id = ANY(ARRAY['d2872f8f-cf42-471c-b473-b6736aba3758','f8ecbbba-6776-4c37-b064-b3213c543de1','5e845458-ed7c-4095-adaa-d6246105f9bb','58b1af77-6ebc-4542-a279-1ecd01e3d958','78cc62f6-a354-4519-8430-fa643af00fd0','ea31ea9d-301b-463c-9b0f-3bdcbfa63c8f']::uuid[]) THEN 'level_up'
    ELSE NULL END;
  expected_name := CASE p_package_id
    WHEN '95223d39-1880-4128-a222-08180089a229'::uuid THEN 'Weekly'
    WHEN '99721284-0b1b-416e-a5e2-14b661eadb32'::uuid THEN 'Monthly'
    WHEN 'ae01ba14-3234-4fef-a4c2-95a582ff9968'::uuid THEN '25 Diamond'
    WHEN 'bacd7950-2c99-4a19-8c66-14d86e18ff5b'::uuid THEN '50 Diamond'
    WHEN '54e6a71f-5a32-4cbd-a5fd-7140bed5da2c'::uuid THEN '115 Diamond'
    WHEN 'c68e2176-f42b-4b1e-b714-c31e203fc721'::uuid THEN '240 Diamond'
    WHEN '871e33b3-01b4-4f91-9c95-3d5cf03f45e6'::uuid THEN '355 Diamond'
    WHEN '9b89a6ec-cf8d-4c8a-9dc0-a07becf405c4'::uuid THEN '480 Diamond'
    WHEN 'b0561547-3a49-46a9-9f0e-bbd455643534'::uuid THEN '505 Diamond'
    WHEN '4e1cc660-4945-4693-a3e2-3290f107e30c'::uuid THEN '610 Diamond'
    WHEN 'f82df3fd-2da0-4028-8a32-37f6beaaf1dd'::uuid THEN '850 Diamond'
    WHEN '2f59437c-8f6d-4c66-839f-ac6df83ebaf9'::uuid THEN '1090 Diamond'
    WHEN 'be4bae74-8dbf-4d9a-ae9a-849adb811c7b'::uuid THEN '1240 Diamond'
    WHEN '7ef8fadf-8197-43d4-845e-9f98c1462a1b'::uuid THEN '2090 Diamond'
    WHEN 'b7235f00-8368-4558-a4b3-b6ffe3dc830c'::uuid THEN '2530 Diamond'
    WHEN 'b6f1312a-6508-4f94-af05-a48d45dfeeef'::uuid THEN '5060 Diamond'
    WHEN '33102353-1d9a-4937-bb3a-7b797c2ded06'::uuid THEN '10120 Diamond'
    WHEN '04948e15-7bee-491d-8db6-dbc398861967'::uuid THEN '1x Weekly'
    WHEN 'c32ca0f0-778d-40e3-a7da-83a2fc58e8b2'::uuid THEN '2x Weekly'
    WHEN '29140eb1-2d29-4b9b-a34b-f8d71f9b9955'::uuid THEN '3x Weekly'
    WHEN '993bab44-d1bf-4331-a20f-107405a279a4'::uuid THEN '4x Weekly'
    WHEN '01e81c8e-01ab-40d7-af36-352660b19f76'::uuid THEN '1x Monthly'
    WHEN '7906c87d-827b-4fdd-9b2f-8c45ac0c0cce'::uuid THEN '1 Monthly + 1 Weekly'
    WHEN '222168ef-c8e2-4401-9997-62df9866ef8d'::uuid THEN '1 Monthly + 4 Weekly'
    WHEN 'b2bfec13-2553-4173-af1d-fe11ae184df9'::uuid THEN '2x Monthly'
    WHEN '3bbfcdbe-8ac2-42bb-be6d-cd065e24a35d'::uuid THEN '3x Monthly'
    WHEN '6c4bba03-9dbf-4843-80f6-4130e285a76a'::uuid THEN '4x Monthly'
    WHEN 'fd8341a6-ba2b-4578-9780-6fe8eaeaad99'::uuid THEN '1x Weekly Lite'
    WHEN '0ccd017e-0cbe-4452-85e6-d1a6c8ad86e9'::uuid THEN '2x Weekly Lite'
    WHEN 'a158e780-cc8b-44bf-986b-3a72e3edc4db'::uuid THEN '3x Weekly Lite'
    WHEN 'a75690e6-3d0c-4d18-89a8-86c6b2ae0f77'::uuid THEN '5x Weekly Lite'
    WHEN 'd2872f8f-cf42-471c-b473-b6736aba3758'::uuid THEN 'Level Up Package - Level 6'
    WHEN 'f8ecbbba-6776-4c37-b064-b3213c543de1'::uuid THEN 'Level Up Package - Level 10'
    WHEN '5e845458-ed7c-4095-adaa-d6246105f9bb'::uuid THEN 'Level Up Package - Level 15'
    WHEN '58b1af77-6ebc-4542-a279-1ecd01e3d958'::uuid THEN 'Level Up Package - Level 20'
    WHEN '78cc62f6-a354-4519-8430-fa643af00fd0'::uuid THEN 'Level Up Package - Level 25'
    WHEN 'ea31ea9d-301b-463c-9b0f-3bdcbfa63c8f'::uuid THEN 'Level Up Package - Level 30'
    ELSE NULL END;
  IF expected_operations IS NULL OR expected_operations IS DISTINCT FROM normalized_operations
    OR package_row.category IS DISTINCT FROM expected_category
    OR package_row.name IS DISTINCT FROM expected_name THEN
    RAISE EXCEPTION 'Package operations are not approved' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_operations) WITH ORDINALITY AS op(value, ordinality)
    WHERE value->>'commandHash' IS DISTINCT FROM encode(sha256(convert_to(
      format('bd21-topup-op-v1|%s|%s|%s|%s|%s',p_mapping_version,order_row.uid,ordinality,value->>'productCode',value->>'quantity'),
      'UTF8')), 'hex')
  ) THEN
    RAISE EXCEPTION 'Operation hash mismatch' USING ERRCODE = '55000';
  END IF;

  -- Payment Evidence Verification
  IF lower(btrim(order_row.payment_method)) = 'wallet' THEN
    SELECT count(*) INTO evidence_count FROM public.wallet_transactions WHERE reference_id = p_order_id;
    IF evidence_count <> 1 THEN RAISE EXCEPTION 'Ambiguous wallet evidence' USING ERRCODE = '55000'; END IF;
    SELECT * INTO debit FROM public.wallet_transactions WHERE reference_id = p_order_id FOR SHARE;
    IF order_row.amount::text IN ('NaN','Infinity','-Infinity') OR debit.amount::text IN ('NaN','Infinity','-Infinity')
      OR order_row.amount <= 0 OR debit.user_id IS DISTINCT FROM order_row.user_id OR debit.amount IS DISTINCT FROM order_row.amount
      OR debit.type <> 'order_payment' OR debit.direction <> 'debit' THEN
      RAISE EXCEPTION 'Wallet evidence changed or invalid' USING ERRCODE = '55000';
    END IF;
    target_payment_evidence_id := debit.id;
  ELSIF lower(btrim(order_row.payment_method)) IN ('bkash', 'nagad', 'rocket', 'upay') THEN
    IF order_row.payment_verified_at IS NULL
      OR order_row.payment_verification_source IS NULL
      OR order_row.payment_verification_source NOT IN ('admin', 'sms_parser', 'gateway_api')
      OR order_row.transaction_id IS NULL
      OR length(btrim(order_row.transaction_id)) < 4
      OR EXISTS (SELECT 1 FROM public.wallet_transactions WHERE reference_id = p_order_id) THEN
      RAISE EXCEPTION 'External payment is not verified' USING ERRCODE = '55000';
    END IF;
    target_payment_evidence_id := NULL;
  ELSE
    RAISE EXCEPTION 'Unsupported payment method for dispatch' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.topup_dispatches(order_id,user_id,package_id,payment_evidence_id,mapping_version,
    uid_snapshot,package_name_snapshot,category_snapshot,amount_snapshot,created_by)
  VALUES(order_row.id,order_row.user_id,package_row.id,target_payment_evidence_id,p_mapping_version,
    order_row.uid,package_row.name,package_row.category,order_row.amount,p_admin_id)
  ON CONFLICT (order_id,mapping_version) DO NOTHING RETURNING id INTO new_dispatch_id;

  IF new_dispatch_id IS NULL THEN
    SELECT id INTO new_dispatch_id FROM public.topup_dispatches
    WHERE order_id=p_order_id AND mapping_version=p_mapping_version;
    SELECT jsonb_agg(jsonb_build_object('productCode',op.product_code,'quantity',op.quantity,'commandHash',op.command_hash) ORDER BY op.sequence_no)
      INTO existing_operations FROM public.topup_dispatch_operations op WHERE op.dispatch_id=new_dispatch_id;
    IF NOT public.topup_dispatch_evidence_is_current(new_dispatch_id)
      OR existing_operations IS DISTINCT FROM p_operations THEN
      RAISE EXCEPTION 'Existing dispatch evidence is stale' USING ERRCODE='55000';
    END IF;
    RETURN QUERY SELECT new_dispatch_id, false;
    RETURN;
  END IF;

  INSERT INTO public.topup_dispatch_operations(dispatch_id,operation_key,sequence_no,product_code,quantity,command_hash)
  SELECT new_dispatch_id, p_mapping_version || ':' || ordinality::text, ordinality::integer,
    value->>'productCode', (value->>'quantity')::integer, value->>'commandHash'
  FROM jsonb_array_elements(p_operations) WITH ORDINALITY AS op(value, ordinality);

  INSERT INTO public.admin_audit_logs(admin_id,action_type,target_id,details,ip_address)
  VALUES(p_admin_id,'TOPUP_DISPATCH_CREATED',new_dispatch_id::text,
    jsonb_build_object('dry_run',true,'order_id',p_order_id,'dispatch_id',new_dispatch_id,
      'mapping_version',p_mapping_version,'operation_count',jsonb_array_length(p_operations))::text,
    COALESCE(p_ip,'unknown'));

  RETURN QUERY SELECT new_dispatch_id, true;
END;
$$;

-- 5. Atomic RPC for verifying an external payment order by an authorized admin
CREATE OR REPLACE FUNCTION public.admin_verify_external_order_payment(
  p_admin_id uuid,
  p_order_id uuid,
  p_source text DEFAULT 'admin',
  p_ip text DEFAULT NULL
)
RETURNS TABLE(verified boolean, order_id uuid, verified_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  order_row public.orders%ROWTYPE;
  already_verified boolean;
  effective_verified_at timestamptz;
BEGIN
  IF p_admin_id IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'Invalid parameters' USING ERRCODE = '22023';
  END IF;

  IF p_source IS NULL OR p_source NOT IN ('admin', 'sms_parser', 'gateway_api') THEN
    RAISE EXCEPTION 'Invalid verification source' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = p_admin_id AND 'manage_orders' = ANY(permissions)
  ) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO order_row FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  IF order_row.status <> 'pending' OR order_row.cancelled_at IS NOT NULL
    OR order_row.user_id IS NULL OR lower(btrim(order_row.payment_method)) NOT IN ('bkash', 'nagad', 'rocket', 'upay')
    OR order_row.transaction_id IS NULL OR length(btrim(order_row.transaction_id)) < 4 THEN
    RAISE EXCEPTION 'Order is not eligible for payment verification' USING ERRCODE = '55000';
  END IF;

  already_verified := (order_row.payment_verified_at IS NOT NULL);

  IF already_verified THEN
    effective_verified_at := order_row.payment_verified_at;
  ELSE
    effective_verified_at := clock_timestamp();
    UPDATE public.orders
    SET payment_verified_at = effective_verified_at,
        payment_verified_by = p_admin_id,
        payment_verification_source = p_source
    WHERE id = p_order_id;

    INSERT INTO public.admin_audit_logs(admin_id, action_type, target_id, details, ip_address)
    VALUES(p_admin_id, 'EXTERNAL_PAYMENT_VERIFIED', p_order_id::text,
      jsonb_build_object(
        'order_id', p_order_id,
        'payment_method', order_row.payment_method,
        'transaction_id', order_row.transaction_id,
        'amount', order_row.amount,
        'source', p_source
      )::text,
      COALESCE(p_ip, 'unknown'));
  END IF;

  RETURN QUERY SELECT true, p_order_id, effective_verified_at;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_verify_external_order_payment(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_verify_external_order_payment(uuid,uuid,text,text) TO service_role;

COMMIT;
