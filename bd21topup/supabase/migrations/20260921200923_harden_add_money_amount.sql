BEGIN;

ALTER TABLE public.add_money_requests
  DROP CONSTRAINT IF EXISTS add_money_requests_amount_check;

ALTER TABLE public.add_money_requests
  ADD CONSTRAINT add_money_requests_amount_check
  CHECK (
    amount >= 10
    AND amount <= 100000
  );

COMMIT;