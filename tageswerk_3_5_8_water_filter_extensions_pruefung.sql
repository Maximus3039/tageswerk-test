-- Lesende Kontrolle nach tageswerk_3_5_8_water_filter_extensions.sql
-- Schreibt nichts. Ändert keine Policies.

SELECT sortierung, pruefung, status, details
FROM (
  SELECT 10 AS sortierung, 'Korrektur- und Statushistorie vorhanden' AS pruefung,
    CASE
      WHEN to_regclass('public.water_filter_flush_corrections') IS NOT NULL
       AND to_regclass('public.water_filter_status_events') IS NOT NULL
      THEN 'bereit' ELSE 'stoppen'
    END AS status,
    'Beide Historientabellen sind installiert.' AS details
  UNION ALL
  SELECT 20, 'Funktionen Korrektur, Status, Effective, Refresh',
    CASE
      WHEN to_regprocedure('public.tageswerk_correct_water_filter_flush(uuid,uuid,timestamptz,text,text)') IS NOT NULL
       AND to_regprocedure('public.tageswerk_set_water_filter_active(uuid,boolean,text)') IS NOT NULL
       AND to_regprocedure('public.tageswerk_water_filter_flush_effective(uuid)') IS NOT NULL
       AND to_regprocedure('public.tageswerk_refresh_water_filter_last_flush(uuid)') IS NOT NULL
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Alle vorgesehenen Funktionen sind vorhanden.'
  UNION ALL
  SELECT 30, 'EXECUTE-Rechte',
    CASE
      WHEN has_function_privilege(
             'authenticated',
             'public.tageswerk_correct_water_filter_flush(uuid,uuid,timestamptz,text,text)',
             'EXECUTE'
           )
       AND has_function_privilege(
             'authenticated',
             'public.tageswerk_set_water_filter_active(uuid,boolean,text)',
             'EXECUTE'
           )
       AND has_function_privilege(
             'authenticated',
             'public.tageswerk_water_filter_flush_effective(uuid)',
             'EXECUTE'
           )
       AND NOT has_function_privilege(
             'authenticated',
             'public.tageswerk_refresh_water_filter_last_flush(uuid)',
             'EXECUTE'
           )
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Korrektur/Status/Effective erlaubt; Refresh nicht direkt.'
  UNION ALL
  SELECT 40, 'RLS Historieneinsicht',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'water_filter_flush_corrections'
          AND policyname = 'water_filter_flush_corrections_select'
      )
       AND EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'water_filter_status_events'
          AND policyname = 'water_filter_status_events_select'
      )
       AND NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('water_filter_flush_corrections', 'water_filter_status_events')
          AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
      )
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Select-Policies; kein Client-Schreiben.'
  UNION ALL
  SELECT 50, 'Keine Schreibrechte auf Historien und Spülungen',
    CASE
      WHEN NOT has_table_privilege('authenticated', to_regclass('public.water_filter_flushes'), 'UPDATE')
       AND NOT has_table_privilege('authenticated', to_regclass('public.water_filter_flushes'), 'DELETE')
       AND NOT has_table_privilege('authenticated', to_regclass('public.water_filter_flush_corrections'), 'INSERT')
       AND NOT has_table_privilege('authenticated', to_regclass('public.water_filter_status_events'), 'INSERT')
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Schreiben nur über SECURITY-DEFINER-Funktionen.'
  UNION ALL
  SELECT 60, 'Korrektur belässt Originale und verlangt Begründung',
    CASE
      WHEN position(
             $q$original_unchanged$q$
             IN pg_get_functiondef('public.tageswerk_correct_water_filter_flush(uuid,uuid,timestamptz,text,text)'::regprocedure)
           ) > 0
       AND position(
             $q$FOR UPDATE$q$
             IN pg_get_functiondef('public.tageswerk_correct_water_filter_flush(uuid,uuid,timestamptz,text,text)'::regprocedure)
           ) > 0
       AND position(
             $q$Begründung$q$
             IN pg_get_functiondef('public.tageswerk_correct_water_filter_flush(uuid,uuid,timestamptz,text,text)'::regprocedure)
           ) > 0
       AND position(
             $q$facility_manager$q$
             IN pg_get_functiondef('public.tageswerk_correct_water_filter_flush(uuid,uuid,timestamptz,text,text)'::regprocedure)
           ) > 0
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Revisionssichere Korrektur mit Sperre und Rollenprüfung.'
  UNION ALL
  SELECT 70, 'Statuswechsel nur über Funktion',
    CASE
      WHEN position(
             $q$water_filter_status_change$q$
             IN pg_get_functiondef('public.tageswerk_protect_water_filter()'::regprocedure)
           ) > 0
       AND position(
             $q$water_filter_status_events$q$
             IN pg_get_functiondef('public.tageswerk_set_water_filter_active(uuid,boolean,text)'::regprocedure)
           ) > 0
      THEN 'bereit' ELSE 'stoppen'
    END,
    'active-Wechsel protokolliert und geschützt.'
  UNION ALL
  SELECT 80, 'Schutz der Originale und Historieneinträge',
    CASE
      WHEN position(
             $q$gesondert protokolliert$q$
             IN pg_get_functiondef('public.tageswerk_protect_water_filter_flush()'::regprocedure)
           ) > 0
       AND position(
             $q$unveränderlich$q$
             IN pg_get_functiondef('public.tageswerk_protect_water_filter_flush_correction()'::regprocedure)
           ) > 0
       AND position(
             $q$unveränderlich$q$
             IN pg_get_functiondef('public.tageswerk_protect_water_filter_status_event()'::regprocedure)
           ) > 0
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Originale und Protokolle sind manipulationsgeschützt.'
) AS checks
ORDER BY sortierung;
