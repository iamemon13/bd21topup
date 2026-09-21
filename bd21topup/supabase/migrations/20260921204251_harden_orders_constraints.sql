BEGIN;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_payment_method_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_method_check
  CHECK (
    payment_method IS NOT NULL
    AND lower(trim(payment_method)) IN (
      'wallet',
      'bkash',
      'nagad',
      'rocket',
      'upay'
    )
  );

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_amount_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_amount_check
  CHECK (
    amount IS NOT NULL
    AND amount > 0
  );

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_transaction_id_format_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_transaction_id_format_check
  CHECK (
    transaction_id IS NOT NULL
    AND length(trim(transaction_id)) BETWEEN 4 AND 80
  )
  NOT VALID;

COMMIT;