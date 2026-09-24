-- READ ONLY. Run before any proposed application of the resolution migration.
-- JSON projection works whether zero, some, or all metadata columns exist.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT count(*) AS total_support_cases FROM public.support_cases;
SELECT status, count(*) AS case_count
FROM public.support_cases GROUP BY status ORDER BY status;

SELECT id, support_id, status, created_at, updated_at,
       to_jsonb(sc)->>'resolution_note' AS resolution_note,
       to_jsonb(sc)->>'resolved_at' AS resolved_at,
       to_jsonb(sc)->>'resolved_by' AS resolved_by
FROM public.support_cases AS sc WHERE status = 'resolved' ORDER BY created_at, id;

SELECT expected.column_name, (a.attnum IS NOT NULL) AS column_exists,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
       a.attnotnull AS not_null,
       pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expression,
       a.attidentity AS identity_kind, a.attgenerated AS generated_kind
FROM (VALUES ('resolution_note'), ('resolved_at'), ('resolved_by')) AS expected(column_name)
LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = 'public.support_cases'::regclass
  AND a.attname = expected.column_name AND NOT a.attisdropped
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
ORDER BY expected.column_name;

-- Inspect existing definitions, rather than assuming a name implies compatibility.
SELECT conname, contype, convalidated, pg_catalog.pg_get_constraintdef(oid) AS definition
FROM pg_catalog.pg_constraint WHERE conrelid = 'public.support_cases'::regclass
ORDER BY conname;
SELECT tgname, tgenabled, pg_catalog.pg_get_triggerdef(oid) AS definition
FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.support_cases'::regclass AND NOT tgisinternal
ORDER BY tgname;

COMMIT;
