-- Lesende Kontrolle nach tageswerk_3_5_9_water_filter_flush_corrections.sql
-- Schreibt nichts. Ändert keine Policies.

SELECT sortierung, pruefung, status, details
FROM (
  SELECT 10 AS sortierung, 'Korrekturtabelle vorhanden' AS pruefung,
    CASE
      WHEN to_regclass('public.water_filter_flush_corrections') IS NOT NULL
      THEN 'bereit' ELSE 'stoppen'
    END AS status,
    'water_filter_flush_corrections ist installiert.' AS details
  UNION ALL
  SELECT 20, 'Korrekturkennzeichnung an Spülungen',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.water_filter_flushes')
          AND attname = 'corrected_at' AND NOT attisdropped
      )
       AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.water_filter_flushes')
          AND attname = 'corrected_by' AND NOT attisdropped
      )
       AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.water_filter_flushes')
          AND attname = 'correction_count' AND NOT attisdropped
      )
      THEN 'bereit' ELSE 'stoppen'
    END,
    'corrected_at, corrected_by, correction_count.'
  UNION ALL
  SELECT 30, 'Korrekturfunktion und Neuberechnung',
    CASE
      WHEN to_regprocedure('public.tageswerk_correct_water_filter_flush(uuid,uuid,timestamptz,text,text)') IS NOT NULL
       AND to_regprocedure('public.tageswerk_refresh_water_filter_last_flush(uuid)') IS NOT NULL
      THEN 'bereit' ELSE 'stoppen'
    END,
    'correct und refresh sind vorhanden.'
  UNION ALL
  SELECT 40, 'EXECUTE nur für Korrekturfunktion',
    CASE
      WHEN has_function_privilege(
             'authenticated',
             'public.tageswerk_correct_water_filter_flush(uuid,uuid,timestamptz,text,text)',
             'EXECUTE'
           )
       AND NOT has_function_privilege(
             'authenticated',
             'public.tageswerk_refresh_water_filter_last_flush(uuid)',
             'EXECUTE'
           )
      THEN 'bereit' ELSE 'stoppen'
    END,
    'authenticated darf korrigieren, nicht direkt neu berechnen.'
  UNION ALL
  SELECT 50, 'RLS Korrekturprotokoll',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'water_filter_flush_corrections'
          AND policyname = 'water_filter_flush_corrections_select'
      )
       AND NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'water_filter_flush_corrections'
          AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
      )
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Select für Historienrollen; kein Client-Schreiben.'
  UNION ALL
  SELECT 60, 'Keine UPDATE/DELETE-Rechte auf Spülungen und Korrekturen',
    CASE
      WHEN NOT has_table_privilege('authenticated', to_regclass('public.water_filter_flushes'), 'UPDATE')
       AND NOT has_table_privilege('authenticated', to_regclass('public.water_filter_flushes'), 'DELETE')
       AND NOT has_table_privilege('authenticated', to_regclass('public.water_filter_flush_corrections'), 'INSERT')
       AND NOT has_table_privilege('authenticated', to_regclass('public.water_filter_flush_corrections'), 'UPDATE')
       AND NOT has_table_privilege('authenticated', to_regclass('public.water_filter_flush_corrections'), 'DELETE')
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Clients korrigieren nur über die Funktion.'
  UNION ALL
  SELECT 70, 'Korrekturfunktion prüft Leitung/Admin und Begründung',
    CASE
      WHEN position(
             $q$facility_manager$q$
             IN pg_get_functiondef('public.tageswerk_correct_water_filter_flush(uuid,uuid,timestamptz,text,text)'::regprocedure)
           ) > 0
       AND position(
             $q$company_admin$q$
             IN pg_get_functiondef('public.tageswerk_correct_water_filter_flush(uuid,uuid,timestamptz,text,text)'::regprocedure)
           ) > 0
       AND position(
             $q$Begründung$q$
             IN pg_get_functiondef('public.tageswerk_correct_water_filter_flush(uuid,uuid,timestamptz,text,text)'::regprocedure)
           ) > 0
       AND position(
             $q$FOR UPDATE$q$
             IN pg_get_functiondef('public.tageswerk_correct_water_filter_flush(uuid,uuid,timestamptz,text,text)'::regprocedure)
           ) > 0
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Rollen, Begründung und Sperre gegen gleichzeitige Korrekturen.'
  UNION ALL
  SELECT 80, 'Schutztrigger blockieren unprotokollierte Änderungen',
    CASE
      WHEN position(
             $q$water_filter_flush_correction$q$
             IN pg_get_functiondef('public.tageswerk_protect_water_filter_flush()'::regprocedure)
           ) > 0
       AND position(
             $q$werden nicht gelöscht$q$
             IN pg_get_functiondef('public.tageswerk_protect_water_filter_flush()'::regprocedure)
           ) > 0
      THEN 'bereit' ELSE 'stoppen'
    END,
    'UPDATE nur mit Korrekturkennzeichen; DELETE verboten.'
) AS checks
ORDER BY sortierung;
