-- =========================================================
-- UID cache: server-side only
-- =========================================================

REVOKE ALL
ON TABLE public.uid_cache
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.uid_cache
TO service_role, postgres;


-- =========================================================
-- Rate-limit backing table: server-side only
-- =========================================================

REVOKE ALL
ON TABLE public.api_rate_limits
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.api_rate_limits
TO service_role, postgres;


-- =========================================================
-- Harden rate-limit function
-- =========================================================

CREATE OR REPLACE FUNCTION public.check_uid_rate_limit(
  p_ip text,
  p_max_requests integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ip text;
  v_current_count integer;
  v_reset_at timestamptz;
BEGIN
  v_ip := trim(coalesce(p_ip, ''));

  IF v_ip = '' OR length(v_ip) > 100 THEN
    RAISE EXCEPTION 'Invalid IP identifier';
  END IF;

  IF p_max_requests IS NULL
     OR p_max_requests < 1
     OR p_max_requests > 1000 THEN
    RAISE EXCEPTION 'Invalid rate limit';
  END IF;

  IF p_window_seconds IS NULL
     OR p_window_seconds < 1
     OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'Invalid rate limit window';
  END IF;

  SELECT request_count, reset_at
  INTO v_current_count, v_reset_at
  FROM public.api_rate_limits
  WHERE ip = v_ip
  FOR UPDATE;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.api_rate_limits (
        ip,
        request_count,
        reset_at
      )
      VALUES (
        v_ip,
        1,
        now() + make_interval(secs => p_window_seconds)
      );

      RETURN true;

    EXCEPTION
      WHEN unique_violation THEN
        SELECT request_count, reset_at
        INTO v_current_count, v_reset_at
        FROM public.api_rate_limits
        WHERE ip = v_ip
        FOR UPDATE;
    END;
  END IF;

  IF v_reset_at IS NULL OR now() >= v_reset_at THEN
    UPDATE public.api_rate_limits
    SET
      request_count = 1,
      reset_at = now() + make_interval(secs => p_window_seconds)
    WHERE ip = v_ip;

    RETURN true;
  END IF;

  IF v_current_count >= p_max_requests THEN
    RETURN false;
  END IF;

  UPDATE public.api_rate_limits
  SET request_count = request_count + 1
  WHERE ip = v_ip;

  RETURN true;
END;
$function$;


-- =========================================================
-- Function execution privileges
-- =========================================================

REVOKE ALL
ON FUNCTION public.check_uid_rate_limit(text, integer, integer)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.check_uid_rate_limit(text, integer, integer)
TO service_role, postgres;