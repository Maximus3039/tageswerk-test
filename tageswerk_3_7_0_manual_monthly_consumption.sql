-- Tageswerk 3.7.0, manuelle Monatsverbräuche.
-- Nur vorbereiten. Nicht ohne ausdrückliche Freigabe ausführen.
-- Nicht auf PROD. Kein DROP bestehender Zähler oder Ablesungen.
-- Getrennt von utility_meter_readings. Kein tageswerk_commit_historical_import.
-- Voraussetzung: public.tageswerk_meter_role, public.tageswerk_bind_operation_facility,
-- public.tageswerk_facility_organization.

BEGIN;

CREATE TABLE IF NOT EXISTS public.utility_monthly_consumption (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  medium text NOT NULL,
  unit text NOT NULL,
  meter_id uuid REFERENCES public.utility_meters (id),
  year integer NOT NULL,
  month integer NOT NULL,
  consumption_value numeric(14, 3) NOT NULL,
  note text,
  recorded_by uuid NOT NULL DEFAULT auth.uid(),
  corrected_by uuid,
  correction_reason text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT utility_monthly_consumption_facility_org_fk
    FOREIGN KEY (facility_id, organization_id)
    REFERENCES public.facilities (id, organization_id),
  CONSTRAINT utility_monthly_consumption_medium_unit_check CHECK (
    (medium = 'electricity' AND unit = 'kWh')
    OR (medium = 'water' AND unit = 'm3')
    OR (medium IN ('gas', 'heat') AND unit IN ('kWh', 'm3'))
  ),
  CONSTRAINT utility_monthly_consumption_year_check CHECK (year BETWEEN 1990 AND 2100),
  CONSTRAINT utility_monthly_consumption_month_check CHECK (month BETWEEN 1 AND 12),
  CONSTRAINT utility_monthly_consumption_value_check CHECK (consumption_value >= 0),
  CONSTRAINT utility_monthly_consumption_note_check CHECK (
    note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 2000
  ),
  CONSTRAINT utility_monthly_consumption_correction_check CHECK (
    (
      corrected_by IS NULL
      AND correction_reason IS NULL
    )
    OR (
      corrected_by IS NOT NULL
      AND correction_reason IS NOT NULL
      AND char_length(btrim(correction_reason)) BETWEEN 3 AND 2000
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS utility_monthly_consumption_facility_month
  ON public.utility_monthly_consumption (facility_id, medium, unit, year, month)
  WHERE meter_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS utility_monthly_consumption_meter_month
  ON public.utility_monthly_consumption (meter_id, year, month)
  WHERE meter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS utility_monthly_consumption_facility_year
  ON public.utility_monthly_consumption (facility_id, year, medium);

CREATE OR REPLACE FUNCTION public.tageswerk_prepare_monthly_consumption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $tageswerk$
DECLARE
  v_org uuid;
  v_role text;
  v_medium text;
  v_unit text;
  v_facility uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.facility_id IS DISTINCT FROM OLD.facility_id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.medium IS DISTINCT FROM OLD.medium
    OR NEW.unit IS DISTINCT FROM OLD.unit
    OR NEW.meter_id IS DISTINCT FROM OLD.meter_id
    OR NEW.year IS DISTINCT FROM OLD.year
    OR NEW.month IS DISTINCT FROM OLD.month
  ) THEN
    RAISE EXCEPTION 'Bestehende Monatsverbräuche werden nicht auf einen anderen Zeitraum oder Zähler verschoben.';
  END IF;

  v_org := public.tageswerk_facility_organization(NEW.facility_id);
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Der Betrieb ist unbekannt.';
  END IF;
  NEW.organization_id := v_org;

  v_role := public.tageswerk_meter_role(NEW.organization_id, NEW.facility_id);
  IF v_role IS NULL OR v_role NOT IN ('company_admin', 'facility_manager') THEN
    RAISE EXCEPTION 'Historische Monatsverbräuche darf die Betriebsleitung oder Geschäftsführung.';
  END IF;

  IF NEW.meter_id IS NOT NULL THEN
    SELECT meter.facility_id, meter.medium, meter.unit
      INTO v_facility, v_medium, v_unit
    FROM public.utility_meters meter
    WHERE meter.id = NEW.meter_id;
    IF v_facility IS NULL THEN
      RAISE EXCEPTION 'Der Zähler ist unbekannt.';
    END IF;
    IF v_facility IS DISTINCT FROM NEW.facility_id THEN
      RAISE EXCEPTION 'Der Zähler gehört nicht zu diesem Betrieb.';
    END IF;
    IF v_medium IS DISTINCT FROM NEW.medium OR v_unit IS DISTINCT FROM NEW.unit THEN
      RAISE EXCEPTION 'Verbrauchsart und Einheit müssen zum Zähler passen.';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.recorded_by := auth.uid();
    NEW.corrected_by := NULL;
    NEW.correction_reason := NULL;
    NEW.created_at := pg_catalog.now();
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;

  NEW.recorded_by := OLD.recorded_by;
  NEW.created_at := OLD.created_at;
  IF NEW.consumption_value IS NOT DISTINCT FROM OLD.consumption_value
     AND NEW.note IS NOT DISTINCT FROM OLD.note THEN
    RAISE EXCEPTION 'Die Korrektur muss Verbrauch oder Kommentar ändern.';
  END IF;
  IF NEW.correction_reason IS NULL OR char_length(btrim(NEW.correction_reason)) < 3 THEN
    RAISE EXCEPTION 'Bitte einen Korrekturgrund mit mindestens 3 Zeichen angeben.';
  END IF;
  NEW.corrected_by := auth.uid();
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$tageswerk$;

DROP TRIGGER IF EXISTS utility_monthly_consumption_prepare ON public.utility_monthly_consumption;
CREATE TRIGGER utility_monthly_consumption_prepare
  BEFORE INSERT OR UPDATE ON public.utility_monthly_consumption
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_prepare_monthly_consumption();

DROP TRIGGER IF EXISTS utility_monthly_consumption_bind_facility ON public.utility_monthly_consumption;
CREATE TRIGGER utility_monthly_consumption_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.utility_monthly_consumption
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();

CREATE OR REPLACE FUNCTION public.tageswerk_reject_monthly_consumption_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $tageswerk$
BEGIN
  RAISE EXCEPTION 'Manuelle Monatsverbräuche werden nicht gelöscht.';
END;
$tageswerk$;

DROP TRIGGER IF EXISTS utility_monthly_consumption_no_delete ON public.utility_monthly_consumption;
CREATE TRIGGER utility_monthly_consumption_no_delete
  BEFORE DELETE ON public.utility_monthly_consumption
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_reject_monthly_consumption_delete();

ALTER TABLE public.utility_monthly_consumption ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_monthly_consumption FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS utility_monthly_consumption_select ON public.utility_monthly_consumption;
CREATE POLICY utility_monthly_consumption_select
  ON public.utility_monthly_consumption FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);

DROP POLICY IF EXISTS utility_monthly_consumption_insert ON public.utility_monthly_consumption;
CREATE POLICY utility_monthly_consumption_insert
  ON public.utility_monthly_consumption FOR INSERT TO authenticated
  WITH CHECK (
    public.tageswerk_meter_role(organization_id, facility_id)
      IN ('company_admin', 'facility_manager')
  );

DROP POLICY IF EXISTS utility_monthly_consumption_update ON public.utility_monthly_consumption;
CREATE POLICY utility_monthly_consumption_update
  ON public.utility_monthly_consumption FOR UPDATE TO authenticated
  USING (
    public.tageswerk_meter_role(organization_id, facility_id)
      IN ('company_admin', 'facility_manager')
  )
  WITH CHECK (
    public.tageswerk_meter_role(organization_id, facility_id)
      IN ('company_admin', 'facility_manager')
  );

REVOKE ALL ON TABLE public.utility_monthly_consumption FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.utility_monthly_consumption TO authenticated;

CREATE TABLE IF NOT EXISTS public.utility_monthly_consumption_revisions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  consumption_id uuid NOT NULL REFERENCES public.utility_monthly_consumption (id),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  previous_value numeric(14, 3) NOT NULL,
  previous_note text,
  new_value numeric(14, 3) NOT NULL,
  new_note text,
  correction_reason text NOT NULL,
  changed_by uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT utility_monthly_consumption_revisions_facility_org_fk
    FOREIGN KEY (facility_id, organization_id)
    REFERENCES public.facilities (id, organization_id),
  CONSTRAINT utility_monthly_consumption_revisions_reason_check CHECK (
    char_length(btrim(correction_reason)) BETWEEN 3 AND 2000
  )
);

CREATE INDEX IF NOT EXISTS utility_monthly_consumption_revisions_consumption
  ON public.utility_monthly_consumption_revisions (consumption_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.tageswerk_record_monthly_consumption_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $tageswerk$
BEGIN
  INSERT INTO public.utility_monthly_consumption_revisions (
    consumption_id,
    organization_id,
    facility_id,
    previous_value,
    previous_note,
    new_value,
    new_note,
    correction_reason,
    changed_by,
    changed_at
  ) VALUES (
    NEW.id,
    NEW.organization_id,
    NEW.facility_id,
    OLD.consumption_value,
    OLD.note,
    NEW.consumption_value,
    NEW.note,
    NEW.correction_reason,
    NEW.corrected_by,
    NEW.updated_at
  );
  RETURN NEW;
END;
$tageswerk$;

DROP TRIGGER IF EXISTS utility_monthly_consumption_revision ON public.utility_monthly_consumption;
CREATE TRIGGER utility_monthly_consumption_revision
  AFTER UPDATE ON public.utility_monthly_consumption
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_record_monthly_consumption_revision();

ALTER TABLE public.utility_monthly_consumption_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_monthly_consumption_revisions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS utility_monthly_consumption_revisions_select ON public.utility_monthly_consumption_revisions;
CREATE POLICY utility_monthly_consumption_revisions_select
  ON public.utility_monthly_consumption_revisions FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);

DROP POLICY IF EXISTS utility_monthly_consumption_revisions_insert ON public.utility_monthly_consumption_revisions;
CREATE POLICY utility_monthly_consumption_revisions_insert
  ON public.utility_monthly_consumption_revisions FOR INSERT TO authenticated
  WITH CHECK (
    public.tageswerk_meter_role(organization_id, facility_id)
      IN ('company_admin', 'facility_manager')
  );

REVOKE ALL ON TABLE public.utility_monthly_consumption_revisions FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.utility_monthly_consumption_revisions TO authenticated;

COMMIT;
