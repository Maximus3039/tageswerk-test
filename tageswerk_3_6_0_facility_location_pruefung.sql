-- Tageswerk 3.6.0, Nachprüfung Betriebsstandorte
-- Nur lesen.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'facilities'
  AND column_name IN ('latitude', 'longitude')
ORDER BY column_name;

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.facilities'::regclass
  AND (
    conname LIKE 'facilities_%lat%'
    OR conname LIKE 'facilities_%lon%'
    OR conname = 'facilities_coordinates_pair'
  );
