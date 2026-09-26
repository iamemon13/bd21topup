-- Simplify reply-body success evidence while retaining exact attempt linkage,
-- locked-row completion, idempotency, and financial isolation.
BEGIN;

ALTER TABLE public.topup_supplier_responses
  DROP CONSTRAINT topup_supplier_responses_check;
ALTER TABLE public.topup_supplier_responses
  ADD CONSTRAINT topup_supplier_responses_verified_link_check
  CHECK (classification <> 'verified_success' OR reply_to_message_id=sent_message_id);

CREATE OR REPLACE FUNCTION public.complete_topup_dispatch_from_supplier_reply(
  p_operation_id uuid, p_worker_id text, p_send_intent_id uuid,
  p_supplier_entity_id text, p_sent_message_id text, p_reply_message_id text,
  p_reply_to_message_id text, p_supplier_order_id text, p_supplier_reference text,
  p_uid text, p_product_code text, p_quantity integer,
  p_response_hash text, p_response_summary text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  op public.topup_dispatch_operations%ROWTYPE;
  dispatch_row public.topup_dispatches%ROWTYPE;
  attempt_row public.topup_dispatch_attempts%ROWTYPE;
  finished_at_value timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    COALESCE(p_supplier_entity_id,'') || ':' || COALESCE(p_reply_message_id,''), 0));
  IF EXISTS (SELECT 1 FROM public.topup_supplier_responses
    WHERE supplier_entity_id=p_supplier_entity_id AND reply_message_id=p_reply_message_id) THEN
    RETURN false;
  END IF;
  SELECT * INTO op FROM public.topup_dispatch_operations WHERE id=p_operation_id FOR UPDATE;
  IF NOT FOUND OR op.status<>'send_intent' OR op.claimed_by IS DISTINCT FROM p_worker_id
    OR op.send_intent_id IS DISTINCT FROM p_send_intent_id THEN
    RAISE EXCEPTION 'Operation is not owned by worker' USING ERRCODE='55000';
  END IF;
  SELECT * INTO attempt_row FROM public.topup_dispatch_attempts
    WHERE operation_id=op.id AND send_intent_id=p_send_intent_id FOR UPDATE;
  SELECT * INTO dispatch_row FROM public.topup_dispatches WHERE id=op.dispatch_id FOR UPDATE;
  PERFORM 1 FROM public.orders WHERE id=dispatch_row.order_id AND status='pending' FOR UPDATE;
  IF NOT FOUND OR attempt_row.id IS NULL OR attempt_row.outcome_status<>'send_intent'
    OR p_reply_to_message_id IS DISTINCT FROM p_sent_message_id
    OR p_uid IS DISTINCT FROM dispatch_row.uid_snapshot
    OR p_product_code IS DISTINCT FROM op.product_code OR p_quantity IS DISTINCT FROM op.quantity
    OR p_supplier_entity_id !~ '^-?[1-9][0-9]*$' OR p_sent_message_id !~ '^[1-9][0-9]*$'
    OR p_reply_message_id !~ '^[1-9][0-9]*$' OR p_response_hash !~ '^[0-9a-f]{64}$'
    OR length(btrim(COALESCE(p_response_summary,''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Supplier reply is not eligible for completion' USING ERRCODE='55000';
  END IF;
  INSERT INTO public.topup_supplier_responses(attempt_id,supplier_entity_id,sent_message_id,
    reply_message_id,reply_to_message_id,supplier_order_id,supplier_reference,response_hash,response_summary,classification)
  VALUES(attempt_row.id,p_supplier_entity_id,p_sent_message_id,p_reply_message_id,p_reply_to_message_id,
    NULLIF(btrim(p_supplier_order_id),''),NULLIF(btrim(p_supplier_reference),''),
    p_response_hash,btrim(p_response_summary),'verified_success');
  UPDATE public.topup_dispatch_attempts SET outcome_status='dry_run_completed',supplier_message_id=p_reply_message_id,
    supplier_response_hash=p_response_hash,supplier_response_summary=left(btrim(p_response_summary),500),finished_at=finished_at_value
    WHERE id=attempt_row.id;
  UPDATE public.topup_dispatch_operations SET status='dry_run_completed',completed_at=finished_at_value,
    supplier_response_hash=p_response_hash,supplier_response_summary=left(btrim(p_response_summary),500),updated_at=finished_at_value
    WHERE id=op.id;
  IF NOT EXISTS (SELECT 1 FROM public.topup_dispatch_operations
    WHERE dispatch_id=op.dispatch_id AND id<>op.id AND status<>'dry_run_completed') THEN
    UPDATE public.orders SET status='completed' WHERE id=dispatch_row.order_id AND status='pending';
    IF NOT FOUND THEN RAISE EXCEPTION 'Matched order is no longer pending' USING ERRCODE='55000'; END IF;
    UPDATE public.topup_dispatches SET status='dry_run_completed',completed_at=finished_at_value,
      manual_review_reason=NULL,updated_at=finished_at_value WHERE id=op.dispatch_id;
  ELSE
    UPDATE public.topup_dispatches SET status='processing',updated_at=finished_at_value WHERE id=op.dispatch_id;
  END IF;
  INSERT INTO public.admin_audit_logs(admin_id,action_type,target_id,details,ip_address)
  VALUES(dispatch_row.created_by,'TOPUP_DISPATCH_SUPPLIER_CONFIRMED',op.dispatch_id::text,
    jsonb_build_object('operation_id',op.id,'attempt_id',attempt_row.id,'send_intent_id',p_send_intent_id,
      'sent_message_id',p_sent_message_id,'reply_message_id',p_reply_message_id,
      'response_hash',p_response_hash)::text,'worker');
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_topup_dispatch_from_supplier_reply(uuid,text,uuid,text,text,text,text,text,text,text,text,integer,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_topup_dispatch_from_supplier_reply(uuid,text,uuid,text,text,text,text,text,text,text,text,integer,text,text)
  TO service_role;

COMMIT;
