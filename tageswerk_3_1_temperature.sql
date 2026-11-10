-- Tageswerk 3.1, Temperaturkontrollen
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Voraussetzung: public.tageswerk_meter_role, public.tageswerk_facility_organization
-- und public.tageswerk_bind_operation_facility.
-- Der Bestand der Messung bleibt in der Historie. Eine Grenzwertwarnung entsteht in der Datenbank.
-- Die Sitzungsprüfung für Betriebsleitung und Mitarbeiter aus Tageswerk 3.0 ist offen
-- und darf nicht als bestanden geführt werden.

BEGIN;

CREATE TABLE public.temperature_points (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  name text NOT NULL,
  location text NOT NULL,
  minimum_celsius numeric(5,1) NOT NULL,
  maximum_celsius numeric(5,1) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT temperature_points_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT temperature_points_location CHECK (char_length(btrim(location)) BETWEEN 1 AND 200),
  CONSTRAINT temperature_points_range CHECK (minimum_celsius <= maximum_celsius AND minimum_celsius >= -50 AND maximum_celsius <= 200)
);

CREATE TABLE public.temperature_readings (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  point_id uuid NOT NULL REFERENCES public.temperature_points (id),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  measured_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  value_celsius numeric(5,1) NOT NULL,
  recorded_by uuid NOT NULL DEFAULT auth.uid(),
  note text NOT NULL DEFAULT '',
  CONSTRAINT temperature_readings_value CHECK (value_celsius BETWEEN -50 AND 200),
  CONSTRAINT temperature_readings_note CHECK (char_length(note) <= 2000)
);

CREATE TABLE public.temperature_alerts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  reading_id uuid NOT NULL UNIQUE REFERENCES public.temperature_readings (id),
  point_id uuid NOT NULL REFERENCES public.temperature_points (id),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  value_celsius numeric(5,1) NOT NULL,
  minimum_celsius numeric(5,1) NOT NULL,
  maximum_celsius numeric(5,1) NOT NULL,
  status text NOT NULL DEFAULT 'open',
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  remark text NOT NULL DEFAULT '',
  CONSTRAINT temperature_alerts_status CHECK (status IN ('open', 'acknowledged')),
  CONSTRAINT temperature_alerts_ack CHECK (
    (status = 'open' AND acknowledged_by IS NULL AND acknowledged_at IS NULL)
    OR (status = 'acknowledged' AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL AND char_length(btrim(remark)) >= 3)
  )
);

CREATE OR REPLACE FUNCTION public.tageswerk_stamp_temperature_reading()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  NEW.measured_at := pg_catalog.now();
  NEW.recorded_by := auth.uid();
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_temperature_alert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  point public.temperature_points;
BEGIN
  SELECT * INTO point FROM public.temperature_points WHERE id = NEW.point_id;
  IF point.id IS NULL THEN
    RAISE EXCEPTION 'Die Messstelle wurde nicht gefunden.';
  END IF;
  IF NEW.facility_id IS DISTINCT FROM point.facility_id THEN
    RAISE EXCEPTION 'Die Messung gehört zu einem anderen Betrieb.';
  END IF;
  IF NEW.value_celsius < point.minimum_celsius OR NEW.value_celsius > point.maximum_celsius THEN
    INSERT INTO public.temperature_alerts (
      reading_id, point_id, organization_id, facility_id, value_celsius, minimum_celsius, maximum_celsius
    ) VALUES (
      NEW.id, point.id, NEW.organization_id, NEW.facility_id, NEW.value_celsius, point.minimum_celsius, point.maximum_celsius
    );
  END IF;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_acknowledge_temperature()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  -- Die Aktualisierung sperrt die Zeile. Eine zweite, gleichzeitige Quittierung
  -- sieht danach den bereits gesetzten Status und wird abgewiesen.
  IF OLD.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'Diese Warnung wurde bereits quittiert.';
  END IF;
  IF NEW.status = 'acknowledged' AND OLD.status = 'open' THEN
    IF char_length(btrim(coalesce(NEW.remark, ''))) < 3 THEN
      RAISE EXCEPTION 'Bitte die Quittierung mit mindestens 3 Zeichen begründen.';
    END IF;
    NEW.acknowledged_by := auth.uid();
    NEW.acknowledged_at := pg_catalog.now();
    NEW.value_celsius := OLD.value_celsius;
    NEW.minimum_celsius := OLD.minimum_celsius;
    NEW.maximum_celsius := OLD.maximum_celsius;
    NEW.reading_id := OLD.reading_id;
    NEW.point_id := OLD.point_id;
    NEW.facility_id := OLD.facility_id;
    NEW.organization_id := OLD.organization_id;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Diese Warnung wurde bereits quittiert.';
END;
$tageswerk$;

CREATE TRIGGER temperature_points_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.temperature_points
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();
CREATE TRIGGER temperature_readings_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.temperature_readings
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();
CREATE TRIGGER temperature_readings_stamp
  BEFORE INSERT ON public.temperature_readings
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_stamp_temperature_reading();
CREATE TRIGGER temperature_alerts_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.temperature_alerts
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();
CREATE TRIGGER temperature_readings_alert
  AFTER INSERT ON public.temperature_readings
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_temperature_alert();
CREATE TRIGGER temperature_alerts_acknowledge
  BEFORE UPDATE ON public.temperature_alerts
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_acknowledge_temperature();

ALTER TABLE public.temperature_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.temperature_points FORCE ROW LEVEL SECURITY;
ALTER TABLE public.temperature_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.temperature_readings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.temperature_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.temperature_alerts FORCE ROW LEVEL SECURITY;

CREATE POLICY temperature_points_select ON public.temperature_points FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);
CREATE POLICY temperature_points_insert ON public.temperature_points FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager')
  );

CREATE POLICY temperature_readings_select ON public.temperature_readings FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);
CREATE POLICY temperature_readings_insert ON public.temperature_readings FOR INSERT TO authenticated
  WITH CHECK (
    recorded_by = auth.uid()
    AND public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.temperature_points point
      WHERE point.id = temperature_readings.point_id
        AND point.facility_id = temperature_readings.facility_id
        AND point.active IS TRUE
    )
  );

CREATE POLICY temperature_alerts_select ON public.temperature_alerts FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);
CREATE POLICY temperature_alerts_insert ON public.temperature_alerts FOR INSERT TO authenticated
  WITH CHECK (
    status = 'open'
    AND acknowledged_by IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.temperature_readings reading
      JOIN public.temperature_points point ON point.id = reading.point_id
      WHERE reading.id = temperature_alerts.reading_id
        AND reading.facility_id = temperature_alerts.facility_id
        AND (reading.value_celsius < point.minimum_celsius OR reading.value_celsius > point.maximum_celsius)
        AND public.tageswerk_meter_role(temperature_alerts.organization_id, temperature_alerts.facility_id) IS NOT NULL
    )
  );
CREATE POLICY temperature_alerts_update ON public.temperature_alerts FOR UPDATE TO authenticated
  USING (status = 'open' AND public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL)
  WITH CHECK (
    status = 'acknowledged'
    AND acknowledged_by = auth.uid()
    AND char_length(btrim(remark)) >= 3
    AND public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL
  );

REVOKE ALL ON TABLE public.temperature_points FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.temperature_readings FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.temperature_alerts FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.temperature_points TO authenticated;
GRANT SELECT, INSERT ON TABLE public.temperature_readings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.temperature_alerts TO authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_stamp_temperature_reading() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_temperature_alert() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_acknowledge_temperature() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_stamp_temperature_reading() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_temperature_alert() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_acknowledge_temperature() TO authenticated;

COMMIT;
