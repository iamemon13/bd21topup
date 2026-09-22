BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
REVOKE ALL ON SCHEMA private FROM authenticated;

CREATE TABLE private.external_payment_claims (
  payment_method text NOT NULL,
  transaction_id_normalized text NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT external_payment_claims_pkey
    PRIMARY KEY (payment_method, transaction_id_normalized),

  CONSTRAINT external_payment_claims_source_key
    UNIQUE (source_type, source_id),

  CONSTRAINT external_payment_claims_method_check
    CHECK (
      payment_method IN ('bkash', 'nagad', 'rocket', 'upay')
    ),

  CONSTRAINT external_payment_claims_source_type_check
    CHECK (
      source_type IN ('order', 'add_money')
    )
);

REVOKE ALL
ON TABLE private.external_payment_claims
FROM PUBLIC, anon, authenticated;

INSERT INTO private.external_payment_claims (
  payment_method,
  transaction_id_normalized,
  source_type,
  source_id,
  created_at
)
SELECT
  lower(trim(payment_method)),
  lower(trim(transaction_id)),
  'order',
  id,
  created_at
FROM public.orders
WHERE lower(trim(payment_method)) IN (
  'bkash',
  'nagad',
  'rocket',
  'upay'
);

INSERT INTO private.external_payment_claims (
  payment_method,
  transaction_id_normalized,
  source_type,
  source_id,
  created_at
)
SELECT
  lower(trim(payment_method)),
  lower(trim(transaction_id)),
  'add_money',
  id,
  created_at
FROM public.add_money_requests
WHERE lower(trim(payment_method)) IN (
  'bkash',
  'nagad',
  'rocket',
  'upay'
);

-- Legacy rows with short TrxIDs are preserved.
-- New/future claims must satisfy this rule.
ALTER TABLE private.external_payment_claims
  ADD CONSTRAINT external_payment_claims_transaction_id_check
  CHECK (
    length(transaction_id_normalized) BETWEEN 4 AND 80
  )
  NOT VALID;

CREATE OR REPLACE FUNCTION private.sync_external_payment_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_source_type text;
  v_old_method text;
  v_old_transaction_id text;
  v_new_method text;
  v_new_transaction_id text;
  v_old_is_external boolean := false;
  v_new_is_external boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    v_source_type := 'order';
  ELSIF TG_TABLE_NAME = 'add_money_requests' THEN
    v_source_type := 'add_money';
  ELSE
    RAISE EXCEPTION
      'Unsupported payment claim source table: %',
      TG_TABLE_NAME;
  END IF;

  IF TG_OP = 'DELETE' THEN
    DELETE FROM private.external_payment_claims
    WHERE source_type = v_source_type
      AND source_id = OLD.id;

    RETURN OLD;
  END IF;

  v_new_method := lower(trim(NEW.payment_method));
  v_new_transaction_id := lower(trim(NEW.transaction_id));

  v_new_is_external :=
    v_new_method IN ('bkash', 'nagad', 'rocket', 'upay');

  IF TG_OP = 'UPDATE' THEN
    v_old_method := lower(trim(OLD.payment_method));
    v_old_transaction_id := lower(trim(OLD.transaction_id));

    v_old_is_external :=
      v_old_method IN ('bkash', 'nagad', 'rocket', 'upay');

    IF v_old_is_external
       AND (
         NOT v_new_is_external
         OR v_old_method IS DISTINCT FROM v_new_method
         OR v_old_transaction_id IS DISTINCT FROM v_new_transaction_id
       )
    THEN
      DELETE FROM private.external_payment_claims
      WHERE source_type = v_source_type
        AND source_id = OLD.id;
    END IF;

    IF v_old_is_external
       AND v_new_is_external
       AND v_old_method IS NOT DISTINCT FROM v_new_method
       AND v_old_transaction_id IS NOT DISTINCT FROM v_new_transaction_id
    THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_new_is_external THEN
    INSERT INTO private.external_payment_claims (
      payment_method,
      transaction_id_normalized,
      source_type,
      source_id
    )
    VALUES (
      v_new_method,
      v_new_transaction_id,
      v_source_type,
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL
ON FUNCTION private.sync_external_payment_claim()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_external_payment_claim_orders
ON public.orders;

CREATE TRIGGER sync_external_payment_claim_orders
BEFORE INSERT OR UPDATE OR DELETE
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION private.sync_external_payment_claim();

DROP TRIGGER IF EXISTS sync_external_payment_claim_add_money
ON public.add_money_requests;

CREATE TRIGGER sync_external_payment_claim_add_money
BEFORE INSERT OR UPDATE OR DELETE
ON public.add_money_requests
FOR EACH ROW
EXECUTE FUNCTION private.sync_external_payment_claim();

COMMIT;
