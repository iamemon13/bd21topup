-- Add an optional dispatch scope to the existing dry-run claim RPC.
-- A NULL scope preserves global worker behavior; a UUID scope can only claim
-- an operation from that exact dispatch and never falls back to global work.

DROP FUNCTION public.claim_topup_dispatch_operation_dry_run(text);

CREATE FUNCTION public.claim_topup_dispatch_operation_dry_run(
  p_worker_id text,
  p_dispatch_id uuid DEFAULT NULL
)
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
    AND (p_dispatch_id IS NULL OR o.dispatch_id=p_dispatch_id)
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

REVOKE ALL ON FUNCTION public.claim_topup_dispatch_operation_dry_run(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_topup_dispatch_operation_dry_run(text,uuid) TO service_role;
