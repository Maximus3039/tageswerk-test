-- Tageswerk 3.7.0 Preflight. Ausschließlich lesend.
-- Ziel später: PROD eqtrifscedpsngsysxvc. TEST: gamvnzggcrrlnyoknllu.
-- Kein DDL, kein DML, kein GRANT, kein NOTIFY.
-- Bricht nur ab, wenn Abhängigkeiten für die additiven Dateien 02–05 fehlen
-- oder vorhandene Kernfunktionen eine unverträgliche Signatur haben.

SELECT
  obj,
  CASE WHEN present THEN 'da' ELSE 'fehlt' END AS status,
  CASE
    WHEN obj LIKE 'need:%' AND NOT present THEN 'BLOCKER Abhängigkeit'
    WHEN obj LIKE 'install:%' AND NOT present THEN '02–05 anlegen'
    WHEN obj LIKE 'compat:%' AND NOT present THEN 'Frontend-Lücke, nicht in 02–05'
    ELSE 'bestehen lassen'
  END AS aktion
FROM (
  SELECT 'need:facilities'::text AS obj, to_regclass('public.facilities') IS NOT NULL AS present
  UNION ALL SELECT 'need:memberships', to_regclass('public.memberships') IS NOT NULL
  UNION ALL SELECT 'need:defects', to_regclass('public.defects') IS NOT NULL
  UNION ALL SELECT 'need:utility_meters', to_regclass('public.utility_meters') IS NOT NULL
  UNION ALL SELECT 'need:tageswerk_meter_role',
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'tageswerk_meter_role')
  UNION ALL SELECT 'need:tageswerk_facility_organization',
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'tageswerk_facility_organization')
  UNION ALL SELECT 'need:tageswerk_bind_operation_facility',
    to_regprocedure('public.tageswerk_bind_operation_facility()') IS NOT NULL
  UNION ALL SELECT 'need:facilities.organization_id',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'facilities' AND column_name = 'organization_id')
  UNION ALL SELECT 'need:defects.change_note',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'defects' AND column_name = 'change_note')
  UNION ALL SELECT 'install:tageswerk_create_facility',
    to_regprocedure('public.tageswerk_create_facility(uuid,text)') IS NOT NULL
  UNION ALL SELECT 'install:utility_monthly_consumption',
    to_regclass('public.utility_monthly_consumption') IS NOT NULL
  UNION ALL SELECT 'install:utility_monthly_consumption_revisions',
    to_regclass('public.utility_monthly_consumption_revisions') IS NOT NULL
  UNION ALL SELECT 'install:defect_photos',
    to_regclass('public.defect_photos') IS NOT NULL
  UNION ALL SELECT 'install:bucket:defect-photos',
    EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'defect-photos')
  UNION ALL SELECT 'install:tageswerk_defect_photo_storage_allowed',
    to_regprocedure('public.tageswerk_defect_photo_storage_allowed(text)') IS NOT NULL
  UNION ALL SELECT 'compat:tageswerk_consumption_calendar_6',
    to_regprocedure('public.tageswerk_consumption_calendar(uuid,text,uuid,text,date,date)') IS NOT NULL
  UNION ALL SELECT 'compat:tageswerk_prepare_reading()',
    to_regprocedure('public.tageswerk_prepare_reading()') IS NOT NULL
  UNION ALL SELECT 'compat:employee_update_assigned_defect(uuid,text,text)',
    to_regprocedure('public.employee_update_assigned_defect(uuid,text,text)') IS NOT NULL
  UNION ALL SELECT 'compat:tageswerk_commit_historical_import',
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'tageswerk_commit_historical_import')
  UNION ALL SELECT 'compat:tageswerk_archive_defect',
    to_regprocedure('public.tageswerk_archive_defect(uuid)') IS NOT NULL
  UNION ALL SELECT 'compat:tageswerk_archive_closed_defects',
    to_regprocedure('public.tageswerk_archive_closed_defects(uuid)') IS NOT NULL
  UNION ALL SELECT 'compat:tageswerk_restore_archived_defect',
    to_regprocedure('public.tageswerk_restore_archived_defect(uuid)') IS NOT NULL
  UNION ALL SELECT 'compat:tageswerk_set_water_filter_active',
    to_regprocedure('public.tageswerk_set_water_filter_active(uuid,boolean,text)') IS NOT NULL
  UNION ALL SELECT 'compat:water_filter_flushes',
    to_regclass('public.water_filter_flushes') IS NOT NULL
  UNION ALL SELECT 'compat:defects.archived_at',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'defects' AND column_name = 'archived_at')
  UNION ALL SELECT 'compat:defects.archived_by',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'defects' AND column_name = 'archived_by')
  UNION ALL SELECT 'compat:user_notice_acks',
    to_regclass('public.user_notice_acks') IS NOT NULL
) s
ORDER BY aktion, obj;

SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_function_result(p.oid) AS rettype,
       p.prosecdef AS definer,
       COALESCE(p.proconfig::text, '{}') AS config,
       md5(pg_get_functiondef(p.oid)) AS def_md5,
       (position('SET search_path' IN COALESCE(array_to_string(p.proconfig, ','), '') || pg_get_functiondef(p.oid)) > 0) AS search_path_set,
       (position('NEW.series_id' IN pg_get_functiondef(p.oid)) > 0) AS mentions_series_id,
       (position('Der Zählerstand passt nicht' IN pg_get_functiondef(p.oid)) > 0
        OR position('Der Zaehlerstand passt nicht' IN pg_get_functiondef(p.oid)) > 0) AS mentions_plausibility,
       (position('Anmeldung erforderlich' IN pg_get_functiondef(p.oid)) > 0) AS requires_auth,
       (position('Dieser Mangel ist dir nicht zugewiesen' IN pg_get_functiondef(p.oid)) > 0) AS employee_assigned_guard,
       (position('SET assigned_to' IN pg_get_functiondef(p.oid)) > 0) AS sets_assigned_to,
       (position('uebernommen' IN pg_get_functiondef(p.oid)) > 0) AS commit_status_uebernommen,
       (position('event_id' IN pg_get_functiondef(p.oid)) > 0) AS mentions_event_id,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS exec_authenticated,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS exec_anon
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'tageswerk_create_facility',
    'tageswerk_prepare_reading',
    'tageswerk_consumption_calendar',
    'tageswerk_commit_historical_import',
    'tageswerk_preview_historical_import',
    'employee_update_assigned_defect',
    'tageswerk_archive_defect',
    'tageswerk_archive_closed_defects',
    'tageswerk_restore_archived_defect',
    'tageswerk_set_water_filter_active',
    'tageswerk_prepare_monthly_consumption',
    'tageswerk_meter_role',
    'tageswerk_facility_organization',
    'tageswerk_bind_operation_facility'
  )
ORDER BY 1, 2;

SELECT c.relname AS tbl, obj.conname, obj.contype, pg_get_constraintdef(obj.oid) AS def
FROM pg_constraint obj
JOIN pg_class c ON c.oid = obj.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('facilities', 'defects', 'utility_monthly_consumption', 'utility_monthly_consumption_revisions', 'defect_photos')
ORDER BY 1, 2;

SELECT tablename, policyname, cmd, roles::text AS roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'facilities', 'defects', 'utility_monthly_consumption', 'utility_monthly_consumption_revisions',
    'defect_photos', 'water_filter_flushes', 'utility_meter_readings'
  )
ORDER BY 1, 3, 2;

SELECT event_object_table AS tbl, trigger_name, event_manipulation, action_timing, action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table IN ('utility_meter_readings', 'utility_monthly_consumption', 'defects', 'facilities')
ORDER BY 1, 2, 3;

SELECT id, public AS is_public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id IN ('defect-photos', 'meter-photos', 'facility-photos')
ORDER BY 1;

SELECT policyname, cmd, roles::text AS roles
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname ILIKE '%defect%'
ORDER BY 1;

DO $preflight$
DECLARE
  missing text[] := ARRAY[]::text[];
  cal_args text;
  emp_args text;
  cal_n int;
BEGIN
  IF to_regclass('public.facilities') IS NULL THEN missing := missing || 'facilities'; END IF;
  IF to_regclass('public.memberships') IS NULL THEN missing := missing || 'memberships'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'tageswerk_meter_role'
  ) THEN missing := missing || 'tageswerk_meter_role'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'tageswerk_facility_organization'
  ) THEN missing := missing || 'tageswerk_facility_organization'; END IF;
  IF to_regprocedure('public.tageswerk_bind_operation_facility()') IS NULL THEN
    missing := missing || 'tageswerk_bind_operation_facility()';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'facilities' AND column_name = 'organization_id'
  ) THEN missing := missing || 'facilities.organization_id'; END IF;

  SELECT count(*) INTO cal_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'tageswerk_consumption_calendar';
  IF cal_n > 0 AND to_regprocedure('public.tageswerk_consumption_calendar(uuid,text,uuid,text,date,date)') IS NULL THEN
    SELECT pg_get_function_identity_arguments(p.oid) INTO cal_args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'tageswerk_consumption_calendar'
    LIMIT 1;
    RAISE EXCEPTION 'tageswerk_consumption_calendar hat nicht die Frontend-Signatur (uuid,text,uuid,text,date,date). Ist: %', cal_args;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'employee_update_assigned_defect'
  ) AND to_regprocedure('public.employee_update_assigned_defect(uuid,text,text)') IS NULL THEN
    SELECT pg_get_function_identity_arguments(p.oid) INTO emp_args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'employee_update_assigned_defect'
    LIMIT 1;
    RAISE EXCEPTION 'employee_update_assigned_defect Signatur weicht ab: %', emp_args;
  END IF;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight Abhängigkeit fehlt: %', array_to_string(missing, ', ');
  END IF;
END;
$preflight$;
