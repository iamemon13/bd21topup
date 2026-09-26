BEGIN;

CREATE FUNCTION public.preflight_topup_dispatch_dry_run(p_dispatch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  dispatch_row public.topup_dispatches%ROWTYPE;
  operations jsonb;
BEGIN
  IF p_dispatch_id IS NULL THEN
    RAISE EXCEPTION 'Dispatch ID is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO dispatch_row
  FROM public.topup_dispatches
  WHERE id = p_dispatch_id
    AND status = 'queued'
    AND dry_run IS TRUE;

  IF NOT FOUND OR NOT public.topup_dispatch_evidence_is_current(p_dispatch_id) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', operation.id,
      'sequence_no', operation.sequence_no,
      'product_code', operation.product_code,
      'quantity', operation.quantity,
      'command_hash', operation.command_hash,
      'status', operation.status
    ) ORDER BY operation.sequence_no
  ) INTO operations
  FROM public.topup_dispatch_operations operation
  WHERE operation.dispatch_id = p_dispatch_id;

  IF operations IS NULL OR EXISTS (
    SELECT 1
    FROM public.topup_dispatch_operations operation
    WHERE operation.dispatch_id = p_dispatch_id
      AND operation.status <> 'queued'
  ) THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'dispatch', jsonb_build_object(
      'id', dispatch_row.id,
      'status', dispatch_row.status,
      'dry_run', dispatch_row.dry_run,
      'uid_snapshot', dispatch_row.uid_snapshot
    ),
    'operations', operations
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preflight_topup_dispatch_dry_run(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preflight_topup_dispatch_dry_run(uuid)
  TO service_role;

COMMIT;
