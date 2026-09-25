BEGIN;

-- account_name is captured when an order is created. Stop profile edits from
-- rewriting that historical evidence, without changing any existing orders.
DROP TRIGGER IF EXISTS profile_name_change_trigger ON public.profiles;
DROP FUNCTION IF EXISTS public.update_orders_account_name();

COMMIT;
