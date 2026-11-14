-- Lesende Kontrolle nach tageswerk_3_5_8_water_filter_flushes.sql.
-- Diese Abfrage schreibt nichts und ändert keine Betriebsdaten.
-- Sie darf erst nach der freigegebenen Installation im SQL-Editor laufen.

SELECT pruefung, status, details
FROM (
  SELECT 10 AS sortierung, 'Tabellen vorhanden' AS pruefung,
    CASE
      WHEN to_regclass('public.water_filters') IS NOT NULL
       AND to_regclass('public.water_filter_flushes') IS NOT NULL
      THEN 'bereit' ELSE 'stoppen'
    END AS status,
    'water_filters und water_filter_flushes müssen vorhanden sein.' AS details
  UNION ALL
  SELECT 20, 'Spalten water_filters',
    CASE
      WHEN filters.oid IS NOT NULL
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = filters.oid AND attname = 'organization_id' AND NOT attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = filters.oid AND attname = 'facility_id' AND NOT attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = filters.oid AND attname = 'pool_id' AND NOT attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = filters.oid AND attname = 'name' AND NOT attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = filters.oid AND attname = 'active' AND NOT attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = filters.oid AND attname = 'created_by' AND NOT attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = filters.oid AND attname = 'created_at' AND NOT attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = filters.oid AND attname = 'last_flushed_at' AND NOT attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = filters.oid AND attname = 'last_flushed_by' AND NOT attisdropped)
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Alle vorgesehenen Filterspalten sind vorhanden.'
  FROM (SELECT to_regclass('public.water_filters') AS oid) AS filters
  UNION ALL
  SELECT 30, 'Spalten water_filter_flushes',
    CASE
      WHEN flushes.oid IS NOT NULL
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = flushes.oid AND attname = 'filter_id' AND NOT attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = flushes.oid AND attname = 'pool_id' AND NOT attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = flushes.oid AND attname = 'flushed_at' AND NOT attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = flushes.oid AND attname = 'recorded_at' AND NOT attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = flushes.oid AND attname = 'recorded_by' AND NOT attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = flushes.oid AND attname = 'note' AND NOT attisdropped)
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Alle vorgesehenen Spülprotokollspalten sind vorhanden.'
  FROM (SELECT to_regclass('public.water_filter_flushes') AS oid) AS flushes
  UNION ALL
  SELECT 40, 'Eindeutige aktive Filterbezeichnung je Becken',
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relname = 'water_filters_pool_active_name'
          AND relation.relkind = 'i'
      ) THEN 'bereit' ELSE 'stoppen'
    END,
    'Partial Unique Index water_filters_pool_active_name ist vorhanden.'
  UNION ALL
  SELECT 50, 'Indizes Historie und Betrieb',
    CASE
      WHEN EXISTS (SELECT 1 FROM pg_class WHERE relname = 'water_filter_flushes_filter_flushed' AND relkind = 'i')
       AND EXISTS (SELECT 1 FROM pg_class WHERE relname = 'water_filter_flushes_facility_flushed' AND relkind = 'i')
       AND EXISTS (SELECT 1 FROM pg_class WHERE relname = 'water_filters_facility_pool' AND relkind = 'i')
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Indizes für Filter je Betrieb/Becken und Historie je Filter sind vorhanden.'
  UNION ALL
  SELECT 60, 'Trigger vorhanden',
    CASE
      WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'water_filters_bind_facility' AND NOT tgisinternal)
       AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'water_filters_normalize' AND NOT tgisinternal)
       AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'water_filters_protect' AND NOT tgisinternal)
       AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'water_filter_flushes_a_stamp' AND NOT tgisinternal)
       AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'water_filter_flushes_b_bind' AND NOT tgisinternal)
       AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'water_filter_flushes_protect' AND NOT tgisinternal)
       AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'water_filter_flushes_apply_last' AND NOT tgisinternal)
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Stamp vor Bind (a_stamp/b_bind), Protect und Last-Flush-Trigger sind vorhanden.'
  UNION ALL
  SELECT 70, 'Stamp prüft 24 Stunden und Zukunft',
    CASE
      WHEN stamp.oid IS NOT NULL
       AND position('interval ''24 hours''' IN pg_get_functiondef(stamp.oid)) > 0
       AND position('zukünftiger Spülzeitpunkt' IN pg_get_functiondef(stamp.oid)) > 0
       AND position('NEW.recorded_by := auth.uid()' IN pg_get_functiondef(stamp.oid)) > 0
       AND position('NEW.recorded_at := now_ts' IN pg_get_functiondef(stamp.oid)) > 0
       AND position('filter_row.active IS NOT TRUE' IN pg_get_functiondef(stamp.oid)) > 0
      THEN 'bereit' ELSE 'stoppen'
    END,
    'tageswerk_stamp_water_filter_flush setzt Erfasser/Erfassung und begrenzt flushed_at.'
  FROM (SELECT to_regprocedure('public.tageswerk_stamp_water_filter_flush()') AS oid) AS stamp_lookup
  LEFT JOIN pg_proc AS stamp ON stamp.oid = stamp_lookup.oid
  UNION ALL
  SELECT 80, 'Letzte Spülung deterministisch und gehärtet',
    CASE
      WHEN apply.oid IS NOT NULL
       AND apply.prosecdef IS TRUE
       AND position('ORDER BY flush_row.flushed_at DESC, flush_row.recorded_at DESC, flush_row.id DESC' IN pg_get_functiondef(apply.oid)) > 0
       AND position('TG_OP IS DISTINCT FROM ''INSERT''' IN pg_get_functiondef(apply.oid)) > 0
       AND position('TG_WHEN IS DISTINCT FROM ''AFTER''' IN pg_get_functiondef(apply.oid)) > 0
       AND protect.oid IS NOT NULL
       AND position('pg_trigger_depth() <= 1' IN pg_get_functiondef(protect.oid)) > 0
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Die letzte Spülung folgt flushed_at/recorded_at/id, nur AFTER INSERT, SECURITY DEFINER, gegen direkte Manipulation geschützt.'
  FROM (SELECT to_regprocedure('public.tageswerk_apply_water_filter_last_flush()') AS oid) AS apply_lookup
  CROSS JOIN (SELECT to_regprocedure('public.tageswerk_protect_water_filter()') AS oid) AS protect_lookup
  LEFT JOIN pg_proc AS apply ON apply.oid = apply_lookup.oid
  LEFT JOIN pg_proc AS protect ON protect.oid = protect_lookup.oid
  UNION ALL
  SELECT 85, 'Last-Flush-Funktion und Filter teilen den Eigentümer',
    CASE
      WHEN apply.oid IS NOT NULL
       AND filters.oid IS NOT NULL
       AND apply.proowner = filters.relowner
       AND apply.prosecdef IS TRUE
      THEN 'bereit' ELSE 'stoppen'
    END,
    'SECURITY DEFINER und gemeinsamer Eigentümer erlauben die Aktualisierung trotz FORCE RLS.'
  FROM (SELECT to_regprocedure('public.tageswerk_apply_water_filter_last_flush()') AS oid) AS apply_lookup
  LEFT JOIN pg_proc AS apply ON apply.oid = apply_lookup.oid
  LEFT JOIN pg_class AS filters ON filters.oid = to_regclass('public.water_filters')
  UNION ALL
  SELECT 88, 'Kein EXECUTE für authenticated auf Triggerfunktionen',
    CASE
      WHEN NOT has_function_privilege('authenticated', 'public.tageswerk_apply_water_filter_last_flush()', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.tageswerk_stamp_water_filter_flush()', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.tageswerk_normalize_water_filter()', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.tageswerk_protect_water_filter()', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.tageswerk_protect_water_filter_flush()', 'EXECUTE')
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Triggerfunktionen sind nicht direkt ausführbar.'
  UNION ALL
  SELECT 90, 'RLS erzwungen',
    CASE
      WHEN filters.relrowsecurity IS TRUE
       AND filters.relforcerowsecurity IS TRUE
       AND flushes.relrowsecurity IS TRUE
       AND flushes.relforcerowsecurity IS TRUE
      THEN 'bereit' ELSE 'stoppen'
    END,
    'RLS ist aktiv und erzwungen.'
  FROM pg_class AS filters
  JOIN pg_class AS flushes ON true
  WHERE filters.oid = to_regclass('public.water_filters')
    AND flushes.oid = to_regclass('public.water_filter_flushes')
  UNION ALL
  SELECT 100, 'RLS-Policies Filter und Historie',
    CASE
      WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'water_filters' AND policyname = 'water_filters_select')
       AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'water_filters' AND policyname = 'water_filters_insert')
       AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'water_filters' AND policyname = 'water_filters_update')
       AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'water_filter_flushes' AND policyname = 'water_filter_flushes_select')
       AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'water_filter_flushes' AND policyname = 'water_filter_flushes_insert')
       AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'water_filter_flushes' AND cmd = 'UPDATE')
       AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'water_filter_flushes' AND cmd = 'DELETE')
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Select/Insert/Update für Filter; Select/Insert ohne Update/Delete für Spülungen.'
  UNION ALL
  SELECT 110, 'Mitarbeiter ohne Historie, Leitung ohne Mitarbeiter-Verwaltungslücke',
    CASE
      -- pg_policies speichert IN-Listen oft als = ANY (ARRAY[…]); keine exakte Komma-Kette verlangen.
      WHEN coalesce(flush_select.qual, '') ILIKE '%technician%'
       AND coalesce(flush_select.qual, '') ILIKE '%facility_manager%'
       AND coalesce(flush_select.qual, '') ILIKE '%company_admin%'
       AND coalesce(flush_select.qual, '') NOT ILIKE '%employee%'
       AND coalesce(filter_select.qual, '') ILIKE '%employee%'
       AND (
         coalesce(filter_select.qual, '') ILIKE '%active IS TRUE%'
         OR coalesce(filter_select.qual, '') ILIKE '%active = true%'
       )
       AND coalesce(filter_insert.with_check, '') ILIKE '%company_admin%'
       AND coalesce(filter_insert.with_check, '') ILIKE '%facility_manager%'
       AND coalesce(filter_insert.with_check, '') NOT ILIKE '%technician%'
       AND coalesce(filter_insert.with_check, '') !~* $$=\s*'employee'|ANY\s*\(.*'employee'$$
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Historie nur Techniker/Leitung/Admin; Mitarbeiter nur aktive Filter; Verwaltung nur Leitung/Admin.'
  FROM (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'water_filter_flushes' AND policyname = 'water_filter_flushes_select') AS flush_select
  CROSS JOIN (SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'water_filters' AND policyname = 'water_filters_select') AS filter_select
  CROSS JOIN (SELECT with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'water_filters' AND policyname = 'water_filters_insert') AS filter_insert
  UNION ALL
  SELECT 120, 'Keine UPDATE/DELETE-Rechte auf Spülungen',
    CASE
      WHEN NOT has_table_privilege('authenticated', to_regclass('public.water_filter_flushes'), 'UPDATE')
       AND NOT has_table_privilege('authenticated', to_regclass('public.water_filter_flushes'), 'DELETE')
       AND has_table_privilege('authenticated', to_regclass('public.water_filter_flushes'), 'INSERT')
       AND has_table_privilege('authenticated', to_regclass('public.water_filter_flushes'), 'SELECT')
      THEN 'bereit' ELSE 'stoppen'
    END,
    'authenticated darf Spülungen lesen und einfügen, nicht ändern oder löschen.'
  UNION ALL
  SELECT 130, 'Anon ohne Zugriff',
    CASE
      WHEN NOT coalesce(has_table_privilege('anon', to_regclass('public.water_filters'), 'SELECT'), false)
       AND NOT coalesce(has_table_privilege('anon', to_regclass('public.water_filter_flushes'), 'SELECT'), false)
      THEN 'bereit' ELSE 'stoppen'
    END,
    'anon hat keinen Tabellenzugriff.'
) AS checks
ORDER BY sortierung;
