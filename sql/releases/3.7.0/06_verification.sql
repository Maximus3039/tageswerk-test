-- Tageswerk 3.7.0 Nachprüfung. Lesend.
-- Bricht ab, wenn 3.7.0-Sollobjekte fehlen oder Kernfunktionen unverträglich sind.

DO $verify$
DECLARE
  missing text[] := ARRAY[]::text[];
  cal_ok boolean;
  bucket_public boolean;
BEGIN
  IF to_regprocedure('public.tageswerk_create_facility(uuid,text)') IS NULL THEN
    missing := missing || 'tageswerk_create_facility(uuid,text)';
  ELSIF NOT has_function_privilege('authenticated', 'public.tageswerk_create_facility(uuid,text)', 'EXECUTE') THEN
    missing := missing || 'grant:tageswerk_create_facility authenticated';
  ELSIF has_function_privilege('anon', 'public.tageswerk_create_facility(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'tageswerk_create_facility darf nicht für anon ausführbar sein.';
  END IF;

  IF to_regclass('public.utility_monthly_consumption') IS NULL THEN
    missing := missing || 'utility_monthly_consumption';
  END IF;
  IF to_regclass('public.utility_monthly_consumption_revisions') IS NULL THEN
    missing := missing || 'utility_monthly_consumption_revisions';
  END IF;
  IF to_regprocedure('public.tageswerk_prepare_monthly_consumption()') IS NULL THEN
    missing := missing || 'tageswerk_prepare_monthly_consumption';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'utility_monthly_consumption' AND cmd = 'SELECT'
  ) THEN
    missing := missing || 'policy:utility_monthly_consumption SELECT';
  END IF;

  IF to_regclass('public.defect_photos') IS NULL THEN
    missing := missing || 'defect_photos';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'defect-photos') THEN
    missing := missing || 'bucket:defect-photos';
  ELSE
    SELECT public INTO bucket_public FROM storage.buckets WHERE id = 'defect-photos';
    IF bucket_public IS TRUE THEN
      RAISE EXCEPTION 'Bucket defect-photos darf nicht öffentlich sein.';
    END IF;
  END IF;
  IF to_regprocedure('public.tageswerk_defect_photo_storage_allowed(text)') IS NULL THEN
    missing := missing || 'tageswerk_defect_photo_storage_allowed';
  END IF;

  cal_ok := to_regprocedure('public.tageswerk_consumption_calendar(uuid,text,uuid,text,date,date)') IS NOT NULL;
  IF NOT cal_ok THEN
    missing := missing || 'tageswerk_consumption_calendar(6 Argumente)';
  END IF;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Verification fehlt: %', array_to_string(missing, ', ');
  END IF;
END;
$verify$;

SELECT 'ok' AS verification, now() AS checked_at;

SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS definer,
       (position('Dieser Mangel ist dir nicht zugewiesen' IN pg_get_functiondef(p.oid)) > 0) AS employee_guard,
       (position('SET assigned_to' IN pg_get_functiondef(p.oid)) > 0) AS sets_assigned_to,
       (position('uebernommen' IN pg_get_functiondef(p.oid)) > 0) AS commit_uebernommen,
       (position('NEW.series_id' IN pg_get_functiondef(p.oid)) > 0) AS prepare_series,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS exec_anon
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'employee_update_assigned_defect',
    'tageswerk_commit_historical_import',
    'tageswerk_prepare_reading',
    'tageswerk_archive_defect',
    'tageswerk_archive_closed_defects',
    'tageswerk_restore_archived_defect',
    'tageswerk_set_water_filter_active',
    'tageswerk_create_facility'
  )
ORDER BY 1;
