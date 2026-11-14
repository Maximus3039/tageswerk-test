-- Vorprüfung: Wetter-Snapshot in Tagesberichten 3.6.0
-- Ausschließlich lesend.

SELECT pruefung, status, details
FROM (
  SELECT 'daily_reports vorhanden' AS pruefung,
    CASE WHEN to_regclass('public.daily_reports') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END AS status,
    'Ziel-Tabelle für eingefrorene Wettertexte.' AS details
  UNION ALL
  SELECT 'Wetterspalten noch nicht vorhanden',
    CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'daily_reports' AND column_name = 'weather_summary'
      )
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Migration ist nicht wiederholbar.'
) AS rows;
