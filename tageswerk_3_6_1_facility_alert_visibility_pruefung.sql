-- Lesende Kontrolle nach tageswerk_3_6_1_facility_alert_visibility.sql
-- Schreibt nichts. Nicht in der Produktivdatenbank ausführen ohne gesonderte Freigabe.

SELECT pruefung, status, details
FROM (
  SELECT 'Tabelle vorhanden' AS pruefung,
    CASE WHEN to_regclass('public.facility_alert_visibility') IS NOT NULL THEN 'ok' ELSE 'fehler' END AS status,
    'facility_alert_visibility.' AS details
  UNION ALL
  SELECT 'RLS erzwungen',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_class
      WHERE oid = 'public.facility_alert_visibility'::regclass
        AND relrowsecurity IS TRUE
        AND relforcerowsecurity IS TRUE
    ) THEN 'ok' ELSE 'fehler' END,
    'FORCE ROW LEVEL SECURITY.'
  UNION ALL
  SELECT 'Kein UPDATE/DELETE-Grant',
    CASE WHEN NOT EXISTS (
      SELECT 1
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'facility_alert_visibility'
        AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
        AND grantee IN ('authenticated', 'anon', 'PUBLIC')
    ) THEN 'ok' ELSE 'fehler' END,
    'Nur SELECT und INSERT für authenticated.'
  UNION ALL
  SELECT 'Insert nur Leitung',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'facility_alert_visibility'
        AND policyname = 'facility_alert_visibility_insert'
        AND coalesce(with_check, '') ILIKE '%facility_manager%'
        AND coalesce(with_check, '') ILIKE '%company_admin%'
        AND coalesce(with_check, '') NOT ILIKE '%employee%'
        AND coalesce(with_check, '') NOT ILIKE '%technician%'
    ) THEN 'ok' ELSE 'fehler' END,
    'INSERT nennt facility_manager und company_admin.'
  UNION ALL
  SELECT 'Select für Betriebsmitglieder',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'facility_alert_visibility'
        AND policyname = 'facility_alert_visibility_select'
        AND coalesce(qual, '') ILIKE '%tageswerk_meter_role%'
    ) THEN 'ok' ELSE 'fehler' END,
    'Alle Betriebsmitglieder lesen den Ausblendstand.'
  UNION ALL
  SELECT 'Warnungstabellen unverändert',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.temperature_alerts'::regclass
        AND conname = 'temperature_alerts_status'
    ) AND EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.water_alerts'::regclass
        AND conname = 'water_alerts_status'
    ) THEN 'ok' ELSE 'fehler' END,
    'status bleibt open/acknowledged.'
  UNION ALL
  SELECT 'Stempel mit search_path',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'tageswerk_stamp_facility_alert_visibility'
        AND prosecdef IS FALSE
        AND (
          pg_get_functiondef(oid) ILIKE '%SET search_path TO '''
          OR pg_get_functiondef(oid) ILIKE '%SET search_path = '''
        )
    ) THEN 'ok' ELSE 'fehler' END,
    'Kein SECURITY DEFINER.'
  UNION ALL
  SELECT 'Transaktionssperre Hide/Restore',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'tageswerk_stamp_facility_alert_visibility'
        AND pg_get_functiondef(oid) ILIKE '%pg_advisory_xact_lock%'
        AND pg_get_functiondef(oid) ILIKE '%hashtextextended%'
    ) THEN 'ok' ELSE 'fehler' END,
    'Advisory-Lock serialisiert gleichzeitige Ereignisse derselben Warnung.'
) AS rows;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'facility_alert_visibility'
ORDER BY ordinal_position;
