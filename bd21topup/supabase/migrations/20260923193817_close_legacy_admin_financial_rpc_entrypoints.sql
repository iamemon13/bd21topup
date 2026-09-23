-- Apply only after the audited application is deployed.
-- SECURITY DEFINER admin_financial_action retains owner access to these primitives.
REVOKE EXECUTE ON FUNCTION public.admin_adjust_wallet(uuid,numeric,text,text),
 public.admin_review_withdrawal(uuid,text,text),
 public.admin_review_add_money(uuid,text,text),
 public.admin_undo_add_money(uuid,text),
 public.admin_cancel_order(uuid,text),
 public.admin_cancel_order_with_refund(uuid,text)
FROM PUBLIC,anon,authenticated,service_role;
