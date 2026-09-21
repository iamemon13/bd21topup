-- =========================================================
-- Harden profile -> orders trigger function
-- =========================================================

CREATE OR REPLACE FUNCTION public.update_orders_account_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    UPDATE public.orders
    SET account_name = NEW.full_name
    WHERE user_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;


-- =========================================================
-- Remove direct client execution from trigger functions
-- =========================================================

REVOKE ALL
ON FUNCTION public.handle_new_user()
FROM PUBLIC, anon, authenticated;

REVOKE ALL
ON FUNCTION public.rls_auto_enable()
FROM PUBLIC, anon, authenticated;

REVOKE ALL
ON FUNCTION public.update_orders_account_name()
FROM PUBLIC, anon, authenticated;


-- Keep trusted server/database roles
GRANT EXECUTE
ON FUNCTION public.handle_new_user()
TO service_role, postgres;

GRANT EXECUTE
ON FUNCTION public.rls_auto_enable()
TO service_role, postgres;

GRANT EXECUTE
ON FUNCTION public.update_orders_account_name()
TO service_role, postgres;