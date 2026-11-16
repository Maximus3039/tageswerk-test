-- Tageswerk 3.6.1, Nachzug: transaktionssichere Hide/Restore-Serialisierung
-- Nur ausführen, wenn facility_alert_visibility bereits installiert ist.
-- Wiederholbar (CREATE OR REPLACE). Keine Änderung an Warnungstabellen.
-- Nicht in der Produktivdatenbank ohne gesonderte Freigabe.

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.facility_alert_visibility') IS NULL THEN
    RAISE EXCEPTION 'facility_alert_visibility fehlt. Zuerst tageswerk_3_6_1_facility_alert_visibility.sql.';
  END IF;
  IF to_regprocedure('public.tageswerk_stamp_facility_alert_visibility()') IS NULL THEN
    RAISE EXCEPTION 'tageswerk_stamp_facility_alert_visibility fehlt.';
  END IF;
END;
$guard$;

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

REVOKE ALL ON FUNCTION public.tageswerk_stamp_facility_alert_visibility() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_stamp_facility_alert_visibility() TO authenticated;

COMMIT;
