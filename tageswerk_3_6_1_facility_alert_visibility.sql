-- Tageswerk 3.6.1, betriebsweites Ausblenden von Grenzwertwarnungen
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Nicht wiederholbar.
-- Voraussetzung: public.temperature_alerts, public.water_alerts,
-- public.tageswerk_meter_role, public.tageswerk_bind_operation_facility.
-- Messwerte, Maßnahmen, Wiederholungsmessungen und der Warnungsstatus bleiben unverändert.
-- Keine Änderung an temperature_alerts oder water_alerts.

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.temperature_alerts') IS NULL OR to_regclass('public.water_alerts') IS NULL THEN
    RAISE EXCEPTION 'Grenzwertwarnungen sind nicht installiert.';
  END IF;
  IF to_regprocedure('public.tageswerk_meter_role(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'tageswerk_meter_role fehlt.';
  END IF;
  IF to_regprocedure('public.tageswerk_bind_operation_facility()') IS NULL THEN
    RAISE EXCEPTION 'tageswerk_bind_operation_facility fehlt.';
  END IF;
  IF to_regclass('public.facility_alert_visibility') IS NOT NULL THEN
    RAISE EXCEPTION 'Das betriebsweite Ausblenden ist bereits installiert. Diese Datei nicht erneut ausführen.';
  END IF;
END;
$guard$;

CREATE TABLE public.facility_alert_visibility (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  source text NOT NULL,
  alert_id uuid NOT NULL,
  action text NOT NULL,
  acted_by uuid NOT NULL DEFAULT auth.uid(),
  acted_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  bulk_days integer,
  CONSTRAINT facility_alert_visibility_source CHECK (source IN ('temperature', 'water')),
  CONSTRAINT facility_alert_visibility_action CHECK (action IN ('hide', 'restore')),
  CONSTRAINT facility_alert_visibility_bulk CHECK (
    bulk_days IS NULL
    OR (action = 'hide' AND bulk_days IN (7, 14, 30))
  )
);

CREATE INDEX facility_alert_visibility_alert
  ON public.facility_alert_visibility (facility_id, source, alert_id, acted_at DESC);

COMMENT ON TABLE public.facility_alert_visibility IS
  'Betriebsweite Sichtbarkeit von Grenzwertwarnungen. Der Warnungsstatus bleibt in temperature_alerts und water_alerts.';

CREATE OR REPLACE FUNCTION public.tageswerk_stamp_facility_alert_visibility()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  alert_org uuid;
  alert_fac uuid;
  measured timestamptz;
  latest public.facility_alert_visibility;
  role_name text;
BEGIN
  NEW.acted_by := auth.uid();
  NEW.acted_at := pg_catalog.now();
  NEW.source := btrim(coalesce(NEW.source, ''));
  NEW.action := btrim(coalesce(NEW.action, ''));
  IF NEW.alert_id IS NULL THEN
    RAISE EXCEPTION 'Die Warnung wurde nicht gefunden.';
  END IF;
  IF NEW.source IS DISTINCT FROM 'temperature' AND NEW.source IS DISTINCT FROM 'water' THEN
    RAISE EXCEPTION 'Unbekannte Warnungsquelle.';
  END IF;
  -- Serialisiert Hide und Restore derselben Warnung in der Transaktion.
  -- Die Ereignishistorie bleibt unveränderlich; es gibt keine Unique auf den aktuellen Stand.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.source || chr(31) || NEW.alert_id::text, 0)
  );
  role_name := public.tageswerk_meter_role(NEW.organization_id, NEW.facility_id);
  IF role_name IS DISTINCT FROM 'facility_manager' AND role_name IS DISTINCT FROM 'company_admin' THEN
    RAISE EXCEPTION 'Warnungen blendet die Betriebsleitung oder Geschäftsführung betriebsweit aus.';
  END IF;
  IF NEW.source = 'temperature' THEN
    SELECT alert.organization_id, alert.facility_id, reading.measured_at
      INTO alert_org, alert_fac, measured
    FROM public.temperature_alerts AS alert
    JOIN public.temperature_readings AS reading ON reading.id = alert.reading_id
    WHERE alert.id = NEW.alert_id;
  ELSIF NEW.source = 'water' THEN
    SELECT alert.organization_id, alert.facility_id, alert.measured_at
      INTO alert_org, alert_fac, measured
    FROM public.water_alerts AS alert
    WHERE alert.id = NEW.alert_id;
  ELSE
    RAISE EXCEPTION 'Unbekannte Warnungsquelle.';
  END IF;
  IF alert_org IS NULL OR alert_fac IS NULL THEN
    RAISE EXCEPTION 'Die Warnung wurde nicht gefunden.';
  END IF;
  IF NEW.facility_id IS DISTINCT FROM alert_fac OR NEW.organization_id IS DISTINCT FROM alert_org THEN
    RAISE EXCEPTION 'Die Ausblendung gehört zu einem anderen Betrieb.';
  END IF;
  IF NEW.action = 'restore' THEN
    NEW.bulk_days := NULL;
  END IF;
  IF NEW.bulk_days IS NOT NULL THEN
    IF measured IS NULL OR measured > pg_catalog.now() - pg_catalog.make_interval(days => NEW.bulk_days) THEN
      RAISE EXCEPTION 'Sammelausblendung gilt nur für Warnungen, die mindestens so alt sind.';
    END IF;
  END IF;
  SELECT * INTO latest
  FROM public.facility_alert_visibility AS event
  WHERE event.source = NEW.source
    AND event.alert_id = NEW.alert_id
    AND event.facility_id = NEW.facility_id
  ORDER BY event.acted_at DESC, event.id DESC
  LIMIT 1;
  IF NEW.action = 'hide' THEN
    IF latest.id IS NOT NULL AND latest.action = 'hide' THEN
      RAISE EXCEPTION 'Diese Warnung ist bereits ausgeblendet.';
    END IF;
  ELSIF NEW.action = 'restore' THEN
    IF latest.id IS NULL OR latest.action IS DISTINCT FROM 'hide' THEN
      RAISE EXCEPTION 'Diese Warnung ist nicht ausgeblendet.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unbekannte Sichtbarkeitsaktion.';
  END IF;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_protect_facility_alert_visibility()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  RAISE EXCEPTION 'Ausblendungen bleiben unverändert. Zum Wiederherstellen eine neue Wiederherstellung speichern.';
END;
$tageswerk$;

CREATE TRIGGER facility_alert_visibility_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.facility_alert_visibility
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();

CREATE TRIGGER facility_alert_visibility_stamp
  BEFORE INSERT ON public.facility_alert_visibility
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_stamp_facility_alert_visibility();

CREATE TRIGGER facility_alert_visibility_protect
  BEFORE UPDATE OR DELETE ON public.facility_alert_visibility
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_protect_facility_alert_visibility();

ALTER TABLE public.facility_alert_visibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_alert_visibility FORCE ROW LEVEL SECURITY;

CREATE POLICY facility_alert_visibility_select ON public.facility_alert_visibility FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);

CREATE POLICY facility_alert_visibility_insert ON public.facility_alert_visibility FOR INSERT TO authenticated
  WITH CHECK (
    acted_by = auth.uid()
    AND action IN ('hide', 'restore')
    AND public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager')
    AND (
      (
        source = 'temperature'
        AND EXISTS (
          SELECT 1
          FROM public.temperature_alerts AS alert
          WHERE alert.id = facility_alert_visibility.alert_id
            AND alert.facility_id = facility_alert_visibility.facility_id
            AND alert.organization_id = facility_alert_visibility.organization_id
        )
      )
      OR (
        source = 'water'
        AND EXISTS (
          SELECT 1
          FROM public.water_alerts AS alert
          WHERE alert.id = facility_alert_visibility.alert_id
            AND alert.facility_id = facility_alert_visibility.facility_id
            AND alert.organization_id = facility_alert_visibility.organization_id
        )
      )
    )
  );

REVOKE ALL ON TABLE public.facility_alert_visibility FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.facility_alert_visibility TO authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_stamp_facility_alert_visibility() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_protect_facility_alert_visibility() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_stamp_facility_alert_visibility() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_protect_facility_alert_visibility() TO authenticated;

COMMIT;
