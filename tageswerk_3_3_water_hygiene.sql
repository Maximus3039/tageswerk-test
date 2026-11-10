-- Tageswerk 3.3, Wasserhygiene für Schwimmbecken
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Voraussetzung: public.tageswerk_meter_role, public.tageswerk_facility_organization
-- und public.tageswerk_bind_operation_facility.
-- Die Datei hängt nicht von den Temperaturmigrationen ab und ist nicht wiederholbar.
-- Ein zweiter Lauf setzt die Transaktion zurück.
-- Installationsreihenfolge, jeweils nur nach Freigabe und ohne Wiederholung:
-- 1. tageswerk_3_1_temperature.sql
-- 2. tageswerk_3_2_temperature_points.sql
-- 3. tageswerk_3_3_water_hygiene.sql
-- 4. tageswerk_3_4_technician_role.sql
-- 5. tageswerk_3_4_invitation_role.sql
-- Temperatur und Wasserhygiene sind voneinander unabhängig. Die Technikerrolle
-- kann vor dieser Datei laufen; danach setzt sie dieselben Leseregeln erneut.
-- Die Einladungsdatei hängt nicht vom Wasser ab.
-- Die Zahlen in water_parameter_definitions begrenzen nur die Erfassung.
-- Sie sind keine Sollwerte und keine normativen Grenzwerte.
-- Die reguläre Kontrollrunde umfasst Freies Chlor, gebundenes Chlor, den pH-Wert
-- und die Wassertemperatur. Weitere Parameter können später in den Katalog aufgenommen werden.
-- Mitarbeiter speichern neue Messungen. Die noch nicht bestätigte Runde liegt als
-- eigener Entwurf in water_round_drafts, je Benutzer und Betrieb höchstens einmal offen.
-- Mitarbeiter lesen und ändern nur ihren eigenen offenen Entwurf. Abgeschlossene und
-- verworfene Entwürfe sowie gespeicherte Messwerte bleiben für sie unsichtbar.
-- Techniker, Betriebsleitung und Geschäftsführung lesen die Messungen ihres
-- berechtigten Betriebs und führen eigene Entwürfe.
-- Abschluss bleibt SECURITY INVOKER. Er gilt nur, wenn dieselbe Transaktion die
-- Messungen geschrieben hat. Das prüft eine eng begrenzte Funktion am Transaktionskennzeichen
-- der Messzeile, nicht an einem setzbaren Konfigurationswert. Verwerfen schreibt eine
-- interne Markierung, auf die angemeldete Benutzer keinen Zugriff haben, und ändert
-- danach nur den eigenen offenen Entwurf. Die Richtlinien prüfen weiter Benutzer und Betrieb.
-- Techniker, Betriebsleitung und Geschäftsführung lesen die Messhistorie.
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
  round_id uuid,
  readings jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT water_checks_note CHECK (char_length(note) <= 2000),
  CONSTRAINT water_checks_readings CHECK (jsonb_typeof(readings) = 'array'),
  CONSTRAINT water_checks_round_pool UNIQUE (round_id, pool_id)
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

CREATE TABLE public.water_round_drafts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  round_id uuid NOT NULL,
  entries jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open',
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT water_round_drafts_status CHECK (status IN ('open', 'completed', 'discarded')),
  CONSTRAINT water_round_drafts_entries CHECK (jsonb_typeof(entries) = 'object' AND pg_catalog.octet_length(entries::text) <= 50000),
  CONSTRAINT water_round_drafts_progress CHECK (jsonb_typeof(progress) = 'object' AND pg_catalog.octet_length(progress::text) <= 2000),
  CONSTRAINT water_round_drafts_revision CHECK (revision >= 1)
);

CREATE UNIQUE INDEX water_round_drafts_one_open
  ON public.water_round_drafts (facility_id, user_id)
  WHERE status = 'open';
CREATE UNIQUE INDEX water_round_drafts_round
  ON public.water_round_drafts (round_id);

CREATE TABLE public.water_round_discards (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  round_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
REVOKE ALL ON TABLE public.water_round_discards FROM PUBLIC, anon, authenticated;

INSERT INTO public.water_parameter_definitions
  (code, name, unit, decimals, min_plausible, max_plausible, sort_order)
VALUES
  ('free_chlorine', 'Freies Chlor', 'mg/l', 2, 0, 20, 1),
  ('combined_chlorine', 'Gebundenes Chlor', 'mg/l', 2, 0, 20, 2),
  ('ph', 'pH-Wert', '', 2, 0, 14, 3),
  ('temperature', 'Wassertemperatur', '°C', 1, 0, 50, 4);

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
  reading_code text;
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
    reading_code := item->>'parameter_code';
    IF reading_code IS NULL OR reading_code = ANY (seen) THEN
      RAISE EXCEPTION 'Jeder Parameter darf nur einmal gemessen werden.';
    END IF;
    seen := seen || reading_code;
    BEGIN
      amount := (item->>'value')::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Bitte einen gültigen Messwert eintragen.';
    END;
    SELECT * INTO definition
    FROM public.water_parameter_definitions AS parameter_definition
    WHERE parameter_definition.code = reading_code
      AND parameter_definition.active IS TRUE;
    IF definition.code IS NULL THEN
      RAISE EXCEPTION 'Dieser Parameter ist nicht vorgesehen.';
    END IF;
    IF amount < definition.min_plausible OR amount > definition.max_plausible OR scale(amount) > definition.decimals THEN
      RAISE EXCEPTION 'Bitte den Messwert im vorgesehenen Format eintragen.';
    END IF;
    SELECT * INTO parameter
    FROM public.water_pool_parameters
    WHERE pool_id = pool.id AND parameter_code = reading_code AND active IS TRUE;
    IF parameter.id IS NULL THEN
      RAISE EXCEPTION 'Dieser Parameter ist für das Becken nicht vorgesehen.';
    END IF;
    canonical := canonical || jsonb_build_array(jsonb_build_object(
      'parameter_code', reading_code,
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

CREATE OR REPLACE FUNCTION public.tageswerk_stamp_water_round_draft()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  IF NEW.user_id IS DISTINCT FROM auth.uid() OR NEW.status IS DISTINCT FROM 'open' OR NEW.revision IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Ein neuer Entwurf gehört zum angemeldeten Benutzer und startet offen.';
  END IF;
  IF public.tageswerk_meter_role(NEW.organization_id, NEW.facility_id) IS NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung für diesen Betrieb.';
  END IF;
  NEW.created_at := pg_catalog.now();
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_water_round_checks_in_transaction(
  p_round_id uuid,
  p_facility_id uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
  SELECT EXISTS (
    SELECT 1
    FROM public.water_checks AS check_row
    WHERE check_row.round_id = p_round_id
      AND check_row.facility_id = p_facility_id
      AND check_row.recorded_by = auth.uid()
      AND check_row.xmin = pg_current_xact_id()::xid
      AND public.tageswerk_meter_role(check_row.organization_id, check_row.facility_id) IS NOT NULL
  );
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_water_round_discard_in_transaction(
  p_round_id uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
  SELECT EXISTS (
    SELECT 1
    FROM public.water_round_discards AS mark
    WHERE mark.round_id = p_round_id
      AND mark.user_id = auth.uid()
      AND mark.xmin = pg_current_xact_id()::xid
  );
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_guard_water_round_draft()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  IF OLD.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'Ein abgeschlossener oder verworfener Entwurf kann nicht mehr bearbeitet werden.';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.facility_id IS DISTINCT FROM OLD.facility_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.round_id IS DISTINCT FROM OLD.round_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Der Entwurf bleibt dem Benutzer und Betrieb zugeordnet.';
  END IF;
  IF NEW.revision IS DISTINCT FROM OLD.revision + 1 THEN
    RAISE EXCEPTION 'Der Entwurf wurde zwischenzeitlich geändert.';
  END IF;
  IF NEW.status = 'completed' AND NOT public.tageswerk_water_round_checks_in_transaction(NEW.round_id, NEW.facility_id) THEN
    RAISE EXCEPTION 'Der Entwurf wird nur über die vorgesehene Funktion abgeschlossen oder verworfen.';
  END IF;
  IF NEW.status = 'discarded' AND NOT public.tageswerk_water_round_discard_in_transaction(NEW.round_id) THEN
    RAISE EXCEPTION 'Der Entwurf wird nur über die vorgesehene Funktion abgeschlossen oder verworfen.';
  END IF;
  IF NEW.status IS NOT NULL AND NEW.status NOT IN ('open', 'completed', 'discarded') THEN
    RAISE EXCEPTION 'Der Entwurf wird nur über die vorgesehene Funktion abgeschlossen oder verworfen.';
  END IF;
  IF public.tageswerk_meter_role(NEW.organization_id, NEW.facility_id) IS NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung für diesen Betrieb.';
  END IF;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$tageswerk$;

CREATE TRIGGER water_round_drafts_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.water_round_drafts
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();
CREATE TRIGGER water_round_drafts_guard
  BEFORE UPDATE ON public.water_round_drafts
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_guard_water_round_draft();
CREATE TRIGGER water_round_drafts_stamp
  BEFORE INSERT ON public.water_round_drafts
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_stamp_water_round_draft();

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
ALTER TABLE public.water_round_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_round_drafts FORCE ROW LEVEL SECURITY;

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

CREATE OR REPLACE FUNCTION public.tageswerk_water_check_in_round(
  p_pool_id uuid,
  p_measured_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $tageswerk$
DECLARE
  v_mode text;
  v_count integer;
  v_today date;
  v_measured date;
BEGIN
  IF p_pool_id IS NULL OR p_measured_at IS NULL THEN
    RETURN false;
  END IF;
  SELECT pool.schedule_mode, pool.interval_count
    INTO v_mode, v_count
  FROM public.water_pools AS pool
  WHERE pool.id = p_pool_id;
  IF v_mode IS NULL THEN
    RETURN false;
  END IF;
  v_today := (pg_catalog.now() AT TIME ZONE 'Europe/Berlin')::date;
  v_measured := (p_measured_at AT TIME ZONE 'Europe/Berlin')::date;
  IF v_mode = 'weekly' THEN
    RETURN p_measured_at >= pg_catalog.now() - make_interval(days => greatest(v_count, 1) * 7);
  END IF;
  IF v_mode = 'daily' AND v_count > 1 THEN
    RETURN v_measured >= (v_today - (v_count - 1));
  END IF;
  RETURN v_measured = v_today;
END;
$tageswerk$;

CREATE POLICY water_checks_select ON public.water_checks FOR SELECT TO authenticated
  USING (
    public.tageswerk_meter_role(organization_id, facility_id) IN ('technician', 'facility_manager', 'company_admin')
  );
CREATE POLICY water_checks_insert ON public.water_checks FOR INSERT TO authenticated
  WITH CHECK (
    recorded_by = auth.uid()
    AND public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.water_pools AS pool
      WHERE pool.id = water_checks.pool_id
        AND pool.facility_id = water_checks.facility_id
        AND pool.active IS TRUE
    )
  );

CREATE POLICY water_alerts_select ON public.water_alerts FOR SELECT TO authenticated
  USING (
    public.tageswerk_meter_role(organization_id, facility_id) IN ('technician', 'facility_manager', 'company_admin')
  );
CREATE POLICY water_alerts_insert ON public.water_alerts FOR INSERT TO authenticated
  WITH CHECK (
    status = 'open'
    AND acknowledged_by IS NULL
    AND acknowledgement_note = ''
    AND recorded_by = auth.uid()
    AND public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL
    AND pg_catalog.pg_trigger_depth() > 0
  );
CREATE POLICY water_alerts_update ON public.water_alerts FOR UPDATE TO authenticated
  USING (
    status = 'open'
    AND public.tageswerk_meter_role(organization_id, facility_id) IN ('technician', 'facility_manager', 'company_admin')
  )
  WITH CHECK (
    status = 'acknowledged'
    AND acknowledged_by = auth.uid()
    AND char_length(btrim(acknowledgement_note)) >= 3
    AND public.tageswerk_meter_role(organization_id, facility_id) IN ('technician', 'facility_manager', 'company_admin')
  );

CREATE POLICY water_alert_measures_select ON public.water_alert_measures FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.water_alerts AS alert
      WHERE alert.id = water_alert_measures.alert_id
        AND alert.organization_id = water_alert_measures.organization_id
        AND alert.facility_id = water_alert_measures.facility_id
    )
  );
CREATE POLICY water_alert_measures_insert ON public.water_alert_measures FOR INSERT TO authenticated
  WITH CHECK (
    recorded_by = auth.uid()
    AND char_length(btrim(measure_text)) >= 3
    AND public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.water_alerts AS alert
      WHERE alert.id = water_alert_measures.alert_id
        AND alert.facility_id = water_alert_measures.facility_id
        AND alert.organization_id = water_alert_measures.organization_id
    )
  );

CREATE POLICY water_round_drafts_select ON public.water_round_drafts FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND status = 'open'
    AND public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL
  );
CREATE POLICY water_round_drafts_insert ON public.water_round_drafts FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'open'
    AND revision = 1
    AND public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL
  );
CREATE POLICY water_round_drafts_update ON public.water_round_drafts FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND status = 'open'
    AND public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL
  )
  WITH CHECK (
    user_id = auth.uid()
    AND public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL
    AND (
      status = 'open'
      OR (status = 'completed' AND public.tageswerk_water_round_checks_in_transaction(round_id, facility_id))
      OR (status = 'discarded' AND public.tageswerk_water_round_discard_in_transaction(round_id))
    )
  );

REVOKE ALL ON TABLE public.water_parameter_definitions FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.water_pools FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.water_pool_parameters FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.water_checks FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.water_alerts FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.water_alert_measures FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.water_round_drafts FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.water_parameter_definitions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.water_pools TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.water_pool_parameters TO authenticated;
GRANT SELECT, INSERT ON TABLE public.water_checks TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.water_alerts TO authenticated;
GRANT SELECT, INSERT ON TABLE public.water_alert_measures TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.water_round_drafts TO authenticated;

CREATE OR REPLACE FUNCTION public.tageswerk_save_water_round_draft(
  p_facility_id uuid,
  p_round_id uuid,
  p_entries jsonb,
  p_progress jsonb,
  p_revision integer
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  existing public.water_round_drafts%ROWTYPE;
  stored public.water_round_drafts%ROWTYPE;
  organization uuid;
  conflict_round uuid;
  conflict_revision integer;
BEGIN
  IF p_facility_id IS NULL OR p_round_id IS NULL
     OR jsonb_typeof(p_entries) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_progress) IS DISTINCT FROM 'object'
     OR pg_catalog.octet_length(p_entries::text) > 50000
     OR pg_catalog.octet_length(p_progress::text) > 2000 THEN
    RAISE EXCEPTION 'Der Entwurf ist unvollständig.';
  END IF;
  organization := public.tageswerk_facility_organization(p_facility_id);
  IF organization IS NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung für diesen Betrieb.';
  END IF;
  p_progress := pg_catalog.jsonb_build_object(
    'index', coalesce((p_progress->>'index')::integer, 0),
    'phase', CASE WHEN p_progress->>'phase' = 'summary' THEN 'summary' ELSE 'edit' END
  );
  SELECT * INTO existing
  FROM public.water_round_drafts
  WHERE facility_id = p_facility_id
    AND user_id = auth.uid()
    AND status = 'open'
  LIMIT 1;
  IF NOT FOUND THEN
    IF p_revision IS NOT NULL AND p_revision > 0 THEN
      RETURN pg_catalog.jsonb_build_object('status', 'conflict', 'round_id', p_round_id, 'revision', p_revision);
    END IF;
    BEGIN
      INSERT INTO public.water_round_drafts (organization_id, facility_id, user_id, round_id, entries, progress, status, revision)
      VALUES (organization, p_facility_id, auth.uid(), p_round_id, p_entries, p_progress, 'open', 1)
      RETURNING * INTO stored;
    EXCEPTION
      WHEN unique_violation THEN
        SELECT draft.round_id, draft.revision
        INTO conflict_round, conflict_revision
        FROM public.water_round_drafts AS draft
        WHERE draft.facility_id = p_facility_id
          AND draft.user_id = auth.uid()
          AND draft.status = 'open'
        LIMIT 1;
        RETURN pg_catalog.jsonb_build_object('status', 'conflict', 'round_id', coalesce(conflict_round, p_round_id), 'revision', conflict_revision);
    END;
    RETURN pg_catalog.jsonb_build_object('status', 'stored', 'round_id', stored.round_id, 'revision', stored.revision, 'updated_at', stored.updated_at);
  END IF;
  IF existing.round_id IS DISTINCT FROM p_round_id OR existing.revision IS DISTINCT FROM p_revision THEN
    RETURN pg_catalog.jsonb_build_object('status', 'conflict', 'round_id', existing.round_id, 'revision', existing.revision);
  END IF;
  UPDATE public.water_round_drafts
  SET entries = p_entries,
      progress = p_progress,
      revision = revision + 1
  WHERE id = existing.id
    AND user_id = auth.uid()
    AND status = 'open'
    AND revision = p_revision
  RETURNING * INTO stored;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'conflict', 'round_id', existing.round_id, 'revision', existing.revision);
  END IF;
  RETURN pg_catalog.jsonb_build_object('status', 'stored', 'round_id', stored.round_id, 'revision', stored.revision, 'updated_at', stored.updated_at);
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_record_water_round(
  p_round_id uuid,
  p_checks jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  item jsonb;
  facility uuid;
  pool uuid;
  seen uuid[] := ARRAY[]::uuid[];
  inserted uuid;
  ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_round_id IS NULL OR jsonb_typeof(p_checks) IS DISTINCT FROM 'array' OR jsonb_array_length(p_checks) < 1 OR jsonb_array_length(p_checks) > 30 THEN
    RAISE EXCEPTION 'Die Kontrollrunde ist unvollständig.';
  END IF;
  BEGIN
    FOR item IN SELECT value FROM jsonb_array_elements(p_checks) LOOP
      pool := (item->>'pool_id')::uuid;
      IF pool IS NULL OR pool = ANY (seen) THEN
        RAISE EXCEPTION 'Jedes Becken wird in der Kontrollrunde nur einmal gespeichert.';
      END IF;
      seen := seen || pool;
      IF facility IS NULL THEN
        facility := (item->>'facility_id')::uuid;
      ELSIF facility IS DISTINCT FROM (item->>'facility_id')::uuid THEN
        RAISE EXCEPTION 'Eine Kontrollrunde gehört zu einem Betrieb.';
      END IF;
      inserted := pg_catalog.gen_random_uuid();
      INSERT INTO public.water_checks (id, pool_id, facility_id, note, round_id, readings)
      VALUES (
        inserted,
        pool,
        facility,
        coalesce(item->>'note', ''),
        p_round_id,
        coalesce(item->'readings', '[]'::jsonb)
      );
      ids := ids || inserted;
    END LOOP;
    UPDATE public.water_round_drafts
    SET status = 'completed',
        revision = revision + 1
    WHERE round_id = p_round_id
      AND user_id = auth.uid()
      AND status = 'open';
  EXCEPTION
    WHEN unique_violation THEN
      IF SQLERRM NOT ILIKE '%water_checks_round_pool%' THEN
        RAISE;
      END IF;
      BEGIN
        UPDATE public.water_round_drafts
        SET status = 'completed',
            revision = revision + 1
        WHERE round_id = p_round_id
          AND user_id = auth.uid()
          AND status = 'open';
      EXCEPTION
        WHEN insufficient_privilege OR raise_exception THEN
          NULL;
      END;
      RETURN jsonb_build_object('status', 'already_stored', 'round_id', p_round_id);
  END;
  RETURN jsonb_build_object('status', 'stored', 'round_id', p_round_id, 'ids', to_jsonb(ids));
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_discard_water_round_draft(
  p_round_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  existing uuid;
  organization uuid;
  facility uuid;
BEGIN
  IF p_round_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Der Entwurf ist unvollständig.';
  END IF;
  SELECT id, organization_id, facility_id
  INTO existing, organization, facility
  FROM public.water_round_drafts
  WHERE round_id = p_round_id
    AND user_id = auth.uid()
    AND status = 'open'
  LIMIT 1;
  IF NOT FOUND OR public.tageswerk_meter_role(organization, facility) IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('status', 'absent', 'round_id', p_round_id);
  END IF;
  INSERT INTO public.water_round_discards (round_id, user_id)
  VALUES (p_round_id, auth.uid());
  UPDATE public.water_round_drafts
  SET status = 'discarded',
      revision = revision + 1
  WHERE id = existing
    AND user_id = auth.uid()
    AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Der Entwurf wurde nicht verworfen.';
  END IF;
  RETURN pg_catalog.jsonb_build_object('status', 'discarded', 'round_id', p_round_id);
END;
$tageswerk$;

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
REVOKE ALL ON FUNCTION public.tageswerk_water_check_in_round(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_record_water_round(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_save_water_round_draft(uuid, uuid, jsonb, jsonb, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_stamp_water_round_draft() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_guard_water_round_draft() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_discard_water_round_draft(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_water_round_checks_in_transaction(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_water_round_discard_in_transaction(uuid) FROM PUBLIC, anon;
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
GRANT EXECUTE ON FUNCTION public.tageswerk_water_check_in_round(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_record_water_round(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_save_water_round_draft(uuid, uuid, jsonb, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_stamp_water_round_draft() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_guard_water_round_draft() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_discard_water_round_draft(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_water_round_checks_in_transaction(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_water_round_discard_in_transaction(uuid) TO authenticated;

COMMIT;
