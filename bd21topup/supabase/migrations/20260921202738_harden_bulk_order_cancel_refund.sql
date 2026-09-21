CREATE OR REPLACE FUNCTION public.admin_cancel_order_with_refund(
    p_order_id uuid,
    p_admin_note text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_result jsonb;
BEGIN
    v_result := public.admin_cancel_order(
        p_order_id,
        p_admin_note
    );

    RETURN v_result::json;
END;
$function$;

REVOKE ALL
ON FUNCTION public.admin_cancel_order_with_refund(uuid, text)
FROM PUBLIC;

REVOKE EXECUTE
ON FUNCTION public.admin_cancel_order_with_refund(uuid, text)
FROM anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.admin_cancel_order_with_refund(uuid, text)
TO service_role, postgres;