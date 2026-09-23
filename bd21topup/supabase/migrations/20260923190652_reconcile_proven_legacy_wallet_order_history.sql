-- PREPARED ONLY: production application requires separate approval.
-- History repair, not a wallet charge. See docs/LEGACY_WALLET_REPAIR.md.
-- created_at uses order time; balance_after is reconstructed, not an original observation.
-- Safely guarded one-shot: any existing linked row (including a prior run) aborts.
DO $repair$
DECLARE
  targets constant jsonb := '[{"id":"cd414bb2-9772-4d41-9f07-0a7ac299c46d","user_id":"b5ffb675-4a9a-4bc6-8161-17eae9ddabfd","amount":158,"created_at":"2026-09-18 05:17:18.853448+00","balance_after":1842},{"id":"4f4e29b6-d7e7-4d9d-bc54-19e902bfad19","user_id":"b5ffb675-4a9a-4bc6-8161-17eae9ddabfd","amount":84,"created_at":"2026-09-18 05:47:34.110729+00","balance_after":1758},{"id":"16db2c94-1d7e-44f2-bcd4-11ef3ebeabc1","user_id":"b5ffb675-4a9a-4bc6-8161-17eae9ddabfd","amount":105,"created_at":"2026-09-18 05:47:50.860296+00","balance_after":1653},{"id":"8ca251bc-cbc6-4d6e-9ced-2bea63f5566c","user_id":"b5ffb675-4a9a-4bc6-8161-17eae9ddabfd","amount":130,"created_at":"2026-09-18 05:48:07.633871+00","balance_after":1523},{"id":"3e105037-6c3f-49eb-a7e3-9268d82b4806","user_id":"b5ffb675-4a9a-4bc6-8161-17eae9ddabfd","amount":316,"created_at":"2026-09-18 08:43:26.664097+00","balance_after":1207},{"id":"8f4589ff-45ef-467d-9f38-6a9142d2e757","user_id":"b5ffb675-4a9a-4bc6-8161-17eae9ddabfd","amount":316,"created_at":"2026-09-18 08:43:27.437366+00","balance_after":891},{"id":"4935d2f2-b333-4f2a-b9d3-bc6361b81359","user_id":"c72627d1-e00a-49f2-bd3f-ab4aad852b0a","amount":400,"created_at":"2026-09-18 10:18:50.344382+00","balance_after":610}]'::jsonb;
  users constant uuid[] := ARRAY['b5ffb675-4a9a-4bc6-8161-17eae9ddabfd','c72627d1-e00a-49f2-bd3f-ab4aad852b0a']::uuid[];
  r record;
  actual public.orders%ROWTYPE;
  profiles_before jsonb;
  ledger_before jsonb;
  orders_before jsonb;
  inserted_count integer := 0;
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  -- Prevent writers, including legacy paths which do not lock profiles.
  -- Brief global write pause on these four tables; timeout aborts rather than waiting.
  LOCK TABLE public.orders, public.profiles, public.wallet_transactions, public.withdrawals
    IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.wallet_transactions'::regclass AND NOT tgisinternal)
     OR EXISTS (SELECT 1 FROM pg_rewrite WHERE ev_class = 'public.wallet_transactions'::regclass) THEN
    RAISE EXCEPTION 'Unreviewed ledger trigger/rule';
  END IF;

  SELECT jsonb_agg(to_jsonb(p) ORDER BY id) INTO profiles_before
    FROM public.profiles p WHERE id = ANY(users);
  SELECT jsonb_agg(to_jsonb(t) ORDER BY id) INTO ledger_before
    FROM public.wallet_transactions t WHERE user_id = ANY(users);
  SELECT jsonb_agg(to_jsonb(o) ORDER BY id) INTO orders_before
    FROM public.orders o WHERE user_id = ANY(users);

  IF (SELECT count(*) FROM public.profiles WHERE
       (id = users[1] AND wallet_balance = 891) OR
       (id = users[2] AND wallet_balance = 610)) <> 2 THEN
    RAISE EXCEPTION 'Wallet checkpoints changed; investigate again';
  END IF;
  IF (SELECT count(*) FROM public.wallet_transactions WHERE user_id = ANY(users)) <> 2
     OR EXISTS (SELECT 1 FROM public.withdrawals WHERE user_id = ANY(users))
     OR (SELECT count(*) FROM public.orders WHERE user_id = ANY(users) AND lower(trim(payment_method)) = 'wallet') <> 7 THEN
    RAISE EXCEPTION 'Financial history changed; investigate again';
  END IF;

  IF (SELECT count(*) FROM public.wallet_transactions WHERE
      (id = 'c9e63f4e-f172-4cd7-bdd2-f4514a665529' AND user_id = users[1]
       AND amount = 2000 AND balance_after = 2000
       AND reference_id = 'e1b6e637-4408-41c7-bfc9-d6f03dca3c7b'
       AND created_at = '2026-09-18 05:16:55.640923+00'::timestamptz)
      OR
      (id = '0d318659-6e79-4d4e-a581-1c70e6629094' AND user_id = users[2]
       AND amount = 1000 AND balance_after = 1010
       AND reference_id = '8a13a522-ef5e-43ae-a9d1-714d7fdaafc4'
       AND created_at = '2026-09-18 10:18:26.996768+00'::timestamptz)) <> 2
     OR EXISTS (SELECT 1 FROM public.wallet_transactions WHERE user_id = ANY(users)
                AND (type <> 'add_money' OR direction <> 'credit')) THEN
    RAISE EXCEPTION 'Original funding checkpoints changed';
  END IF;

  IF jsonb_array_length(targets) <> 7 OR
     (SELECT sum(amount) FROM jsonb_to_recordset(targets) AS x(amount numeric)) <> 1509 THEN
    RAISE EXCEPTION 'Invalid repair manifest';
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(targets)
    AS x(id uuid, user_id uuid, amount numeric, created_at timestamptz, balance_after numeric)
  LOOP
    SELECT * INTO actual FROM public.orders WHERE id = r.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Target order missing: %', r.id; END IF;
    IF actual.user_id IS DISTINCT FROM r.user_id
       OR actual.amount IS DISTINCT FROM r.amount
       OR actual.created_at IS DISTINCT FROM r.created_at
       OR actual.payment_method IS DISTINCT FROM 'wallet'
       OR actual.status IS DISTINCT FROM 'completed'
       OR actual.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'Target order changed: %', r.id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.wallet_transactions WHERE reference_id = r.id) THEN
      RAISE EXCEPTION 'Existing linked ledger entry: %', r.id;
    END IF;

    INSERT INTO public.wallet_transactions
      (user_id, type, direction, amount, balance_after, reference_id, description, created_at)
    VALUES
      (r.user_id, 'order_payment', 'debit', r.amount, r.balance_after, r.id,
       'Legacy history repair 20260923185848: already deducted; balance_after reconstructed; created_at from order; wallet unchanged',
       r.created_at);
    inserted_count := inserted_count + 1;
  END LOOP;

  IF inserted_count <> 7 OR
     (SELECT count(*) FROM public.wallet_transactions WHERE user_id = ANY(users)) <> 9 THEN
    RAISE EXCEPTION 'Unexpected repaired ledger count';
  END IF;
  IF profiles_before IS DISTINCT FROM
       (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.profiles p WHERE id = ANY(users))
     OR orders_before IS DISTINCT FROM
       (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.orders o WHERE user_id = ANY(users))
     OR ledger_before IS DISTINCT FROM
       (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.wallet_transactions t
        WHERE id IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(ledger_before))) THEN
    RAISE EXCEPTION 'Existing records changed; aborting repair';
  END IF;
END;
$repair$;
