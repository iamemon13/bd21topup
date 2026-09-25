-- Phase 2 dry-run dispatch foundation. This migration cannot send Telegram messages
-- and never changes orders, packages, profiles, or wallet_transactions.
BEGIN;

CREATE TABLE public.topup_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  user_id uuid NOT NULL,
  package_id uuid NOT NULL REFERENCES public.packages(id),
  payment_evidence_id uuid NOT NULL REFERENCES public.wallet_transactions(id),
  mapping_version text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','send_intent','dry_run_completed','failed','manual_review')),
  dry_run boolean NOT NULL DEFAULT true CHECK (dry_run),
  uid_snapshot text NOT NULL CHECK (uid_snapshot ~ '^[0-9]{5,15}$'),
  package_name_snapshot text NOT NULL,
  category_snapshot text NOT NULL,
  amount_snapshot numeric NOT NULL CHECK (amount_snapshot > 0),
  created_by uuid NOT NULL,
  manual_review_reason text,
  failed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (status IN ('queued','processing','send_intent') AND completed_at IS NULL AND failed_at IS NULL AND manual_review_reason IS NULL)
    OR (status='dry_run_completed' AND completed_at IS NOT NULL AND failed_at IS NULL AND manual_review_reason IS NULL)
    OR (status='failed' AND completed_at IS NULL AND failed_at IS NOT NULL AND manual_review_reason IS NULL)
    OR (status='manual_review' AND completed_at IS NULL AND failed_at IS NULL AND length(btrim(manual_review_reason)) BETWEEN 1 AND 500)
  ),
  UNIQUE (order_id, mapping_version)
);

CREATE TABLE public.topup_dispatch_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL REFERENCES public.topup_dispatches(id) ON DELETE RESTRICT,
  operation_key text NOT NULL,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  product_code text NOT NULL CHECK (product_code IN ('25','50','115','240','610','1240','2530','weekly','monthly','lite','lvl6','lvl10','lvl15','lvl20','lvl25','lvl30')),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 5),
  command_hash text NOT NULL CHECK (command_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','send_intent','dry_run_completed','failed','manual_review')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claimed_at timestamptz,
  claimed_by text,
  send_attempted_at timestamptz,
  send_intent_id uuid,
  completed_at timestamptz,
  failed_at timestamptz,
  supplier_message_id text,
  supplier_response_hash text,
  supplier_response_summary text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (status='queued' AND claimed_at IS NULL AND claimed_by IS NULL AND send_attempted_at IS NULL AND send_intent_id IS NULL AND completed_at IS NULL AND failed_at IS NULL AND failure_reason IS NULL
      AND supplier_message_id IS NULL AND supplier_response_hash IS NULL AND supplier_response_summary IS NULL)
    OR (status='processing' AND claimed_at IS NOT NULL AND length(btrim(claimed_by)) BETWEEN 1 AND 100 AND send_attempted_at IS NULL AND send_intent_id IS NULL AND completed_at IS NULL AND failed_at IS NULL AND failure_reason IS NULL
      AND supplier_message_id IS NULL AND supplier_response_hash IS NULL AND supplier_response_summary IS NULL)
    OR (status='send_intent' AND claimed_at IS NOT NULL AND length(btrim(claimed_by)) BETWEEN 1 AND 100 AND send_attempted_at IS NOT NULL AND send_intent_id IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL AND failure_reason IS NULL
      AND supplier_message_id IS NULL AND supplier_response_hash IS NULL AND supplier_response_summary IS NULL)
    OR (status='dry_run_completed' AND claimed_at IS NOT NULL AND length(btrim(claimed_by)) BETWEEN 1 AND 100 AND send_attempted_at IS NOT NULL AND send_intent_id IS NOT NULL AND completed_at IS NOT NULL AND failed_at IS NULL AND failure_reason IS NULL
      AND supplier_message_id IS NULL AND supplier_response_hash ~ '^[0-9a-f]{64}$' AND length(btrim(supplier_response_summary)) BETWEEN 1 AND 500)
    OR (status='failed' AND claimed_at IS NOT NULL AND length(btrim(claimed_by)) BETWEEN 1 AND 100 AND send_attempted_at IS NOT NULL AND send_intent_id IS NOT NULL AND completed_at IS NULL AND failed_at IS NOT NULL AND length(btrim(failure_reason)) BETWEEN 1 AND 500
      AND supplier_message_id IS NULL AND supplier_response_hash ~ '^[0-9a-f]{64}$' AND length(btrim(supplier_response_summary)) BETWEEN 1 AND 500)
    OR (status='manual_review' AND completed_at IS NULL AND failed_at IS NULL AND length(btrim(failure_reason)) BETWEEN 1 AND 500 AND (
      (send_attempted_at IS NULL AND send_intent_id IS NULL AND supplier_message_id IS NULL AND supplier_response_hash IS NULL AND supplier_response_summary IS NULL AND ((claimed_at IS NULL AND claimed_by IS NULL) OR (claimed_at IS NOT NULL AND length(btrim(claimed_by)) BETWEEN 1 AND 100)))
      OR (claimed_at IS NOT NULL AND length(btrim(claimed_by)) BETWEEN 1 AND 100 AND send_attempted_at IS NOT NULL AND send_intent_id IS NOT NULL AND supplier_message_id IS NULL AND ((supplier_response_hash IS NULL AND supplier_response_summary IS NULL) OR (supplier_response_hash ~ '^[0-9a-f]{64}$' AND length(btrim(supplier_response_summary)) BETWEEN 1 AND 500)))
    ))
  ),
  UNIQUE (dispatch_id, sequence_no),
  UNIQUE (dispatch_id, operation_key)
);

CREATE INDEX topup_dispatches_status_created_idx ON public.topup_dispatches(status, created_at);
CREATE INDEX topup_dispatch_operations_claim_idx ON public.topup_dispatch_operations(status, created_at, sequence_no);
CREATE INDEX topup_dispatch_operations_dispatch_idx ON public.topup_dispatch_operations(dispatch_id, sequence_no);

ALTER TABLE public.topup_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topup_dispatch_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.topup_dispatches, public.topup_dispatch_operations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.topup_dispatches, public.topup_dispatch_operations TO service_role;

-- Namespace 1110721073 is reserved for BD21 order-wallet evidence. The
-- second key is the first 32 UUID bits. A collision can only serialize two
-- unrelated references; it cannot let conflicting evidence bypass the lock.
CREATE FUNCTION public.lock_wallet_transaction_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.reference_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      1110721073,
      ('x' || substr(replace(NEW.reference_id::text,'-',''),1,8))::bit(32)::integer
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_wallet_transaction_reference() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER lock_wallet_transaction_reference_before_insert
BEFORE INSERT ON public.wallet_transactions
FOR EACH ROW EXECUTE FUNCTION public.lock_wallet_transaction_reference();

CREATE FUNCTION public.topup_dispatch_evidence_is_current(p_dispatch_id uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  d public.topup_dispatches%ROWTYPE;
  o public.orders%ROWTYPE;
  p public.packages%ROWTYPE;
  w public.wallet_transactions%ROWTYPE;
  evidence_count integer;
  operation_count integer;
  expected_manifest text;
BEGIN
  SELECT * INTO d FROM public.topup_dispatches WHERE id=p_dispatch_id FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO o FROM public.orders WHERE id=d.order_id FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    1110721073,
    ('x' || substr(replace(d.order_id::text,'-',''),1,8))::bit(32)::integer
  );
  SELECT * INTO p FROM public.packages WHERE id=d.package_id FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.wallet_transactions WHERE reference_id=d.order_id FOR SHARE;
  SELECT count(*) INTO evidence_count FROM public.wallet_transactions WHERE reference_id=d.order_id;
  IF evidence_count <> 1 THEN RETURN false; END IF;
  SELECT * INTO w FROM public.wallet_transactions WHERE reference_id=d.order_id;

  IF d.dry_run IS DISTINCT FROM true OR d.mapping_version IS DISTINCT FROM 'bd21-kaium-v1'
    OR o.status IS DISTINCT FROM 'pending' OR lower(btrim(o.payment_method)) IS DISTINCT FROM 'wallet'
    OR o.cancelled_at IS NOT NULL OR o.user_id IS NULL OR o.user_id IS DISTINCT FROM d.user_id
    OR o.uid !~ '^[0-9]{5,15}$' OR o.uid IS DISTINCT FROM d.uid_snapshot
    OR o.package_name IS DISTINCT FROM d.package_name_snapshot
    OR o.amount::text IN ('NaN','Infinity','-Infinity') OR o.amount <= 0 OR o.amount IS DISTINCT FROM d.amount_snapshot
    OR p.name IS DISTINCT FROM d.package_name_snapshot OR p.category IS DISTINCT FROM d.category_snapshot
    OR (SELECT count(*) FROM public.packages WHERE name=o.package_name) <> 1
    OR w.id IS DISTINCT FROM d.payment_evidence_id OR w.user_id IS DISTINCT FROM d.user_id
    OR w.amount::text IN ('NaN','Infinity','-Infinity') OR w.amount IS DISTINCT FROM d.amount_snapshot
    OR w.type IS DISTINCT FROM 'order_payment' OR w.direction IS DISTINCT FROM 'debit' THEN
    RETURN false;
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
  IF expected_manifest IS NULL OR (SELECT string_agg(product_code || ':' || quantity::text,',' ORDER BY sequence_no) FROM public.topup_dispatch_operations WHERE dispatch_id=d.id) IS DISTINCT FROM expected_manifest
    OR operation_count NOT BETWEEN 1 AND 3 OR EXISTS (
    SELECT 1 FROM public.topup_dispatch_operations op
    WHERE op.dispatch_id=d.id AND (
      op.sequence_no NOT BETWEEN 1 AND operation_count
      OR op.operation_key IS DISTINCT FROM d.mapping_version || ':' || op.sequence_no::text
      OR op.command_hash IS DISTINCT FROM encode(sha256(convert_to(format(
        'bd21-topup-op-v1|%s|%s|%s|%s|%s',d.mapping_version,d.uid_snapshot,op.sequence_no,op.product_code,op.quantity
      ),'UTF8')),'hex')
    )
  ) OR (SELECT count(DISTINCT sequence_no) FROM public.topup_dispatch_operations WHERE dispatch_id=d.id) <> operation_count THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.topup_dispatch_evidence_is_current(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.admin_create_topup_dispatch_dry_run(
  p_admin_id uuid,
  p_order_id uuid,
  p_package_id uuid,
  p_mapping_version text,
  p_operations jsonb,
  p_ip text DEFAULT 'unknown'
)
RETURNS TABLE(dispatch_id uuid, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor_role text;
  actor_permissions text[];
  order_row public.orders%ROWTYPE;
  package_row public.packages%ROWTYPE;
  debit public.wallet_transactions%ROWTYPE;
  evidence_count integer;
  expected_operations jsonb;
  expected_category text;
  expected_name text;
  normalized_operations jsonb;
  existing_operations jsonb;
  new_dispatch_id uuid;
BEGIN
  SELECT role, permissions INTO actor_role, actor_permissions
  FROM public.admin_roles WHERE user_id = p_admin_id FOR SHARE;
  IF actor_role IS NULL OR actor_role NOT IN ('super_admin','admin','editor')
    OR (actor_role <> 'super_admin' AND NOT ('manage_orders' = ANY(COALESCE(actor_permissions, '{}'::text[])))) THEN
    RAISE EXCEPTION 'Dispatch permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_mapping_version IS DISTINCT FROM 'bd21-kaium-v1'
    OR jsonb_typeof(p_operations) <> 'array'
    OR jsonb_array_length(p_operations) NOT BETWEEN 1 AND 3
    OR length(COALESCE(p_ip,'')) > 100 THEN
    RAISE EXCEPTION 'Invalid dispatch metadata' USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('productCode',value->>'productCode','quantity',(value->>'quantity')::integer) ORDER BY ordinality)
    INTO normalized_operations
  FROM jsonb_array_elements(p_operations) WITH ORDINALITY AS op(value, ordinality)
  WHERE jsonb_typeof(value)='object'
    AND (SELECT count(*) FROM jsonb_object_keys(value))=3
    AND value->>'quantity' ~ '^[1-5]$'
    AND value->>'commandHash' ~ '^[0-9a-f]{64}$';
  IF normalized_operations IS NULL OR jsonb_array_length(normalized_operations) <> jsonb_array_length(p_operations) THEN
    RAISE EXCEPTION 'Invalid dispatch operations' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO order_row FROM public.orders WHERE id = p_order_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order missing' USING ERRCODE = 'P0002'; END IF;
  IF order_row.status <> 'pending' OR order_row.user_id IS NULL OR order_row.cancelled_at IS NOT NULL
    OR lower(btrim(order_row.payment_method)) <> 'wallet' OR order_row.uid !~ '^[0-9]{5,15}$' THEN
    RAISE EXCEPTION 'Order changed or ineligible' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO package_row FROM public.packages WHERE id = p_package_id FOR SHARE;
  IF NOT FOUND OR package_row.name IS DISTINCT FROM order_row.package_name
    OR package_row.category IS NULL
    OR (SELECT count(*) FROM public.packages WHERE name = order_row.package_name) <> 1 THEN
    RAISE EXCEPTION 'Package changed or unmapped' USING ERRCODE = '55000';
  END IF;

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

  SELECT count(*) INTO evidence_count FROM public.wallet_transactions WHERE reference_id = p_order_id;
  IF evidence_count <> 1 THEN RAISE EXCEPTION 'Ambiguous wallet evidence' USING ERRCODE = '55000'; END IF;
  SELECT * INTO debit FROM public.wallet_transactions WHERE reference_id = p_order_id FOR SHARE;
  IF order_row.amount::text IN ('NaN','Infinity','-Infinity') OR debit.amount::text IN ('NaN','Infinity','-Infinity')
    OR order_row.amount <= 0 OR debit.user_id IS DISTINCT FROM order_row.user_id OR debit.amount IS DISTINCT FROM order_row.amount
    OR debit.type <> 'order_payment' OR debit.direction <> 'debit' THEN
    RAISE EXCEPTION 'Wallet evidence changed or invalid' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.topup_dispatches(order_id,user_id,package_id,payment_evidence_id,mapping_version,
    uid_snapshot,package_name_snapshot,category_snapshot,amount_snapshot,created_by)
  VALUES(order_row.id,order_row.user_id,package_row.id,debit.id,p_mapping_version,
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

CREATE FUNCTION public.claim_topup_dispatch_operation_dry_run(p_worker_id text)
RETURNS TABLE(operation_id uuid, dispatch_id uuid, sequence_no integer, product_code text, quantity integer,
  uid_snapshot text, command_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE claimed public.topup_dispatch_operations%ROWTYPE;
BEGIN
  IF p_worker_id IS NULL OR length(btrim(p_worker_id)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid worker id' USING ERRCODE='22023';
  END IF;
  SELECT o.* INTO claimed FROM public.topup_dispatch_operations o
  JOIN public.topup_dispatches d ON d.id=o.dispatch_id
  WHERE o.status='queued' AND d.status IN ('queued','processing') AND d.dry_run
    AND NOT EXISTS (SELECT 1 FROM public.topup_dispatch_operations earlier
      WHERE earlier.dispatch_id=o.dispatch_id AND earlier.sequence_no<o.sequence_no
        AND earlier.status <> 'dry_run_completed')
  ORDER BY o.created_at,o.sequence_no FOR UPDATE OF o SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT public.topup_dispatch_evidence_is_current(claimed.dispatch_id) THEN
    UPDATE public.topup_dispatch_operations SET status='manual_review',
      failure_reason='Authoritative order, package, or wallet evidence changed before claim.',updated_at=clock_timestamp()
      WHERE id=claimed.id;
    UPDATE public.topup_dispatches SET status='manual_review',
      manual_review_reason='Authoritative order, package, or wallet evidence changed before claim.',updated_at=clock_timestamp()
      WHERE id=claimed.dispatch_id;
    INSERT INTO public.admin_audit_logs(admin_id,action_type,target_id,details,ip_address)
    SELECT d.created_by,'TOPUP_DISPATCH_STALE_EVIDENCE',claimed.dispatch_id::text,
      jsonb_build_object('dry_run',true,'operation_id',claimed.id,'sequence',claimed.sequence_no,'stage','claim')::text,'worker'
    FROM public.topup_dispatches d WHERE d.id=claimed.dispatch_id;
    RETURN;
  END IF;
  UPDATE public.topup_dispatch_operations SET status='processing',attempt_count=attempt_count+1,
    claimed_at=clock_timestamp(),claimed_by=p_worker_id,updated_at=clock_timestamp() WHERE id=claimed.id;
  UPDATE public.topup_dispatches SET status='processing',updated_at=clock_timestamp()
    WHERE id=claimed.dispatch_id AND status='queued';
  INSERT INTO public.admin_audit_logs(admin_id,action_type,target_id,details,ip_address)
  SELECT d.created_by,'TOPUP_DISPATCH_CLAIMED',claimed.dispatch_id::text,
    jsonb_build_object('dry_run',true,'operation_id',claimed.id,'sequence',claimed.sequence_no,'worker_id',p_worker_id)::text,'worker'
  FROM public.topup_dispatches d WHERE d.id=claimed.dispatch_id;
  RETURN QUERY SELECT claimed.id,claimed.dispatch_id,claimed.sequence_no,claimed.product_code,claimed.quantity,
    d.uid_snapshot,claimed.command_hash FROM public.topup_dispatches d WHERE d.id=claimed.dispatch_id;
END;
$$;

CREATE FUNCTION public.start_topup_dispatch_send_intent_dry_run(
  p_operation_id uuid, p_worker_id text, p_send_intent_id uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE op public.topup_dispatch_operations%ROWTYPE; attempted_at timestamptz;
BEGIN
  SELECT * INTO op FROM public.topup_dispatch_operations WHERE id=p_operation_id FOR UPDATE;
  IF NOT FOUND OR op.status <> 'processing' OR op.claimed_by IS DISTINCT FROM p_worker_id
    OR p_send_intent_id IS NULL THEN
    RAISE EXCEPTION 'Operation is not owned by worker' USING ERRCODE='55000';
  END IF;
  IF NOT public.topup_dispatch_evidence_is_current(op.dispatch_id) THEN
    UPDATE public.topup_dispatch_operations SET status='manual_review',
      failure_reason='Authoritative order, package, or wallet evidence changed before send intent.',updated_at=clock_timestamp()
      WHERE id=op.id;
    UPDATE public.topup_dispatches SET status='manual_review',
      manual_review_reason='Authoritative order, package, or wallet evidence changed before send intent.',updated_at=clock_timestamp()
      WHERE id=op.dispatch_id;
    INSERT INTO public.admin_audit_logs(admin_id,action_type,target_id,details,ip_address)
    SELECT d.created_by,'TOPUP_DISPATCH_STALE_EVIDENCE',op.dispatch_id::text,
      jsonb_build_object('dry_run',true,'operation_id',op.id,'sequence',op.sequence_no,'stage','send_intent')::text,'worker'
    FROM public.topup_dispatches d WHERE d.id=op.dispatch_id;
    RETURN NULL;
  END IF;
  attempted_at := clock_timestamp();
  UPDATE public.topup_dispatch_operations SET status='send_intent',send_attempted_at=attempted_at,
    send_intent_id=p_send_intent_id,updated_at=attempted_at WHERE id=op.id;
  UPDATE public.topup_dispatches SET status='send_intent',updated_at=attempted_at WHERE id=op.dispatch_id;
  INSERT INTO public.admin_audit_logs(admin_id,action_type,target_id,details,ip_address)
  SELECT d.created_by,'TOPUP_DISPATCH_SEND_INTENT',op.dispatch_id::text,
    jsonb_build_object('dry_run',true,'operation_id',op.id,'sequence',op.sequence_no,'send_intent_id',p_send_intent_id,'worker_id',p_worker_id)::text,'worker'
  FROM public.topup_dispatches d WHERE d.id=op.dispatch_id;
  RETURN attempted_at;
END;
$$;

CREATE FUNCTION public.recover_topup_dispatch_operation_dry_run(p_operation_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE op public.topup_dispatch_operations%ROWTYPE; actor uuid; recovered text; now_at timestamptz:=clock_timestamp();
BEGIN
  SELECT * INTO op FROM public.topup_dispatch_operations WHERE id=p_operation_id FOR UPDATE;
  IF NOT FOUND OR op.status NOT IN ('processing','send_intent') OR op.claimed_at > now_at - interval '5 minutes' THEN
    RAISE EXCEPTION 'Operation is not stale and recoverable' USING ERRCODE='55000';
  END IF;
  SELECT created_by INTO actor FROM public.topup_dispatches WHERE id=op.dispatch_id FOR UPDATE;
  IF op.status='processing' AND op.send_attempted_at IS NULL AND op.send_intent_id IS NULL THEN
    UPDATE public.topup_dispatch_operations SET status='queued',claimed_at=NULL,claimed_by=NULL,
      attempt_count=attempt_count,updated_at=now_at WHERE id=op.id;
    UPDATE public.topup_dispatches SET status='queued',updated_at=now_at WHERE id=op.dispatch_id;
    recovered:='queued';
  ELSE
    UPDATE public.topup_dispatch_operations SET status='manual_review',
      failure_reason='Stale operation after durable send intent; delivery unknown.',updated_at=now_at WHERE id=op.id;
    UPDATE public.topup_dispatches SET status='manual_review',
      manual_review_reason='Stale operation after durable send intent; delivery unknown.',updated_at=now_at WHERE id=op.dispatch_id;
    recovered:='manual_review';
  END IF;
  INSERT INTO public.admin_audit_logs(admin_id,action_type,target_id,details,ip_address)
  VALUES(actor,'TOPUP_DISPATCH_RECOVERED',op.dispatch_id::text,
    jsonb_build_object('dry_run',true,'operation_id',op.id,'sequence',op.sequence_no,'from_state',op.status,'to_state',recovered)::text,'worker');
  RETURN recovered;
END;
$$;

CREATE FUNCTION public.finish_topup_dispatch_operation_dry_run(
  p_operation_id uuid, p_worker_id text, p_send_intent_id uuid, p_outcome text, p_result_hash text, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE op public.topup_dispatch_operations%ROWTYPE; actor uuid; next_status text;
BEGIN
  SELECT * INTO op FROM public.topup_dispatch_operations WHERE id=p_operation_id FOR UPDATE;
  IF NOT FOUND OR op.status <> 'send_intent' OR op.claimed_by IS DISTINCT FROM p_worker_id
    OR op.send_intent_id IS DISTINCT FROM p_send_intent_id THEN
    RAISE EXCEPTION 'Operation is not owned by worker' USING ERRCODE='55000';
  END IF;
  next_status := CASE p_outcome WHEN 'dry_run_completed' THEN 'dry_run_completed'
    WHEN 'failed' THEN 'failed' WHEN 'uncertain' THEN 'manual_review' ELSE NULL END;
  IF next_status IS NULL OR p_result_hash IS NULL OR p_result_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid dry-run result' USING ERRCODE='22023';
  END IF;
  UPDATE public.topup_dispatch_operations SET status=next_status,
    completed_at=CASE WHEN next_status='dry_run_completed' THEN clock_timestamp() ELSE NULL END,
    failed_at=CASE WHEN next_status='failed' THEN clock_timestamp() ELSE NULL END,
    failure_reason=CASE WHEN next_status IN ('failed','manual_review') THEN left(COALESCE(p_reason,'Unspecified'),500) ELSE NULL END,
    supplier_response_hash=p_result_hash, supplier_response_summary='DRY_RUN', updated_at=clock_timestamp()
  WHERE id=op.id;
  SELECT created_by INTO actor FROM public.topup_dispatches WHERE id=op.dispatch_id;
  IF next_status='manual_review' THEN
    UPDATE public.topup_dispatches SET status='manual_review',manual_review_reason=left(COALESCE(p_reason,'Uncertain delivery'),500),updated_at=clock_timestamp() WHERE id=op.dispatch_id;
  ELSIF next_status='failed' THEN
    UPDATE public.topup_dispatches SET status='failed',failed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=op.dispatch_id;
  ELSIF NOT EXISTS (SELECT 1 FROM public.topup_dispatch_operations WHERE dispatch_id=op.dispatch_id AND id<>op.id AND status<>'dry_run_completed') THEN
    UPDATE public.topup_dispatches SET status='dry_run_completed',completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=op.dispatch_id;
  ELSE
    UPDATE public.topup_dispatches SET status='processing',updated_at=clock_timestamp() WHERE id=op.dispatch_id;
  END IF;
  INSERT INTO public.admin_audit_logs(admin_id,action_type,target_id,details,ip_address)
  VALUES(actor,CASE next_status WHEN 'manual_review' THEN 'TOPUP_DISPATCH_MANUAL_REVIEW' WHEN 'failed' THEN 'TOPUP_DISPATCH_FAILED' ELSE 'TOPUP_DISPATCH_DRY_RUN_COMPLETED' END,
    op.dispatch_id::text,jsonb_build_object('dry_run',true,'operation_id',op.id,'sequence',op.sequence_no,'state',next_status,'result_hash',p_result_hash)::text,'worker');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_topup_dispatch_dry_run(uuid,uuid,uuid,text,jsonb,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_topup_dispatch_operation_dry_run(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_topup_dispatch_send_intent_dry_run(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_topup_dispatch_operation_dry_run(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_topup_dispatch_operation_dry_run(uuid,text,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_topup_dispatch_dry_run(uuid,uuid,uuid,text,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_topup_dispatch_operation_dry_run(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_topup_dispatch_send_intent_dry_run(uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_topup_dispatch_operation_dry_run(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_topup_dispatch_operation_dry_run(uuid,text,uuid,text,text,text) TO service_role;
COMMIT;
