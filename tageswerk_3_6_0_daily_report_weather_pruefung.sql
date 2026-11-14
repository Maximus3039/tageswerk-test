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
  SELECT 'weather_source vorhanden',
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'daily_reports' AND column_name = 'weather_source'
    ) THEN 'ok' ELSE 'fehler' END,
    'Datenquelle.'
  UNION ALL
  SELECT 'weather_observed_at vorhanden',
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'daily_reports' AND column_name = 'weather_observed_at'
    ) THEN 'ok' ELSE 'fehler' END,
    'Zeitpunkt des Snapshots.'
  UNION ALL
  SELECT 'weather_kind begrenzt',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'daily_reports_weather_kind_check'
    ) THEN 'ok' ELSE 'fehler' END,
    'Nur forecast/observed/leer.'
  UNION ALL
  SELECT 'bestehende Berichte ohne Pflichtwetter',
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'daily_reports'
        AND column_name = 'weather_summary' AND column_default IS NOT NULL
    ) THEN 'ok' ELSE 'fehler' END,
    'Default leerer Snapshot für Altdaten.'
) AS rows;
