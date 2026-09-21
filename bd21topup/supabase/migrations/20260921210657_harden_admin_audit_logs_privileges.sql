REVOKE ALL
ON TABLE public.admin_audit_logs
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.admin_audit_logs
TO service_role, postgres;
