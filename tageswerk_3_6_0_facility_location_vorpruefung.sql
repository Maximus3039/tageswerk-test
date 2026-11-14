-- Vorprüfung: Betriebsstandorte für Wetter 3.6.0
-- Ausschließlich lesend. Nicht ausführen ohne Freigabe der Folgemigration.

SELECT pruefung, status, details
FROM (
  SELECT 'facilities vorhanden' AS pruefung,
    CASE WHEN to_regclass('public.facilities') IS NOT NULL THEN 'bereit' ELSE 'stoppen' END AS status,
    'Ziel-Tabelle für optionale Koordinaten.' AS details
  UNION ALL
  SELECT 'Koordinaten noch nicht vorhanden',
    CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'facilities' AND column_name = 'latitude'
      )
       AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'facilities' AND column_name = 'longitude'
      )
      THEN 'bereit' ELSE 'stoppen'
    END,
    'Migration ist nicht wiederholbar.'
) AS rows;
