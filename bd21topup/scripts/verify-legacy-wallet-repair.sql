-- Read-only preflight/postflight. Run as a single transaction.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH targets AS (
 SELECT * FROM jsonb_to_recordset('[{"id":"cd414bb2-9772-4d41-9f07-0a7ac299c46d","user_id":"b5ffb675-4a9a-4bc6-8161-17eae9ddabfd","amount":158,"created_at":"2026-09-18 05:17:18.853448+00","balance_after":1842},{"id":"4f4e29b6-d7e7-4d9d-bc54-19e902bfad19","user_id":"b5ffb675-4a9a-4bc6-8161-17eae9ddabfd","amount":84,"created_at":"2026-09-18 05:47:34.110729+00","balance_after":1758},{"id":"16db2c94-1d7e-44f2-bcd4-11ef3ebeabc1","user_id":"b5ffb675-4a9a-4bc6-8161-17eae9ddabfd","amount":105,"created_at":"2026-09-18 05:47:50.860296+00","balance_after":1653},{"id":"8ca251bc-cbc6-4d6e-9ced-2bea63f5566c","user_id":"b5ffb675-4a9a-4bc6-8161-17eae9ddabfd","amount":130,"created_at":"2026-09-18 05:48:07.633871+00","balance_after":1523},{"id":"3e105037-6c3f-49eb-a7e3-9268d82b4806","user_id":"b5ffb675-4a9a-4bc6-8161-17eae9ddabfd","amount":316,"created_at":"2026-09-18 08:43:26.664097+00","balance_after":1207},{"id":"8f4589ff-45ef-467d-9f38-6a9142d2e757","user_id":"b5ffb675-4a9a-4bc6-8161-17eae9ddabfd","amount":316,"created_at":"2026-09-18 08:43:27.437366+00","balance_after":891},{"id":"4935d2f2-b333-4f2a-b9d3-bc6361b81359","user_id":"c72627d1-e00a-49f2-bd3f-ab4aad852b0a","amount":400,"created_at":"2026-09-18 10:18:50.344382+00","balance_after":610}]'::jsonb)
 AS x(id uuid,user_id uuid,amount numeric,created_at timestamptz,balance_after numeric)
), detail AS (
 SELECT x.id,x.user_id,x.amount,x.balance_after reconstructed_balance,
 o.id IS NOT NULL AND o.user_id=x.user_id AND o.amount=x.amount
 AND o.created_at=x.created_at AND o.payment_method='wallet'
 AND o.status='completed' AND o.cancelled_at IS NULL AS order_matches,
 (SELECT count(*) FROM public.wallet_transactions t WHERE t.reference_id=x.id) linked_rows,
 (SELECT count(*) FROM public.wallet_transactions t WHERE t.reference_id=x.id
 AND t.user_id=x.user_id AND t.type='order_payment' AND t.direction='debit'
 AND t.amount=x.amount AND t.balance_after=x.balance_after AND t.created_at=x.created_at
 AND t.description='Legacy history repair 20260923185848: already deducted; balance_after reconstructed; created_at from order; wallet unchanged') exact_repair_rows
 FROM targets x LEFT JOIN public.orders o ON o.id=x.id
)
SELECT jsonb_build_object(
 'checked_at',now(),
 'target_count',(SELECT count(*) FROM detail),
 'target_amount',(SELECT sum(amount) FROM detail),
 'orders_match',(SELECT bool_and(order_matches) FROM detail),
 'preflight_targets_empty',(SELECT bool_and(linked_rows=0) FROM detail),
 'postflight_targets_exact',(SELECT bool_and(linked_rows=1 AND exact_repair_rows=1) FROM detail),
 'target_details',(SELECT jsonb_agg(d ORDER BY id) FROM detail d),
 'profiles',(SELECT jsonb_agg(jsonb_build_object('id',id,'balance',wallet_balance) ORDER BY id) FROM public.profiles WHERE id IN (SELECT user_id FROM targets)),
 'expected_profiles_match',(SELECT count(*)=2 FROM public.profiles WHERE
 (id='b5ffb675-4a9a-4bc6-8161-17eae9ddabfd' AND wallet_balance=891) OR
 (id='c72627d1-e00a-49f2-bd3f-ab4aad852b0a' AND wallet_balance=610)),
 'affected_user_ledger_count',(SELECT count(*) FROM public.wallet_transactions WHERE user_id IN (SELECT user_id FROM targets)),
 'affected_user_withdrawal_count',(SELECT count(*) FROM public.withdrawals WHERE user_id IN (SELECT user_id FROM targets)),
 'global_missing_wallet_debits',(SELECT count(*) FROM public.orders o WHERE lower(trim(payment_method))='wallet'
 AND NOT EXISTS(SELECT 1 FROM public.wallet_transactions t WHERE t.reference_id=o.id AND t.type='order_payment' AND t.direction='debit'))
);
COMMIT;
