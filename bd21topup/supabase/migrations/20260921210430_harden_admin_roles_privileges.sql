REVOKE ALL
ON TABLE public.admin_roles
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.admin_roles
TO service_role, postgres;