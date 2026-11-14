-- Vorprüfung vor tageswerk_3_5_8_water_filter_extensions.sql
-- Ausschließlich lesend. Schreibt nichts. Ändert keine Policies.

SELECT sortierung, pruefung, status, details
FROM (
  SELECT 10 AS sortierung, 'Filterspülungen 3.5.8 installiert' AS pruefung,
    CASE
      WHEN to_regclass('public.water_filters') IS NOT NULL
       AND to_regclass('public.water_filter_flushes') IS NOT NULL
      THEN 'bereit' ELSE 'stoppen'
    END AS status,
    'Basistabellen müssen vorhanden sein.' AS details
  UNION ALL
  SELECT 20, 'Erweiterungstabellen noch nicht vorhanden',
    CASE
      WHEN to_regclass('public.water_filter_flush_corrections') IS NULL
       AND to_regclass('public.water_filter_status_events') IS NULL
       AND to_regclass('public.tageswerk_water_filter_caps') IS NULL
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Phase B1 ist nicht wiederholbar.'
  UNION ALL
  SELECT 30, 'Erweiterungsfunktionen noch nicht vorhanden',
    CASE
      WHEN to_regprocedure('public.tageswerk_correct_water_filter_flush(uuid,uuid,timestamptz,text,text)') IS NULL
       AND to_regprocedure('public.tageswerk_set_water_filter_active(uuid,boolean,text)') IS NULL
       AND to_regprocedure('public.tageswerk_water_filter_flush_effective(uuid)') IS NULL
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Korrektur-, Status- und Effective-Funktionen dürfen noch nicht existieren.'
  UNION ALL
  SELECT 40, 'tageswerk_meter_role',
    CASE
      WHEN to_regprocedure('public.tageswerk_meter_role(uuid,uuid)') IS NOT NULL
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Rollenprüfung für Leitung/Admin.'
  UNION ALL
  SELECT 50, 'Spülungen ohne Client-UPDATE/DELETE',
    CASE
      WHEN NOT has_table_privilege('authenticated', to_regclass('public.water_filter_flushes'), 'UPDATE')
       AND NOT has_table_privilege('authenticated', to_regclass('public.water_filter_flushes'), 'DELETE')
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Originale bleiben clientseitig unveränderlich.'
  UNION ALL
  SELECT 60, 'last_flushed-Spalten vorhanden',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.water_filters')
          AND attname = 'last_flushed_at' AND NOT attisdropped
      )
       AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.water_filters')
          AND attname = 'last_flushed_by' AND NOT attisdropped
      )
       AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.water_filters')
          AND attname = 'active' AND NOT attisdropped
      )
      THEN 'bereit' ELSE 'stoppen'
    END,
    'active und last_flushed_* werden weiterverwendet.'
) AS checks
ORDER BY sortierung;
