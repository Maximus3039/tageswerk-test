-- Vorprüfung vor tageswerk_3_5_9_water_filter_flush_corrections.sql
-- Ausschließlich lesend. Schreibt nichts. Ändert keine Policies.

SELECT sortierung, pruefung, status, details
FROM (
  SELECT 10 AS sortierung, 'Filterspülungen installiert' AS pruefung,
    CASE
      WHEN to_regclass('public.water_filters') IS NOT NULL
       AND to_regclass('public.water_filter_flushes') IS NOT NULL
      THEN 'bereit' ELSE 'stoppen'
    END AS status,
    '3.5.8 muss installiert sein.' AS details
  UNION ALL
  SELECT 20, 'Korrekturtabelle noch nicht vorhanden',
    CASE
      WHEN to_regclass('public.water_filter_flush_corrections') IS NULL
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Diese Migration ist nicht wiederholbar.'
  UNION ALL
  SELECT 30, 'Korrekturfunktion noch nicht vorhanden',
    CASE
      WHEN to_regprocedure('public.tageswerk_correct_water_filter_flush(uuid,uuid,timestamptz,text,text)') IS NULL
      THEN 'bereit' ELSE 'stoppen'
    END,
    'tageswerk_correct_water_filter_flush darf noch nicht existieren.'
  UNION ALL
  SELECT 40, 'tageswerk_meter_role',
    CASE
      WHEN to_regprocedure('public.tageswerk_meter_role(uuid,uuid)') IS NOT NULL
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Rollenprüfung für Leitung/Admin.'
  UNION ALL
  SELECT 50, 'Spülungen ohne UPDATE-Recht für authenticated',
    CASE
      WHEN NOT has_table_privilege('authenticated', to_regclass('public.water_filter_flushes'), 'UPDATE')
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Korrekturen dürfen nicht über direkte UPDATEs laufen.'
) AS checks
ORDER BY sortierung;
