-- Tageswerk 3.6.0, Wetter-Snapshot in Tagesberichten
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Speichert einen unveränderlichen Text zum Speicherzeitpunkt.
-- Rollback: Spalten entfernen, nachdem Clients die Felder nicht mehr schreiben.

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.daily_reports') IS NULL THEN
    RAISE EXCEPTION 'daily_reports fehlt.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'daily_reports' AND column_name = 'weather_summary'
  ) THEN
    RAISE EXCEPTION 'Wetterspalten sind bereits vorhanden. Diese Datei nicht erneut ausführen.';
  END IF;
END;
$guard$;

ALTER TABLE public.daily_reports
  ADD COLUMN weather_summary text NOT NULL DEFAULT '',
  ADD COLUMN weather_source text NOT NULL DEFAULT '',
  ADD COLUMN weather_observed_at timestamptz,
  ADD COLUMN weather_kind text NOT NULL DEFAULT '';

ALTER TABLE public.daily_reports
  ADD CONSTRAINT daily_reports_weather_summary_check CHECK (char_length(weather_summary) <= 1000),
  ADD CONSTRAINT daily_reports_weather_source_check CHECK (char_length(weather_source) <= 200),
  ADD CONSTRAINT daily_reports_weather_kind_check CHECK (weather_kind IN ('', 'forecast', 'observed'));

COMMENT ON COLUMN public.daily_reports.weather_summary IS 'Eingefrorener Wettertext zum Speicherzeitpunkt; ändert sich nicht nachträglich.';
COMMENT ON COLUMN public.daily_reports.weather_source IS 'Datenquelle des Snapshots, z. B. Open-Meteo.';
COMMENT ON COLUMN public.daily_reports.weather_kind IS 'forecast oder observed.';

COMMIT;
