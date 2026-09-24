-- Service-only, invoker-rights transaction: role changes cannot outlive their audit.
CREATE FUNCTION public.admin_update_role(
  p_admin_id uuid, p_user_id uuid, p_role text, p_permissions text[]
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_permissions text[];
BEGIN
  -- Serialize this rare operation before checking authority. Lock the actor row
  -- too, so an older application instance cannot demote it during this call.
  PERFORM pg_catalog.pg_advisory_xact_lock(21421, 1);
  SELECT role INTO v_role FROM public.admin_roles
    WHERE user_id = p_admin_id FOR UPDATE;
  IF v_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only Super Admin can change roles' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_role IS NULL OR
     p_role NOT IN ('super_admin', 'admin', 'editor', 'user') THEN
    RAISE EXCEPTION 'Invalid role or user' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(p_permissions) p
    WHERE p IS NULL OR p NOT IN ('manage_users', 'manage_orders',
      'manage_add_money', 'manage_withdrawals', 'manage_packages')) THEN
    RAISE EXCEPTION 'Invalid permission' USING ERRCODE = '22023';
  END IF;
  IF p_admin_id = p_user_id AND p_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Cannot demote your own Super Admin account' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT p ORDER BY p), '{}'::text[])
    INTO v_permissions FROM pg_catalog.unnest(p_permissions) p;
  IF p_role = 'user' THEN v_permissions := '{}'::text[]; END IF;

  INSERT INTO public.admin_roles(user_id, role, permissions)
    VALUES (p_user_id, p_role, v_permissions)
    ON CONFLICT (user_id) DO UPDATE
      SET role = EXCLUDED.role, permissions = EXCLUDED.permissions;
  INSERT INTO public.admin_audit_logs(admin_id, action_type, target_id, details, ip_address)
    VALUES (p_admin_id, 'UPDATE_USER_ROLE', p_user_id::text,
      'Role updated to ' || p_role || '. Permissions: ' ||
      COALESCE(NULLIF(array_to_string(v_permissions, ', '), ''), 'none'), 'unknown');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_role(uuid,uuid,text,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_role(uuid,uuid,text,text[]) TO service_role;
