-- Nachprüfung: Wetter-Snapshot in Tagesberichten
-- Ausschließlich lesend.

SELECT pruefung, status, details
FROM (
  SELECT 'weather_summary vorhanden' AS pruefung,
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'daily_reports' AND column_name = 'weather_summary'
    ) THEN 'ok' ELSE 'fehler' END AS status,
    'Snapshot-Spalte.' AS details
  UNION ALL
  SELECT 'weather_kind begrenzt',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'daily_reports_weather_kind_check'
    ) THEN 'ok' ELSE 'fehler' END,
    'Nur forecast/observed/leer.'
) AS rows;
