BEGIN;

-- Keep constraint/trigger replacement atomic and prevent a concurrent legacy
-- writer from creating a metadata-free resolution during this migration.
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.support_cases IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.support_cases
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid;

-- IF NOT EXISTS alone does not verify a partially applied column's definition.
-- Fail closed on incompatible columns; do not cast or rewrite stored evidence.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('resolution_note', 'text'::regtype),
                 ('resolved_at', 'timestamptz'::regtype),
                 ('resolved_by', 'uuid'::regtype)) AS expected(name, type_oid)
    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = 'public.support_cases'::regclass
      AND a.attname = expected.name AND NOT a.attisdropped
    WHERE a.attnum IS NULL OR a.atttypid <> expected.type_oid OR
      a.atttypmod <> -1 OR a.attnotnull OR a.atthasdef OR
      a.attidentity <> '' OR a.attgenerated <> ''
  ) THEN
    RAISE EXCEPTION 'Conflicting support case resolution column definition';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.support_cases'::regclass AND
      ((conname = 'support_case_resolution_fields' AND contype <> 'c') OR
       (conname = 'support_cases_resolved_by_fkey' AND contype <> 'f'))
  ) THEN
    RAISE EXCEPTION 'Conflicting support case resolution constraint type';
  END IF;
END;
$$;

-- Deterministically replace our named constraints, including a prior draft's
-- strict CHECK or incorrect FK action. Never silently skip a same-named object.
-- No CASCADE: unexpected dependencies must fail rather than be removed.
ALTER TABLE public.support_cases
  DROP CONSTRAINT IF EXISTS support_case_resolution_fields,
  DROP CONSTRAINT IF EXISTS support_cases_resolved_by_fkey;
ALTER TABLE public.support_cases
  ADD CONSTRAINT support_cases_resolved_by_fkey FOREIGN KEY (resolved_by)
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT support_case_resolution_fields CHECK (
    status <> 'resolved' OR
    -- Historical resolutions retain unknown metadata, without fabricated values.
    (resolution_note IS NULL AND resolved_at IS NULL AND resolved_by IS NULL) OR (
      resolution_note IS NOT NULL AND
      char_length(btrim(resolution_note)) BETWEEN 1 AND 500 AND
      -- resolved_by can later become NULL only on actual resolver deletion.
      -- The transition trigger requires it when the case is first resolved.
      resolved_at IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION support_private.validate_case() RETURNS trigger
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
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      IF OLD.status <> 'open' OR NEW.status <> 'resolved' OR
         NEW.resolution_note IS NULL OR char_length(btrim(NEW.resolution_note)) NOT BETWEEN 1 AND 500 OR
         NEW.resolved_at IS NULL OR NEW.resolved_by IS NULL THEN
        RAISE EXCEPTION 'Invalid support case resolution' USING ERRCODE = '22023';
      END IF;
    ELSIF ROW(NEW.resolution_note, NEW.resolved_at, NEW.resolved_by)
          IS DISTINCT FROM ROW(OLD.resolution_note, OLD.resolved_at, OLD.resolved_by) THEN
      IF NOT (OLD.status = 'resolved' AND OLD.resolved_by IS NOT NULL AND NEW.resolved_by IS NULL AND
              NEW.resolution_note IS NOT DISTINCT FROM OLD.resolution_note AND
              NEW.resolved_at IS NOT DISTINCT FROM OLD.resolved_at AND
              pg_catalog.pg_trigger_depth() > 1) THEN
        RAISE EXCEPTION 'Support case resolution metadata is immutable';
      END IF;
      -- FK SET NULL runs as a nested trigger after the referenced user is gone.
      -- Depth alone is insufficient: another trigger must not erase attribution
      -- while the resolver still exists. No new auth.users grants are needed.
      IF EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.resolved_by) THEN
        RAISE EXCEPTION 'Support case resolution metadata is immutable';
      END IF;
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
  NEW.resolution_note := NULL;
  NEW.resolved_at := NULL;
  NEW.resolved_by := NULL;
  NEW.created_at := now();
  NEW.updated_at := NEW.created_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_case_validate ON public.support_cases;
CREATE TRIGGER support_case_validate BEFORE INSERT OR UPDATE ON public.support_cases
FOR EACH ROW EXECUTE FUNCTION support_private.validate_case();
REVOKE ALL ON FUNCTION support_private.validate_case() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION support_private.validate_case() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_resolve_support_case(
  p_admin_id uuid,
  p_support_case_id uuid,
  p_resolution_note text,
  p_ip text DEFAULT 'unknown'
)
RETURNS TABLE(
  id uuid,
  support_id text,
  case_type text,
  status text,
  reason text,
  resolution_note text,
  resolved_at timestamptz,
  resolved_by uuid,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  actor_role text;
  actor_permissions text[];
  case_row public.support_cases%ROWTYPE;
  note text;
  required_permission text;
BEGIN
  note := NULLIF(btrim(COALESCE(p_resolution_note, '')), '');
  IF p_admin_id IS NULL OR p_support_case_id IS NULL OR note IS NULL OR char_length(note) > 500 THEN
    RAISE EXCEPTION 'Invalid support case resolution' USING ERRCODE = '22023';
  END IF;
  IF length(COALESCE(p_ip, '')) > 200 THEN
    RAISE EXCEPTION 'Invalid audit metadata' USING ERRCODE = '22023';
  END IF;

  SELECT ar.role, COALESCE(ar.permissions, '{}'::text[])
  INTO actor_role, actor_permissions
  FROM public.admin_roles AS ar
  WHERE ar.user_id = p_admin_id
  FOR SHARE;

  IF actor_role IS NULL OR actor_role NOT IN ('super_admin', 'admin', 'editor') THEN
    RAISE EXCEPTION 'Missing support case permission' USING ERRCODE = '42501';
  END IF;

  SELECT sc.* INTO case_row
  FROM public.support_cases AS sc
  WHERE sc.id = p_support_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Support case not found' USING ERRCODE = 'P0002';
  END IF;
  IF case_row.status <> 'open' THEN
    RAISE EXCEPTION 'Support case is already resolved or closed' USING ERRCODE = '55000';
  END IF;

  required_permission := CASE case_row.case_type
    WHEN 'ORD' THEN 'manage_orders'
    WHEN 'ADD' THEN 'manage_add_money'
    WHEN 'WDR' THEN 'manage_withdrawals'
    ELSE NULL
  END;
  IF required_permission IS NULL OR (
    actor_role <> 'super_admin' AND NOT (required_permission = ANY(actor_permissions))
  ) THEN
    RAISE EXCEPTION 'Missing support case permission' USING ERRCODE = '42501';
  END IF;

  UPDATE public.support_cases AS sc
  SET status = 'resolved',
      resolution_note = note,
      resolved_at = now(),
      resolved_by = p_admin_id
  WHERE sc.id = case_row.id
  RETURNING sc.id, sc.support_id, sc.case_type, sc.status, sc.reason,
    sc.resolution_note, sc.resolved_at, sc.resolved_by, sc.updated_at
  INTO id, support_id, case_type, status, reason, resolution_note, resolved_at, resolved_by, updated_at;

  INSERT INTO public.admin_audit_logs(admin_id, action_type, target_id, details, ip_address)
  VALUES (
    p_admin_id,
    'SUPPORT_CASE_RESOLVED',
    case_row.id::text,
    jsonb_build_object(
      'support_id', support_id,
      'case_type', case_type,
      'resolution_note', resolution_note,
      'resolved_at', resolved_at
    )::text,
    left(COALESCE(NULLIF(btrim(p_ip), ''), 'unknown'), 200)
  );

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_resolve_support_case(uuid, uuid, text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_support_case(uuid, uuid, text, text)
TO service_role;

GRANT UPDATE (status, resolution_note, resolved_at, resolved_by, updated_at)
ON public.support_cases TO service_role;

COMMIT;
