-- Tageswerk 3.7.0, lesende Vorprüfung vor TEST-Ausführung der 3.7.0-Migrationen.
-- Nur pg_catalog / information_schema. Keine Tabelleninhalte, kein Schreibzugriff.
-- Nicht auf PROD ausführen.

SELECT pruefung, status, details
FROM (
  SELECT 10 AS ord, 'facilities vorhanden'::text AS pruefung,
    CASE WHEN to_regclass('public.facilities') IS NOT NULL THEN 'ok' ELSE 'fehler' END AS status,
    CASE WHEN to_regclass('public.facilities') IS NULL THEN 'Betriebstabelle fehlt.' ELSE 'Tabelle facilities ist vorhanden.' END AS details

  UNION ALL
  SELECT 20, 'tageswerk_create_facility',
    CASE WHEN to_regprocedure('public.tageswerk_create_facility(uuid,text)') IS NOT NULL THEN 'ok' ELSE 'offen' END,
    CASE WHEN to_regprocedure('public.tageswerk_create_facility(uuid,text)') IS NOT NULL
      THEN 'Funktion bereits vorhanden.'
      ELSE 'Funktion noch nicht installiert.'
    END

  UNION ALL
  SELECT 30, 'user_notice_acks',
    CASE WHEN to_regclass('public.user_notice_acks') IS NOT NULL THEN 'ok' ELSE 'offen' END,
    CASE WHEN to_regclass('public.user_notice_acks') IS NOT NULL THEN 'Quittungstabelle vorhanden.' ELSE 'Tabelle noch nicht installiert.' END

  UNION ALL
  SELECT 40, 'defect_photos',
    CASE WHEN to_regclass('public.defect_photos') IS NOT NULL THEN 'ok' ELSE 'offen' END,
    CASE WHEN to_regclass('public.defect_photos') IS NOT NULL THEN 'Fotometadaten vorhanden.' ELSE 'Tabelle noch nicht installiert.' END

  UNION ALL
  SELECT 50, 'facility_day_figure_imports',
    CASE WHEN to_regclass('public.facility_day_figure_imports') IS NOT NULL THEN 'ok' ELSE 'offen' END,
    CASE WHEN to_regclass('public.facility_day_figure_imports') IS NOT NULL THEN 'Importhistorie vorhanden.' ELSE '3.6.3-Importtabelle fehlt.' END

  UNION ALL
  SELECT 60, 'user_dashboard_layouts',
    CASE WHEN to_regclass('public.user_dashboard_layouts') IS NOT NULL THEN 'ok' ELSE 'offen' END,
    CASE WHEN to_regclass('public.user_dashboard_layouts') IS NOT NULL THEN 'Dashboard-Layouts vorhanden.' ELSE '3.6.3-Layouttabelle fehlt.' END

  UNION ALL
  SELECT 70, 'tageswerk_meter_role',
    CASE WHEN to_regprocedure('public.tageswerk_meter_role(uuid,uuid)') IS NOT NULL THEN 'ok' ELSE 'fehler' END,
    CASE WHEN to_regprocedure('public.tageswerk_meter_role(uuid,uuid)') IS NOT NULL
      THEN 'Rollenfunktion vorhanden.'
      ELSE 'tageswerk_meter_role fehlt.'
    END
) AS checks
ORDER BY ord;
