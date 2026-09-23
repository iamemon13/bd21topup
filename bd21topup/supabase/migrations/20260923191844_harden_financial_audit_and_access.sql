-- Atomic audit wrapper; deploy application callers before revoking legacy RPC execution.
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.admin_audit_logs FROM service_role;
GRANT SELECT, INSERT ON public.admin_audit_logs TO service_role;

CREATE INDEX admin_audit_logs_admin_id_idx ON public.admin_audit_logs(admin_id);
CREATE INDEX notifications_user_id_idx ON public.notifications(user_id);
CREATE INDEX orders_user_id_idx ON public.orders(user_id);
CREATE INDEX withdrawals_user_id_idx ON public.withdrawals(user_id);
ALTER POLICY "Users can view their own profile" ON public.profiles USING (id = (SELECT auth.uid()));
ALTER POLICY "Users can view their own withdrawals" ON public.withdrawals USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.admin_financial_action(
 p_admin_id uuid, p_operation text, p_target_id uuid,
 p_action text DEFAULT NULL, p_amount numeric DEFAULT NULL,
 p_note text DEFAULT NULL, p_ip text DEFAULT 'unknown', p_bulk boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public
AS $fn$
DECLARE
 required_permission text; actor_role text; actor_permissions text[];
 result jsonb; audit_action text; w public.withdrawals%ROWTYPE;
BEGIN
 required_permission := CASE p_operation
   WHEN 'wallet' THEN 'manage_users' WHEN 'withdrawal' THEN 'manage_withdrawals'
   WHEN 'cancel_order' THEN 'manage_orders'
   WHEN 'add_money' THEN 'manage_add_money' WHEN 'undo_add_money' THEN 'manage_add_money'
   ELSE NULL END;
 IF required_permission IS NULL OR p_admin_id IS NULL OR p_target_id IS NULL THEN
   RAISE EXCEPTION 'Invalid financial operation';
 END IF;
 SELECT role, permissions INTO actor_role, actor_permissions
 FROM public.admin_roles WHERE user_id = p_admin_id FOR SHARE;
 IF NOT FOUND OR actor_role NOT IN ('super_admin','admin','editor')
    OR (actor_role <> 'super_admin' AND NOT (required_permission = ANY(coalesce(actor_permissions,'{}'::text[])))) THEN
   RAISE EXCEPTION 'Financial permission denied' USING ERRCODE='42501';
 END IF;
 IF length(coalesce(p_note,'')) > 500 OR length(coalesce(p_ip,'')) > 100 THEN
   RAISE EXCEPTION 'Invalid audit metadata';
 END IF;

 CASE p_operation
 WHEN 'wallet' THEN
   IF p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity')
      OR p_amount <= 0 OR p_amount <> round(p_amount,2)
      OR p_action IS NULL OR p_action NOT IN ('add','remove') THEN
     RAISE EXCEPTION 'Invalid wallet adjustment';
   END IF;
   result := public.admin_adjust_wallet(p_target_id,p_amount,p_action,p_note);
   audit_action := CASE p_action WHEN 'add' THEN 'ADD_MONEY_TO_WALLET' ELSE 'REMOVE_MONEY_FROM_WALLET' END;
 WHEN 'withdrawal' THEN
   SELECT * INTO w FROM public.withdrawals WHERE id=p_target_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal request not found'; END IF;
   IF w.status <> 'pending' THEN RAISE EXCEPTION 'Withdrawal request already reviewed'; END IF;
   IF NOT EXISTS (SELECT 1 FROM public.wallet_transactions WHERE reference_id=w.id
       AND user_id=w.user_id AND type='withdrawal' AND direction='debit' AND amount=w.amount)
      OR EXISTS (SELECT 1 FROM public.wallet_transactions WHERE reference_id=w.id AND type='withdrawal_reversal') THEN
     RAISE EXCEPTION 'Original withdrawal debit not verified';
   END IF;
   result := public.admin_review_withdrawal(p_target_id,p_action,p_note);
   audit_action := CASE p_action WHEN 'approved' THEN 'APPROVE_WITHDRAWAL' ELSE 'REJECT_WITHDRAWAL' END;
 WHEN 'cancel_order' THEN
   result := public.admin_cancel_order(p_target_id,p_note);
   audit_action := 'CANCEL_ORDER';
 WHEN 'add_money' THEN
   IF p_action IS NULL OR p_action NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid action'; END IF;
   result := public.admin_review_add_money(p_target_id,p_action,p_note);
   audit_action := CASE p_action WHEN 'approved' THEN 'APPROVE_ADD_MONEY' ELSE 'REJECT_ADD_MONEY' END;
 WHEN 'undo_add_money' THEN
   result := public.admin_undo_add_money(p_target_id,p_note);
   audit_action := 'UNDO_ADD_MONEY';
 END CASE;
 IF result IS NULL OR result->>'success' IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'Financial operation failed';
 END IF;
 INSERT INTO public.admin_audit_logs(admin_id,action_type,target_id,details,ip_address)
 VALUES(p_admin_id,CASE WHEN p_bulk THEN 'BULK_' ELSE '' END || audit_action,p_target_id::text,
   jsonb_build_object('operation',p_operation,'action',p_action,'amount',p_amount,
     'note',p_note,'result',result,'bulk_operation',p_bulk)::text,coalesce(p_ip,'unknown'));
 RETURN result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_financial_action(uuid,text,uuid,text,numeric,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_financial_action(uuid,text,uuid,text,numeric,text,text,boolean) TO service_role;
