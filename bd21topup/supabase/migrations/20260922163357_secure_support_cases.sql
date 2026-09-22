BEGIN;

-- No financial RPCs or balances are changed. These invoker triggers participate
-- in the caller's transaction: a failed case/notification rolls back the review.
CREATE SCHEMA IF NOT EXISTS support_private;
REVOKE ALL ON SCHEMA support_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA support_private TO service_role;

CREATE TABLE public.support_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  case_type text NOT NULL CHECK (case_type IN ('ORD', 'ADD', 'WDR')),
  order_id uuid UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  add_money_request_id uuid UNIQUE REFERENCES public.add_money_requests(id) ON DELETE CASCADE,
  withdrawal_id uuid UNIQUE REFERENCES public.withdrawals(id) ON DELETE CASCADE,
  support_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'closed')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_case_source CHECK (
    num_nonnulls(order_id, add_money_request_id, withdrawal_id) = 1 AND
    ((case_type = 'ORD' AND order_id IS NOT NULL) OR
     (case_type = 'ADD' AND add_money_request_id IS NOT NULL) OR
     (case_type = 'WDR' AND withdrawal_id IS NOT NULL))
  ),
  CONSTRAINT support_case_reference CHECK (
    support_id ~ '^BD21-(ORD|ADD|WDR)-[0-9A-F]{12}$' AND
    split_part(support_id, '-', 2) = case_type
  )
);
CREATE INDEX support_cases_user_created_idx ON public.support_cases(user_id, created_at DESC);
ALTER TABLE public.support_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_cases FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.support_cases TO authenticated, service_role;
-- Trusted financial RPCs and server operations only; no client mutation policy.
GRANT INSERT ON public.support_cases TO service_role;
CREATE POLICY support_cases_read_own ON public.support_cases
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

ALTER TABLE public.notifications ADD COLUMN support_case_id uuid
  REFERENCES public.support_cases(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX notifications_support_case_idx ON public.notifications(support_case_id)
  WHERE support_case_id IS NOT NULL;

-- Verify the source at the database boundary and derive sensitive fields from it.
CREATE FUNCTION support_private.validate_case() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  source_user uuid;
  source_status text;
  source_reason text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.user_id, NEW.case_type, NEW.order_id, NEW.add_money_request_id,
           NEW.withdrawal_id, NEW.support_id, NEW.reason, NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.user_id, OLD.case_type, OLD.order_id, OLD.add_money_request_id,
           OLD.withdrawal_id, OLD.support_id, OLD.reason, OLD.created_at) THEN
      RAISE EXCEPTION 'Support case identity and evidence are immutable';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF NEW.case_type = 'ORD' THEN
    SELECT user_id, status, admin_note INTO source_user, source_status, source_reason
    FROM public.orders WHERE id = NEW.order_id FOR SHARE;
  ELSIF NEW.case_type = 'ADD' THEN
    SELECT user_id, status, admin_note INTO source_user, source_status, source_reason
    FROM public.add_money_requests WHERE id = NEW.add_money_request_id FOR SHARE;
  ELSIF NEW.case_type = 'WDR' THEN
    SELECT user_id, status, admin_note INTO source_user, source_status, source_reason
    FROM public.withdrawals WHERE id = NEW.withdrawal_id FOR SHARE;
  END IF;
  IF source_user IS NULL OR source_user IS DISTINCT FROM NEW.user_id OR
     NOT (source_status = 'rejected' OR (NEW.case_type = 'ORD' AND source_status = 'cancelled')) THEN
    RAISE EXCEPTION 'Invalid support case source or owner';
  END IF;
  NEW.reason := coalesce(nullif(btrim(source_reason), ''), 'কারণ উল্লেখ করা হয়নি। সাপোর্টে যোগাযোগ করুন।');
  NEW.status := 'open';
  NEW.created_at := now();
  NEW.updated_at := NEW.created_at;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_case_validate BEFORE INSERT OR UPDATE ON public.support_cases
FOR EACH ROW EXECUTE FUNCTION support_private.validate_case();

CREATE FUNCTION support_private.create_case(p_type text, p_id uuid, p_user uuid)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE attempt integer;
BEGIN
  -- Deleted/legacy anonymous orders cannot become an authenticated user's case.
  IF p_user IS NULL THEN RETURN; END IF;
  FOR attempt IN 1..5 LOOP
    BEGIN
      INSERT INTO public.support_cases(user_id, case_type, order_id, add_money_request_id,
        withdrawal_id, support_id, reason)
      VALUES (p_user, p_type,
        CASE WHEN p_type = 'ORD' THEN p_id END,
        CASE WHEN p_type = 'ADD' THEN p_id END,
        CASE WHEN p_type = 'WDR' THEN p_id END,
        'BD21-' || p_type || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)), '');
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      -- Concurrent calls for the same operation return the existing case.
      IF EXISTS (SELECT 1 FROM public.support_cases WHERE
        (p_type = 'ORD' AND order_id = p_id) OR
        (p_type = 'ADD' AND add_money_request_id = p_id) OR
        (p_type = 'WDR' AND withdrawal_id = p_id)) THEN RETURN; END IF;
      -- A random public-ID collision is retried, never silently dropped.
    END;
  END LOOP;
  RAISE EXCEPTION 'Could not allocate Support ID';
END;
$$;

CREATE FUNCTION support_private.operation_case() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'rejected' OR (TG_ARGV[0] = 'ORD' AND NEW.status = 'cancelled') THEN
    PERFORM support_private.create_case(TG_ARGV[0], NEW.id, NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER orders_support_case AFTER INSERT OR UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION support_private.operation_case('ORD');
CREATE TRIGGER add_money_support_case AFTER INSERT OR UPDATE OF status ON public.add_money_requests
FOR EACH ROW EXECUTE FUNCTION support_private.operation_case('ADD');
CREATE TRIGGER withdrawals_support_case AFTER INSERT OR UPDATE OF status ON public.withdrawals
FOR EACH ROW EXECUTE FUNCTION support_private.operation_case('WDR');

CREATE FUNCTION support_private.notify_case() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  INSERT INTO public.notifications(user_id, title, message, type, support_case_id)
  VALUES (NEW.user_id,
    CASE NEW.case_type WHEN 'ORD' THEN 'বাতিল অর্ডারের সাপোর্ট'
      WHEN 'ADD' THEN 'প্রত্যাখ্যাত অ্যাড মানির সাপোর্ট' ELSE 'প্রত্যাখ্যাত উত্তোলনের সাপোর্ট' END,
    'Support ID: ' || NEW.support_id || '। সহায়তার জন্য রসিদ বা স্ক্রিনশটসহ সাপোর্টে যোগাযোগ করুন।',
    'support_case', NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_case_notification AFTER INSERT ON public.support_cases
FOR EACH ROW EXECUTE FUNCTION support_private.notify_case();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA support_private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA support_private TO service_role;

-- Backfill only new support rows and linked notifications, never source records.
SELECT support_private.create_case('ORD', id, user_id) FROM public.orders
WHERE status IN ('cancelled', 'rejected') AND user_id IS NOT NULL;
SELECT support_private.create_case('ADD', id, user_id) FROM public.add_money_requests WHERE status = 'rejected';
SELECT support_private.create_case('WDR', id, user_id) FROM public.withdrawals WHERE status = 'rejected';
COMMIT;
