-- Tageswerk 3.6.0, Nachprüfung Betriebsstandorte
-- Nur lesen.

SELECT pruefung, status, details
FROM (
  SELECT 'latitude vorhanden' AS pruefung,
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'facilities' AND column_name = 'latitude'
    ) THEN 'ok' ELSE 'fehler' END AS status,
    'Geographische Breite.' AS details
  UNION ALL
  SELECT 'longitude vorhanden',
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'facilities' AND column_name = 'longitude'
    ) THEN 'ok' ELSE 'fehler' END,
    'Geographische Länge.'
  UNION ALL
  SELECT 'Koordinaten-Checks',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.facilities'::regclass
        AND conname = 'facilities_coordinates_pair'
    ) THEN 'ok' ELSE 'fehler' END,
    'Latitude/Longitude nur gemeinsam.'
  UNION ALL
  SELECT 'bestehende Betriebe unverändert lesbar',
    CASE WHEN to_regclass('public.facilities') IS NOT NULL THEN 'ok' ELSE 'fehler' END,
    'Additive Spalten, kein Datenverlust erwartet.'
) AS rows;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'facilities'
  AND column_name IN ('latitude', 'longitude')
ORDER BY column_name;
