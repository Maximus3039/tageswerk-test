-- Tageswerk 3.3, Wasserhygiene für Schwimmbecken
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Voraussetzung: public.tageswerk_meter_role, public.tageswerk_facility_organization
-- und public.tageswerk_bind_operation_facility.
-- Die Datei hängt nicht von den Temperaturmigrationen ab und ist nicht wiederholbar.
-- Ein zweiter Lauf setzt die Transaktion zurück.
-- Die Zahlen in water_parameter_definitions begrenzen nur die Erfassung.
-- Sie sind keine Sollwerte und keine normativen Grenzwerte.
-- Sollbereiche bleiben leer, bis die Betriebsleitung sie je Becken setzt.
-- Messungen, damalige Sollbereiche und Warnwerte werden nicht umgeschrieben.
-- Eine Quittierung kennzeichnet die Abweichung nicht als behoben.
-- Becken und Parameter können deaktiviert, aber nicht gelöscht werden.

BEGIN;

CREATE OR REPLACE FUNCTION public.tageswerk_water_schedule_valid(
  mode text,
  count integer,
  times text[],
  days smallint[]
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $tageswerk$
DECLARE
  entry text;
  hour integer;
  minute integer;
BEGIN
  IF mode NOT IN ('daily', 'weekly', 'times') OR count IS NULL OR count < 1 OR count > 365 THEN
    RETURN false;
  END IF;
  IF days IS NULL OR cardinality(days) < 1 THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(days) AS day WHERE day < 1 OR day > 7) THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(days) AS day GROUP BY day HAVING count(*) > 1) THEN
    RETURN false;
  END IF;
  IF mode = 'times' THEN
    IF times IS NULL OR cardinality(times) < 1 OR cardinality(times) > 12 THEN
      RETURN false;
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(times) AS item GROUP BY item HAVING count(*) > 1) THEN
      RETURN false;
    END IF;
    FOREACH entry IN ARRAY times LOOP
      IF entry !~ '^\d{2}:\d{2}$' THEN
        RETURN false;
      END IF;
      hour := split_part(entry, ':', 1)::integer;
      minute := split_part(entry, ':', 2)::integer;
      IF hour > 23 OR minute > 59 THEN
        RETURN false;
      END IF;
    END LOOP;
  ELSIF cardinality(coalesce(times, ARRAY[]::text[])) <> 0 THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$tageswerk$;

CREATE TABLE public.water_parameter_definitions (
  code text PRIMARY KEY,
  name text NOT NULL,
  unit text NOT NULL DEFAULT '',
  decimals integer NOT NULL,
  min_plausible numeric(8,2) NOT NULL,
  max_plausible numeric(8,2) NOT NULL,
  sort_order integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  CONSTRAINT water_parameter_definitions_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT water_parameter_definitions_decimals CHECK (decimals BETWEEN 0 AND 3),
  CONSTRAINT water_parameter_definitions_range CHECK (min_plausible < max_plausible)
);

CREATE TABLE public.water_pools (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  schedule_mode text NOT NULL DEFAULT 'daily',
  interval_count integer NOT NULL DEFAULT 1,
  scheduled_times text[] NOT NULL DEFAULT ARRAY[]::text[],
  weekdays smallint[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[],
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT water_pools_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT water_pools_schedule CHECK (
    public.tageswerk_water_schedule_valid(schedule_mode, interval_count, scheduled_times, weekdays)
  )
);

CREATE TABLE public.water_pool_parameters (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  pool_id uuid NOT NULL REFERENCES public.water_pools (id),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  parameter_code text NOT NULL REFERENCES public.water_parameter_definitions (code),
  required boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  min_value numeric(8,2),
  max_value numeric(8,2),
  CONSTRAINT water_pool_parameters_once UNIQUE (pool_id, parameter_code),
  CONSTRAINT water_pool_parameters_range CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
);

CREATE TABLE public.water_checks (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  pool_id uuid NOT NULL REFERENCES public.water_pools (id),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  measured_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  recorded_by uuid NOT NULL DEFAULT auth.uid(),
  note text NOT NULL DEFAULT '',
  follow_up_alert_id uuid,
  readings jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT water_checks_note CHECK (char_length(note) <= 2000),
  CONSTRAINT water_checks_readings CHECK (jsonb_typeof(readings) = 'array')
);

CREATE TABLE public.water_alerts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  check_id uuid NOT NULL REFERENCES public.water_checks (id),
  pool_id uuid NOT NULL REFERENCES public.water_pools (id),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  parameter_code text NOT NULL,
  value_amount numeric(8,2) NOT NULL,
  min_value numeric(8,2),
  max_value numeric(8,2),
  unit text NOT NULL DEFAULT '',
  measured_at timestamptz NOT NULL,
  recorded_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'open',
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  acknowledgement_note text NOT NULL DEFAULT '',
  CONSTRAINT water_alerts_once UNIQUE (check_id, parameter_code),
  CONSTRAINT water_alerts_status CHECK (status IN ('open', 'acknowledged')),
  CONSTRAINT water_alerts_ack CHECK (
    (status = 'open' AND acknowledged_by IS NULL AND acknowledged_at IS NULL AND acknowledgement_note = '')
    OR (status = 'acknowledged' AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL AND char_length(btrim(acknowledgement_note)) >= 3)
  )
);

CREATE TABLE public.water_alert_measures (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES public.water_alerts (id),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  measure_text text NOT NULL,
  recorded_by uuid NOT NULL DEFAULT auth.uid(),
  recorded_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT water_alert_measures_text CHECK (char_length(btrim(measure_text)) BETWEEN 3 AND 2000)
);

CREATE INDEX water_checks_facility_measured ON public.water_checks (facility_id, measured_at DESC);
CREATE INDEX water_alerts_facility_status ON public.water_alerts (facility_id, status);

INSERT INTO public.water_parameter_definitions
  (code, name, unit, decimals, min_plausible, max_plausible, sort_order)
VALUES
  ('free_chlorine', 'Freies Chlor', 'mg/l', 2, 0, 20, 1),
  ('combined_chlorine', 'Gebundenes Chlor', 'mg/l', 2, 0, 20, 2),
  ('ph', 'pH-Wert', '', 2, 0, 14, 3),
  ('redox', 'Redoxspannung', 'mV', 0, -2000, 2000, 4),
  ('temperature', 'Wassertemperatur', '°C', 1, 0, 50, 5);

CREATE OR REPLACE FUNCTION public.tageswerk_normalize_water_pool()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  NEW.name := btrim(NEW.name);
  IF NEW.schedule_mode IS DISTINCT FROM 'times' THEN
    NEW.scheduled_times := ARRAY[]::text[];
    NEW.weekdays := ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[];
  ELSE
    NEW.interval_count := 1;
    NEW.scheduled_times := ARRAY(
      SELECT DISTINCT btrim(entry)
      FROM unnest(coalesce(NEW.scheduled_times, ARRAY[]::text[])) AS entry
      WHERE btrim(entry) <> ''
      ORDER BY 1
    );
    NEW.weekdays := ARRAY(
      SELECT DISTINCT entry
      FROM unnest(coalesce(NEW.weekdays, ARRAY[]::smallint[])) AS entry
      ORDER BY 1
    );
  END IF;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_protect_water_pool()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Becken werden nicht gelöscht, sondern deaktiviert.';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.facility_id IS DISTINCT FROM OLD.facility_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Die Zuordnung eines Beckens bleibt unverändert.';
  END IF;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_seed_water_parameters()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  INSERT INTO public.water_pool_parameters (
    pool_id, organization_id, facility_id, parameter_code, required, active
  )
  SELECT NEW.id, NEW.organization_id, NEW.facility_id, definition.code, true, true
  FROM public.water_parameter_definitions AS definition
  WHERE definition.active IS TRUE
  ORDER BY definition.sort_order, definition.code;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_guard_water_parameter()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  pool public.water_pools;
  definition public.water_parameter_definitions;
BEGIN
  SELECT * INTO pool FROM public.water_pools WHERE id = NEW.pool_id;
  IF pool.id IS NULL OR NEW.facility_id IS DISTINCT FROM pool.facility_id THEN
    RAISE EXCEPTION 'Der Parameter gehört zu einem anderen Betrieb.';
  END IF;
  SELECT * INTO definition FROM public.water_parameter_definitions WHERE code = NEW.parameter_code AND active IS TRUE;
  IF definition.code IS NULL THEN
    RAISE EXCEPTION 'Dieser Parameter ist nicht vorgesehen.';
  END IF;
  IF NEW.min_value IS NOT NULL AND (
    NEW.min_value < definition.min_plausible
    OR NEW.min_value > definition.max_plausible
    OR scale(NEW.min_value) > definition.decimals
  ) THEN
    RAISE EXCEPTION 'Bitte den Sollbereich im vorgesehenen Format eintragen.';
  END IF;
  IF NEW.max_value IS NOT NULL AND (
    NEW.max_value < definition.min_plausible
    OR NEW.max_value > definition.max_plausible
    OR scale(NEW.max_value) > definition.decimals
  ) THEN
    RAISE EXCEPTION 'Bitte den Sollbereich im vorgesehenen Format eintragen.';
  END IF;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_protect_water_parameter()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Parameter werden nicht gelöscht, sondern deaktiviert.';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.pool_id IS DISTINCT FROM OLD.pool_id
    OR NEW.parameter_code IS DISTINCT FROM OLD.parameter_code
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.facility_id IS DISTINCT FROM OLD.facility_id THEN
    RAISE EXCEPTION 'Die Zuordnung eines Parameters bleibt unverändert.';
  END IF;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_stamp_water_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  pool public.water_pools;
  item jsonb;
  code text;
  amount numeric;
  definition public.water_parameter_definitions;
  parameter public.water_pool_parameters;
  canonical jsonb := '[]'::jsonb;
  seen text[] := ARRAY[]::text[];
  required_code text;
BEGIN
  NEW.measured_at := pg_catalog.now();
  NEW.recorded_by := auth.uid();
  NEW.note := coalesce(NEW.note, '');
  SELECT * INTO pool FROM public.water_pools WHERE id = NEW.pool_id;
  IF pool.id IS NULL OR pool.active IS NOT TRUE THEN
    RAISE EXCEPTION 'Das Becken ist nicht aktiv.';
  END IF;
  IF NEW.facility_id IS DISTINCT FROM pool.facility_id THEN
    RAISE EXCEPTION 'Die Messung gehört zu einem anderen Betrieb.';
  END IF;
  IF NEW.follow_up_alert_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.water_alerts AS alert
    WHERE alert.id = NEW.follow_up_alert_id
      AND alert.pool_id = pool.id
      AND alert.facility_id = pool.facility_id
  ) THEN
    RAISE EXCEPTION 'Die Wiederholung gehört zu einer anderen Warnung.';
  END IF;
  IF jsonb_typeof(NEW.readings) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Bitte die Messwerte eintragen.';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.readings) LOOP
    code := item->>'parameter_code';
    IF code IS NULL OR code = ANY (seen) THEN
      RAISE EXCEPTION 'Jeder Parameter darf nur einmal gemessen werden.';
    END IF;
    seen := seen || code;
    BEGIN
      amount := (item->>'value')::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Bitte einen gültigen Messwert eintragen.';
    END;
    SELECT * INTO definition FROM public.water_parameter_definitions WHERE code = code AND active IS TRUE;
    IF definition.code IS NULL THEN
      RAISE EXCEPTION 'Dieser Parameter ist nicht vorgesehen.';
    END IF;
    IF amount < definition.min_plausible OR amount > definition.max_plausible OR scale(amount) > definition.decimals THEN
      RAISE EXCEPTION 'Bitte den Messwert im vorgesehenen Format eintragen.';
    END IF;
    SELECT * INTO parameter
    FROM public.water_pool_parameters
    WHERE pool_id = pool.id AND parameter_code = code AND active IS TRUE;
    IF parameter.id IS NULL THEN
      RAISE EXCEPTION 'Dieser Parameter ist für das Becken nicht vorgesehen.';
    END IF;
    canonical := canonical || jsonb_build_array(jsonb_build_object(
      'parameter_code', code,
      'value', amount,
      'unit', definition.unit,
      'min_limit', parameter.min_value,
      'max_limit', parameter.max_value
    ));
  END LOOP;
  FOR required_code IN
    SELECT parameter_code FROM public.water_pool_parameters
    WHERE pool_id = pool.id AND active IS TRUE AND required IS TRUE
  LOOP
    IF NOT required_code = ANY (seen) THEN
      RAISE EXCEPTION 'Bitte alle erforderlichen Messwerte eintragen.';
    END IF;
  END LOOP;
  IF cardinality(seen) = 0 THEN
    RAISE EXCEPTION 'Bitte mindestens einen Messwert eintragen.';
  END IF;
  NEW.readings := canonical;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_water_alert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  reading record;
BEGIN
  FOR reading IN
    SELECT *
    FROM jsonb_to_recordset(NEW.readings) AS item(
      parameter_code text,
      value numeric,
      unit text,
      min_limit numeric,
      max_limit numeric
    )
  LOOP
    IF (reading.min_limit IS NOT NULL AND reading.value < reading.min_limit)
      OR (reading.max_limit IS NOT NULL AND reading.value > reading.max_limit) THEN
      INSERT INTO public.water_alerts (
        check_id, pool_id, organization_id, facility_id, parameter_code,
        value_amount, min_value, max_value, unit, measured_at, recorded_by
      ) VALUES (
        NEW.id, NEW.pool_id, NEW.organization_id, NEW.facility_id, reading.parameter_code,
        reading.value, reading.min_limit, reading.max_limit, coalesce(reading.unit, ''),
        NEW.measured_at, NEW.recorded_by
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_protect_water_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  RAISE EXCEPTION 'Gespeicherte Hygienemessungen bleiben unverändert.';
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_acknowledge_water()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  IF OLD.status IS DISTINCT FROM 'open' OR NEW.status IS DISTINCT FROM 'acknowledged' THEN
    RAISE EXCEPTION 'Diese Warnung wurde bereits quittiert.';
  END IF;
  IF char_length(btrim(coalesce(NEW.acknowledgement_note, ''))) < 3 THEN
    RAISE EXCEPTION 'Bitte die Quittierung mit mindestens 3 Zeichen begründen.';
  END IF;
  NEW.acknowledged_by := auth.uid();
  NEW.acknowledged_at := pg_catalog.now();
  NEW.check_id := OLD.check_id;
  NEW.pool_id := OLD.pool_id;
  NEW.organization_id := OLD.organization_id;
  NEW.facility_id := OLD.facility_id;
  NEW.parameter_code := OLD.parameter_code;
  NEW.value_amount := OLD.value_amount;
  NEW.min_value := OLD.min_value;
  NEW.max_value := OLD.max_value;
  NEW.unit := OLD.unit;
  NEW.measured_at := OLD.measured_at;
  NEW.recorded_by := OLD.recorded_by;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_protect_water_alert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Gespeicherte Warnungen bleiben unverändert.';
  END IF;
  IF NEW.check_id IS DISTINCT FROM OLD.check_id
    OR NEW.pool_id IS DISTINCT FROM OLD.pool_id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.facility_id IS DISTINCT FROM OLD.facility_id
    OR NEW.parameter_code IS DISTINCT FROM OLD.parameter_code
    OR NEW.value_amount IS DISTINCT FROM OLD.value_amount
    OR NEW.min_value IS DISTINCT FROM OLD.min_value
    OR NEW.max_value IS DISTINCT FROM OLD.max_value
    OR NEW.unit IS DISTINCT FROM OLD.unit
    OR NEW.measured_at IS DISTINCT FROM OLD.measured_at
    OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by THEN
    RAISE EXCEPTION 'Gespeicherte Warnungen bleiben unverändert.';
  END IF;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_stamp_water_measure()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  alert public.water_alerts;
BEGIN
  NEW.recorded_by := auth.uid();
  NEW.recorded_at := pg_catalog.now();
  NEW.measure_text := btrim(coalesce(NEW.measure_text, ''));
  SELECT * INTO alert FROM public.water_alerts WHERE id = NEW.alert_id;
  IF alert.id IS NULL OR NEW.facility_id IS DISTINCT FROM alert.facility_id THEN
    RAISE EXCEPTION 'Die Maßnahme gehört zu einer anderen Warnung.';
  END IF;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_protect_water_measure()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  RAISE EXCEPTION 'Dokumentierte Maßnahmen bleiben unverändert.';
END;
$tageswerk$;

CREATE TRIGGER water_pools_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.water_pools
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();
CREATE TRIGGER water_pools_normalize
  BEFORE INSERT OR UPDATE ON public.water_pools
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_normalize_water_pool();
CREATE TRIGGER water_pools_protect
  BEFORE UPDATE OR DELETE ON public.water_pools
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_protect_water_pool();
CREATE TRIGGER water_pools_seed
  AFTER INSERT ON public.water_pools
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_seed_water_parameters();

CREATE TRIGGER water_pool_parameters_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.water_pool_parameters
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();
CREATE TRIGGER water_pool_parameters_guard
  BEFORE INSERT OR UPDATE ON public.water_pool_parameters
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_guard_water_parameter();
CREATE TRIGGER water_pool_parameters_protect
  BEFORE UPDATE OR DELETE ON public.water_pool_parameters
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_protect_water_parameter();

CREATE TRIGGER water_checks_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.water_checks
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();
CREATE TRIGGER water_checks_protect
  BEFORE UPDATE OR DELETE ON public.water_checks
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_protect_water_check();
CREATE TRIGGER water_checks_stamp
  BEFORE INSERT ON public.water_checks
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_stamp_water_check();
CREATE TRIGGER water_checks_alert
  AFTER INSERT ON public.water_checks
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_water_alert();

CREATE TRIGGER water_alerts_acknowledge
  BEFORE UPDATE ON public.water_alerts
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_acknowledge_water();
CREATE TRIGGER water_alerts_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.water_alerts
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();
CREATE TRIGGER water_alerts_protect
  BEFORE UPDATE OR DELETE ON public.water_alerts
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_protect_water_alert();

CREATE TRIGGER water_alert_measures_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.water_alert_measures
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();
CREATE TRIGGER water_alert_measures_protect
  BEFORE UPDATE OR DELETE ON public.water_alert_measures
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_protect_water_measure();
CREATE TRIGGER water_alert_measures_stamp
  BEFORE INSERT ON public.water_alert_measures
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_stamp_water_measure();

ALTER TABLE public.water_parameter_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_parameter_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.water_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_pools FORCE ROW LEVEL SECURITY;
ALTER TABLE public.water_pool_parameters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_pool_parameters FORCE ROW LEVEL SECURITY;
ALTER TABLE public.water_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_checks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.water_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_alerts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.water_alert_measures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_alert_measures FORCE ROW LEVEL SECURITY;

CREATE POLICY water_parameter_definitions_select ON public.water_parameter_definitions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY water_pools_select ON public.water_pools FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);
CREATE POLICY water_pools_insert ON public.water_pools FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager')
  );
CREATE POLICY water_pools_update ON public.water_pools FOR UPDATE TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager'))
  WITH CHECK (public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager'));

CREATE POLICY water_pool_parameters_select ON public.water_pool_parameters FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);
CREATE POLICY water_pool_parameters_insert ON public.water_pool_parameters FOR INSERT TO authenticated
  WITH CHECK (public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager'));
CREATE POLICY water_pool_parameters_update ON public.water_pool_parameters FOR UPDATE TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager'))
  WITH CHECK (public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager'));

CREATE POLICY water_checks_select ON public.water_checks FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);
CREATE POLICY water_checks_insert ON public.water_checks FOR INSERT TO authenticated
  WITH CHECK (
    recorded_by = auth.uid()
    AND public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.water_pools AS pool
      WHERE pool.id = pool_id AND pool.facility_id = facility_id AND pool.active IS TRUE
    )
  );

CREATE POLICY water_alerts_select ON public.water_alerts FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);
CREATE POLICY water_alerts_insert ON public.water_alerts FOR INSERT TO authenticated
  WITH CHECK (
    status = 'open'
    AND acknowledged_by IS NULL
    AND acknowledgement_note = ''
    AND public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.water_checks AS check_row
      CROSS JOIN LATERAL jsonb_to_recordset(check_row.readings) AS reading(
        parameter_code text,
        value numeric,
        unit text,
        min_limit numeric,
        max_limit numeric
      )
      WHERE check_row.id = check_id
        AND check_row.pool_id = water_alerts.pool_id
        AND check_row.facility_id = water_alerts.facility_id
        AND check_row.organization_id = water_alerts.organization_id
        AND check_row.measured_at = water_alerts.measured_at
        AND check_row.recorded_by = water_alerts.recorded_by
        AND reading.parameter_code = water_alerts.parameter_code
        AND reading.value = water_alerts.value_amount
        AND reading.min_limit IS NOT DISTINCT FROM water_alerts.min_value
        AND reading.max_limit IS NOT DISTINCT FROM water_alerts.max_value
        AND coalesce(reading.unit, '') = water_alerts.unit
        AND (
          (reading.min_limit IS NOT NULL AND reading.value < reading.min_limit)
          OR (reading.max_limit IS NOT NULL AND reading.value > reading.max_limit)
        )
    )
  );
CREATE POLICY water_alerts_update ON public.water_alerts FOR UPDATE TO authenticated
  USING (status = 'open' AND public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL)
  WITH CHECK (
    status = 'acknowledged'
    AND acknowledged_by = auth.uid()
    AND char_length(btrim(acknowledgement_note)) >= 3
    AND public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL
  );

CREATE POLICY water_alert_measures_select ON public.water_alert_measures FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);
CREATE POLICY water_alert_measures_insert ON public.water_alert_measures FOR INSERT TO authenticated
  WITH CHECK (
    recorded_by = auth.uid()
    AND char_length(btrim(measure_text)) >= 3
    AND public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.water_alerts AS alert
      WHERE alert.id = alert_id
        AND alert.facility_id = facility_id
        AND alert.organization_id = organization_id
    )
  );

REVOKE ALL ON TABLE public.water_parameter_definitions FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.water_pools FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.water_pool_parameters FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.water_checks FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.water_alerts FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.water_alert_measures FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.water_parameter_definitions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.water_pools TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.water_pool_parameters TO authenticated;
GRANT SELECT, INSERT ON TABLE public.water_checks TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.water_alerts TO authenticated;
GRANT SELECT, INSERT ON TABLE public.water_alert_measures TO authenticated;

REVOKE ALL ON FUNCTION public.tageswerk_water_schedule_valid(text, integer, text[], smallint[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_normalize_water_pool() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_protect_water_pool() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_seed_water_parameters() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_guard_water_parameter() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_protect_water_parameter() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_stamp_water_check() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_water_alert() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_protect_water_check() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_acknowledge_water() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_protect_water_alert() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_stamp_water_measure() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_protect_water_measure() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_water_schedule_valid(text, integer, text[], smallint[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_normalize_water_pool() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_protect_water_pool() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_seed_water_parameters() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_guard_water_parameter() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_protect_water_parameter() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_stamp_water_check() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_water_alert() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_protect_water_check() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_acknowledge_water() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_protect_water_alert() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_stamp_water_measure() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_protect_water_measure() TO authenticated;

COMMIT;
