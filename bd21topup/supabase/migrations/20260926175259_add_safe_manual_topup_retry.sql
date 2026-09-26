-- Preserve every durable Telegram send intent and allow an authorized admin to
-- prepare one explicit, scoped retry after the supplier confirms hard failure.
-- This migration does not update orders, profiles, wallet_transactions, or
-- any other financial/source table.
BEGIN;

CREATE TABLE public.topup_dispatch_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES public.topup_dispatch_operations(id) ON DELETE RESTRICT,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  send_intent_id uuid NOT NULL UNIQUE,
  worker_id text NOT NULL CHECK (length(btrim(worker_id)) BETWEEN 1 AND 100),
  send_attempted_at timestamptz NOT NULL,
  outcome_status text NOT NULL CHECK (outcome_status IN ('send_intent','dry_run_completed','failed','manual_review')),
  failure_reason text,
  supplier_message_id text,
  supplier_response_hash text,
  supplier_response_summary text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  UNIQUE (operation_id, attempt_no),
  CHECK ((outcome_status='send_intent' AND finished_at IS NULL)
    OR (outcome_status<>'send_intent' AND finished_at IS NOT NULL))
);

CREATE INDEX topup_dispatch_attempts_operation_idx
  ON public.topup_dispatch_attempts(operation_id, attempt_no);
ALTER TABLE public.topup_dispatch_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.topup_dispatch_attempts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.topup_dispatch_attempts TO service_role;

INSERT INTO public.topup_dispatch_attempts(operation_id,attempt_no,send_intent_id,worker_id,
  send_attempted_at,outcome_status,failure_reason,supplier_message_id,supplier_response_hash,supplier_response_summary,created_at,finished_at)
SELECT id,GREATEST(attempt_count,1),send_intent_id,claimed_by,send_attempted_at,status,
  failure_reason,supplier_message_id,supplier_response_hash,supplier_response_summary,send_attempted_at,
  CASE WHEN status='send_intent' THEN NULL ELSE updated_at END
FROM public.topup_dispatch_operations
WHERE send_intent_id IS NOT NULL;

CREATE FUNCTION public.protect_topup_dispatch_attempt_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
    OR NEW.attempt_no IS DISTINCT FROM OLD.attempt_no
    OR NEW.send_intent_id IS DISTINCT FROM OLD.send_intent_id
    OR NEW.worker_id IS DISTINCT FROM OLD.worker_id
    OR NEW.send_attempted_at IS DISTINCT FROM OLD.send_attempted_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Topup dispatch attempt identity is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_topup_dispatch_attempt_identity
BEFORE UPDATE OR DELETE ON public.topup_dispatch_attempts
FOR EACH ROW EXECUTE FUNCTION public.protect_topup_dispatch_attempt_identity();

CREATE OR REPLACE FUNCTION public.start_topup_dispatch_send_intent_dry_run(
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
  INSERT INTO public.topup_dispatch_attempts(operation_id,attempt_no,send_intent_id,worker_id,
    send_attempted_at,outcome_status)
  VALUES(op.id,op.attempt_count,p_send_intent_id,p_worker_id,attempted_at,'send_intent');
  UPDATE public.topup_dispatch_operations SET status='send_intent',send_attempted_at=attempted_at,
    send_intent_id=p_send_intent_id,updated_at=attempted_at WHERE id=op.id;
  UPDATE public.topup_dispatches SET status='send_intent',updated_at=attempted_at WHERE id=op.dispatch_id;
  INSERT INTO public.admin_audit_logs(admin_id,action_type,target_id,details,ip_address)
  SELECT d.created_by,'TOPUP_DISPATCH_SEND_INTENT',op.dispatch_id::text,
    jsonb_build_object('dry_run',true,'operation_id',op.id,'sequence',op.sequence_no,'attempt_no',op.attempt_count,
      'send_intent_id',p_send_intent_id,'worker_id',p_worker_id)::text,'worker'
  FROM public.topup_dispatches d WHERE d.id=op.dispatch_id;
  RETURN attempted_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_topup_dispatch_operation_dry_run(
  p_operation_id uuid, p_worker_id text, p_send_intent_id uuid, p_outcome text, p_result_hash text, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE op public.topup_dispatch_operations%ROWTYPE; actor uuid; next_status text; finished_at_value timestamptz:=clock_timestamp();
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
  UPDATE public.topup_dispatch_attempts SET outcome_status=next_status,
    failure_reason=CASE WHEN next_status IN ('failed','manual_review') THEN left(COALESCE(p_reason,'Unspecified'),500) ELSE NULL END,
    supplier_message_id=op.supplier_message_id,supplier_response_hash=p_result_hash,
    supplier_response_summary='DRY_RUN',finished_at=finished_at_value
  WHERE operation_id=op.id AND send_intent_id=p_send_intent_id AND outcome_status='send_intent';
  IF NOT FOUND THEN RAISE EXCEPTION 'Durable send intent history is missing' USING ERRCODE='55000'; END IF;
  UPDATE public.topup_dispatch_operations SET status=next_status,
    completed_at=CASE WHEN next_status='dry_run_completed' THEN finished_at_value ELSE NULL END,
    failed_at=CASE WHEN next_status='failed' THEN finished_at_value ELSE NULL END,
    failure_reason=CASE WHEN next_status IN ('failed','manual_review') THEN left(COALESCE(p_reason,'Unspecified'),500) ELSE NULL END,
    supplier_response_hash=p_result_hash,supplier_response_summary='DRY_RUN',updated_at=finished_at_value
  WHERE id=op.id;
  SELECT created_by INTO actor FROM public.topup_dispatches WHERE id=op.dispatch_id;
  IF next_status='manual_review' THEN
    UPDATE public.topup_dispatches SET status='manual_review',manual_review_reason=left(COALESCE(p_reason,'Uncertain delivery'),500),updated_at=finished_at_value WHERE id=op.dispatch_id;
  ELSIF next_status='failed' THEN
    UPDATE public.topup_dispatches SET status='failed',failed_at=finished_at_value,updated_at=finished_at_value WHERE id=op.dispatch_id;
  ELSIF NOT EXISTS (SELECT 1 FROM public.topup_dispatch_operations WHERE dispatch_id=op.dispatch_id AND id<>op.id AND status<>'dry_run_completed') THEN
    UPDATE public.topup_dispatches SET status='dry_run_completed',completed_at=finished_at_value,updated_at=finished_at_value WHERE id=op.dispatch_id;
  ELSE
    UPDATE public.topup_dispatches SET status='processing',updated_at=finished_at_value WHERE id=op.dispatch_id;
  END IF;
  INSERT INTO public.admin_audit_logs(admin_id,action_type,target_id,details,ip_address)
  VALUES(actor,CASE next_status WHEN 'manual_review' THEN 'TOPUP_DISPATCH_MANUAL_REVIEW' WHEN 'failed' THEN 'TOPUP_DISPATCH_FAILED' ELSE 'TOPUP_DISPATCH_DRY_RUN_COMPLETED' END,
    op.dispatch_id::text,jsonb_build_object('dry_run',true,'operation_id',op.id,'sequence',op.sequence_no,
      'attempt_no',op.attempt_count,'send_intent_id',p_send_intent_id,'state',next_status,'result_hash',p_result_hash)::text,'worker');
END;
$$;

CREATE FUNCTION public.admin_prepare_topup_dispatch_retry(
  p_admin_id uuid,
  p_dispatch_id uuid,
  p_retry_reason text,
  p_confirmed_failure_reason text,
  p_supplier_failure_confirmed boolean,
  p_ip text DEFAULT 'unknown'
)
RETURNS TABLE(operation_id uuid, previous_send_intent_id uuid, next_attempt_no integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_role text;
  actor_permissions text[];
  dispatch_row public.topup_dispatches%ROWTYPE;
  operation_row public.topup_dispatch_operations%ROWTYPE;
  manual_review_count integer;
  order_status text;
  order_cancelled_at timestamptz;
BEGIN
  SELECT role,permissions INTO actor_role,actor_permissions
  FROM public.admin_roles WHERE user_id=p_admin_id FOR SHARE;
  IF actor_role IS NULL OR actor_role NOT IN ('super_admin','admin','editor')
    OR (actor_role<>'super_admin' AND NOT ('manage_orders'=ANY(COALESCE(actor_permissions,'{}'::text[])))) THEN
    RAISE EXCEPTION 'Dispatch retry permission denied' USING ERRCODE='42501';
  END IF;
  IF p_dispatch_id IS NULL OR p_supplier_failure_confirmed IS DISTINCT FROM true
    OR length(btrim(COALESCE(p_retry_reason,''))) NOT BETWEEN 10 AND 500
    OR length(btrim(COALESCE(p_confirmed_failure_reason,''))) NOT BETWEEN 3 AND 500
    OR length(COALESCE(p_ip,'')) > 100 THEN
    RAISE EXCEPTION 'Explicit supplier failure confirmation and retry reason are required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO dispatch_row FROM public.topup_dispatches WHERE id=p_dispatch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dispatch missing' USING ERRCODE='P0002'; END IF;
  SELECT status,cancelled_at INTO order_status,order_cancelled_at
  FROM public.orders WHERE id=dispatch_row.order_id FOR SHARE;
  PERFORM 1 FROM public.topup_dispatch_operations WHERE dispatch_id=p_dispatch_id ORDER BY sequence_no FOR UPDATE;
  SELECT count(*) INTO manual_review_count FROM public.topup_dispatch_operations
  WHERE dispatch_id=p_dispatch_id AND status='manual_review';
  SELECT * INTO operation_row FROM public.topup_dispatch_operations
  WHERE dispatch_id=p_dispatch_id AND status='manual_review' ORDER BY sequence_no LIMIT 1;

  IF order_status IS DISTINCT FROM 'pending' OR order_cancelled_at IS NOT NULL
    OR dispatch_row.status IS DISTINCT FROM 'manual_review'
    OR manual_review_count <> 1 OR operation_row.id IS NULL OR operation_row.send_intent_id IS NULL
    OR operation_row.send_attempted_at IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.topup_dispatch_attempts a
      WHERE a.operation_id=operation_row.id AND a.send_intent_id=operation_row.send_intent_id
        AND a.outcome_status='manual_review') THEN
    RAISE EXCEPTION 'Dispatch is not eligible for retry' USING ERRCODE='55000';
  END IF;

  UPDATE public.topup_dispatch_operations SET status='queued',claimed_at=NULL,claimed_by=NULL,
    send_attempted_at=NULL,send_intent_id=NULL,completed_at=NULL,failed_at=NULL,
    supplier_message_id=NULL,supplier_response_hash=NULL,supplier_response_summary=NULL,
    failure_reason=NULL,updated_at=clock_timestamp()
  WHERE id=operation_row.id;
  UPDATE public.topup_dispatches SET status='queued',manual_review_reason=NULL,
    failed_at=NULL,completed_at=NULL,updated_at=clock_timestamp()
  WHERE id=dispatch_row.id;
  INSERT INTO public.admin_audit_logs(admin_id,action_type,target_id,details,ip_address)
  VALUES(p_admin_id,'TOPUP_DISPATCH_RETRY_PREPARED',dispatch_row.id::text,
    jsonb_build_object('dry_run',true,'operation_id',operation_row.id,'sequence',operation_row.sequence_no,
      'previous_send_intent_id',operation_row.send_intent_id,'next_attempt_no',operation_row.attempt_count+1,
      'retry_reason',btrim(p_retry_reason),'confirmed_supplier_failure_reason',btrim(p_confirmed_failure_reason))::text,
    COALESCE(p_ip,'unknown'));
  RETURN QUERY SELECT operation_row.id,operation_row.send_intent_id,operation_row.attempt_count+1;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_topup_dispatch_attempt_identity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_prepare_topup_dispatch_retry(uuid,uuid,text,text,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_prepare_topup_dispatch_retry(uuid,uuid,text,text,boolean,text) TO service_role;

COMMIT;
