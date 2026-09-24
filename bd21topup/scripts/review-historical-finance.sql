-- Read-only evidence. Never infer current-balance corrections from gaps alone.
with candidates as (
 select 'order' kind,o.id,o.user_id,o.amount,o.status,o.created_at,o.payment_method,null::numeric balance_after from public.orders o where o.payment_method='wallet' and not exists(select 1 from public.wallet_transactions w where w.reference_id=o.id and w.type='order_payment' and w.direction='debit')
 union all select 'withdrawal',d.id,d.user_id,d.amount,d.status,d.created_at,null,d.balance_after from public.withdrawals d where not exists(select 1 from public.wallet_transactions w where w.reference_id=d.id and w.type='withdrawal' and w.direction='debit')
 union all select 'completed_refund',o.id,o.user_id,o.amount,o.status,o.created_at,o.payment_method,null from public.orders o where o.id in ('7615e799-bb1a-44b5-b860-7aab0e100ff1','7e5234c3-46dc-43e7-867e-f9534630a4dd','e9c405ea-2b33-4565-b14e-086413306150')
)
select c.*,
(select wallet_balance from public.profiles p where p.id=c.user_id) current_balance,
(select jsonb_agg(jsonb_build_object('type',w.type,'direction',w.direction,'amount',w.amount,'balance_after',w.balance_after,'created_at',w.created_at)) from public.wallet_transactions w where w.reference_id=c.id) linked_ledger,
(select jsonb_agg(x) from (select w.id,w.type,w.direction,w.amount,w.balance_after,w.created_at from public.wallet_transactions w where w.user_id=c.user_id and w.created_at<=c.created_at order by w.created_at desc,w.id limit 2)x) prior_ledger,
(select jsonb_agg(x) from (select w.id,w.type,w.direction,w.amount,w.balance_after,w.created_at from public.wallet_transactions w where w.user_id=c.user_id and w.created_at>c.created_at order by w.created_at,w.id limit 2)x) subsequent_ledger,
(select count(*) from public.admin_audit_logs a where a.target_id=c.id::text or a.details like '%'||c.id::text||'%') matching_audit_count,
(select count(*) from public.support_cases s where s.order_id=c.id or s.withdrawal_id=c.id) support_case_count,
(select jsonb_agg(x) from (select a.amount,a.status,a.created_at,a.reviewed_at from public.add_money_requests a where a.user_id=c.user_id and a.created_at between c.created_at-interval '1 day' and c.created_at+interval '1 day' order by a.created_at)x) nearby_add_money,
(select jsonb_agg(x) from (select d.id,d.amount,d.status,d.created_at,d.balance_after from public.withdrawals d where d.user_id=c.user_id and d.created_at between c.created_at-interval '1 day' and c.created_at+interval '1 day' order by d.created_at)x) nearby_withdrawals
from candidates c order by kind,created_at,id;
