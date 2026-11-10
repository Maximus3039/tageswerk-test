-- Tageswerk 3.2, Verwaltung der Temperaturmessstellen
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Voraussetzung: tageswerk_3_1_temperature.sql ist vollständig installiert.
-- Die Datei ist nicht wiederholbar. Ein zweiter Lauf setzt die Transaktion zurück.
-- Messwerte und Warnungen werden nicht umgeschrieben.
-- Eine Messstelle kann deaktiviert und wieder aktiviert, aber nicht gelöscht werden.

BEGIN;

ALTER TABLE public.temperature_points
  ADD COLUMN interval_unit text NOT NULL DEFAULT 'day',
  ADD COLUMN interval_count integer NOT NULL DEFAULT 1;

ALTER TABLE public.temperature_points
  ADD CONSTRAINT temperature_points_interval_unit CHECK (interval_unit IN ('day', 'week', 'month')),
  ADD CONSTRAINT temperature_points_interval_count CHECK (interval_count BETWEEN 1 AND 365);

CREATE OR REPLACE FUNCTION public.tageswerk_protect_temperature_point()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Messstellen werden nicht gelöscht, sondern deaktiviert.';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.facility_id IS DISTINCT FROM OLD.facility_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Die Zuordnung einer Messstelle bleibt unverändert.';
  END IF;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_protect_temperature_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  IF TG_TABLE_NAME = 'temperature_readings' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Gespeicherte Messwerte und Warnungen bleiben unverändert.';
  END IF;
  IF NEW.reading_id IS DISTINCT FROM OLD.reading_id
    OR NEW.point_id IS DISTINCT FROM OLD.point_id
    OR NEW.value_celsius IS DISTINCT FROM OLD.value_celsius
    OR NEW.minimum_celsius IS DISTINCT FROM OLD.minimum_celsius
    OR NEW.maximum_celsius IS DISTINCT FROM OLD.maximum_celsius
    OR NEW.facility_id IS DISTINCT FROM OLD.facility_id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'Gespeicherte Warnungen bleiben unverändert.';
  END IF;
  RETURN NEW;
END;
$tageswerk$;

CREATE TRIGGER temperature_points_protect
  BEFORE UPDATE OR DELETE ON public.temperature_points
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_protect_temperature_point();
CREATE TRIGGER temperature_readings_protect
  BEFORE UPDATE OR DELETE ON public.temperature_readings
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_protect_temperature_history();
CREATE TRIGGER temperature_alerts_protect
  BEFORE UPDATE OR DELETE ON public.temperature_alerts
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_protect_temperature_history();

CREATE POLICY temperature_points_update ON public.temperature_points FOR UPDATE TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager'))
  WITH CHECK (public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager'));

GRANT UPDATE ON TABLE public.temperature_points TO authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_protect_temperature_point() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_protect_temperature_history() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_protect_temperature_point() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_protect_temperature_history() TO authenticated;

COMMIT;
