-- Tageswerk 3.6.0, optionale Betriebsstandorte für Wetter
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Fügt latitude/longitude an facilities hinzu. Bestehende Zeilen bleiben gültig (NULL).
-- Rollback: Spalten wieder entfernen (nur wenn keine abhängigen Daten genutzt werden).

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.facilities') IS NULL THEN
    RAISE EXCEPTION 'facilities fehlt.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'facilities' AND column_name IN ('latitude', 'longitude')
  ) THEN
    RAISE EXCEPTION 'Koordinaten sind bereits vorhanden. Diese Datei nicht erneut ausführen.';
  END IF;
END;
$guard$;

ALTER TABLE public.facilities
  ADD COLUMN latitude double precision,
  ADD COLUMN longitude double precision;

ALTER TABLE public.facilities
  ADD CONSTRAINT facilities_latitude_check CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT facilities_longitude_check CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  ADD CONSTRAINT facilities_coordinates_pair CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude IS NOT NULL AND longitude IS NOT NULL)
  );

COMMENT ON COLUMN public.facilities.latitude IS 'Optionale geographische Breite für Wetter und Standortfunktionen.';
COMMENT ON COLUMN public.facilities.longitude IS 'Optionale geographische Länge für Wetter und Standortfunktionen.';

COMMIT;
