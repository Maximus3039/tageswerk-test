-- Tageswerk 3.7.0 TEST: Excel-Zuordnungen für den historischen Import.
-- NUR gamvnzggcrrlnyoknllu. Nicht auf PROD.
-- Kein tageswerk_commit_historical_import, keine Import-Batches.
-- Preview-RPC bleibt aus (SECURITY DEFINER / würde prepare_reading ersetzen).

BEGIN;

CREATE OR REPLACE FUNCTION public.tageswerk_import_medium_unit(
  p_art text,
  p_einheit text
)
RETURNS TABLE (medium text, unit text)
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $tageswerk$
  WITH folded AS (
    SELECT
      translate(
        btrim(p_art),
        'ÄÖÜäöüABCDEFGHIJKLMNOPQRSTUVWXYZ',
        'aouaouabcdefghijklmnopqrstuvwxyz'
      ) AS art,
      translate(
        btrim(p_einheit),
        'ÄÖÜäöü³ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        'aouaou3abcdefghijklmnopqrstuvwxyz'
      ) AS einheit
  )
  SELECT map.medium, map.unit
  FROM folded
  JOIN (
    VALUES
      ('wasser', 'm3', 'water', 'm3'),
      ('strom', 'kwh', 'electricity', 'kWh'),
      ('erdgas', 'm3', 'gas', 'm3'),
      ('erdgas', 'kwh', 'gas', 'kWh'),
      ('gas', 'm3', 'gas', 'm3'),
      ('gas', 'kwh', 'gas', 'kWh'),
      ('warme', 'kwh', 'heat', 'kWh'),
      ('warme', 'm3', 'heat', 'm3'),
      ('waerme', 'kwh', 'heat', 'kWh'),
      ('waerme', 'm3', 'heat', 'm3')
  ) AS map(art, einheit, medium, unit)
    ON map.art = folded.art
   AND map.einheit = folded.einheit;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_reject_import_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  RAISE EXCEPTION 'Importierte Herkunftsdaten werden nicht gelöscht.';
END;
$tageswerk$;

CREATE TABLE IF NOT EXISTS public.utility_meter_import_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  excel_schluessel text NOT NULL,
  excel_bezeichnung text NOT NULL,
  excel_verbrauchsart text NOT NULL,
  excel_einheit text NOT NULL,
  meter_id uuid NOT NULL REFERENCES public.utility_meters (id),
  altbestand_bestaetigt boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by uuid NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid,
  CONSTRAINT utility_meter_import_mappings_facility_org_fk
    FOREIGN KEY (facility_id, organization_id)
    REFERENCES public.facilities (id, organization_id),
  CONSTRAINT utility_meter_import_mappings_key_check
    CHECK (char_length(btrim(excel_schluessel)) BETWEEN 1 AND 200),
  CONSTRAINT utility_meter_import_mappings_label_check
    CHECK (char_length(btrim(excel_bezeichnung)) BETWEEN 1 AND 200),
  CONSTRAINT utility_meter_import_mappings_medium_check
    CHECK (char_length(btrim(excel_verbrauchsart)) BETWEEN 1 AND 50),
  CONSTRAINT utility_meter_import_mappings_unit_check
    CHECK (char_length(btrim(excel_einheit)) BETWEEN 1 AND 20),
  CONSTRAINT utility_meter_import_mappings_revoke_check CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS utility_meter_import_mappings_active_key
  ON public.utility_meter_import_mappings (facility_id, excel_schluessel)
  WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS utility_meter_import_mappings_active_meter
  ON public.utility_meter_import_mappings (meter_id)
  WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.tageswerk_prepare_import_mapping()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  v_meter public.utility_meters%ROWTYPE;
  v_medium text;
  v_unit text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Eine Anmeldung ist erforderlich.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'Eine aufgehobene Zählerzuordnung bleibt aufgehoben.';
    END IF;
    IF NEW.facility_id IS DISTINCT FROM OLD.facility_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.excel_schluessel IS DISTINCT FROM OLD.excel_schluessel
       OR NEW.excel_bezeichnung IS DISTINCT FROM OLD.excel_bezeichnung
       OR NEW.excel_verbrauchsart IS DISTINCT FROM OLD.excel_verbrauchsart
       OR NEW.excel_einheit IS DISTINCT FROM OLD.excel_einheit
       OR NEW.meter_id IS DISTINCT FROM OLD.meter_id
       OR NEW.altbestand_bestaetigt IS DISTINCT FROM OLD.altbestand_bestaetigt
       OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
       OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
      RAISE EXCEPTION 'Eine Zählerzuordnung kann nur aufgehoben werden.';
    END IF;
    IF NEW.revoked_at IS NULL THEN
      RAISE EXCEPTION 'Eine Zählerzuordnung kann nur aufgehoben werden.';
    END IF;
    IF public.tageswerk_meter_role(OLD.organization_id, OLD.facility_id)
         NOT IN ('company_admin', 'facility_manager') THEN
      RAISE EXCEPTION 'Historische Importe darf die Betriebsleitung oder Geschäftsführung.';
    END IF;
    NEW.revoked_at := now();
    NEW.revoked_by := auth.uid();
    RETURN NEW;
  END IF;

  SELECT * INTO v_meter
  FROM public.utility_meters
  WHERE id = NEW.meter_id;
  IF NOT FOUND OR v_meter.facility_id IS DISTINCT FROM NEW.facility_id THEN
    RAISE EXCEPTION 'Der Zähler gehört nicht zu diesem Betrieb.';
  END IF;
  NEW.organization_id := v_meter.organization_id;
  NEW.excel_schluessel := btrim(NEW.excel_schluessel);
  NEW.excel_bezeichnung := btrim(NEW.excel_bezeichnung);
  NEW.excel_verbrauchsart := btrim(NEW.excel_verbrauchsart);
  NEW.excel_einheit := btrim(NEW.excel_einheit);
  IF public.tageswerk_meter_role(NEW.organization_id, NEW.facility_id)
       NOT IN ('company_admin', 'facility_manager') THEN
    RAISE EXCEPTION 'Historische Importe darf die Betriebsleitung oder Geschäftsführung.';
  END IF;
  SELECT mapped.medium, mapped.unit
    INTO v_medium, v_unit
  FROM public.tageswerk_import_medium_unit(NEW.excel_verbrauchsart, NEW.excel_einheit) AS mapped;
  IF v_medium IS NULL THEN
    RAISE EXCEPTION 'Verbrauchsart oder Einheit lässt sich keinem Tageswerk-Zähler zuordnen.';
  END IF;
  IF v_meter.medium IS DISTINCT FROM v_medium OR v_meter.unit IS DISTINCT FROM v_unit THEN
    RAISE EXCEPTION 'Verbrauchsart oder Einheit passt nicht zum Zähler.';
  END IF;
  IF NEW.altbestand_bestaetigt IS TRUE AND v_meter.is_active IS TRUE THEN
    RAISE EXCEPTION 'Altbestand gilt nur für einen deaktivierten Zähler.';
  END IF;
  NEW.confirmed_by := auth.uid();
  NEW.confirmed_at := now();
  NEW.revoked_at := NULL;
  NEW.revoked_by := NULL;
  RETURN NEW;
END;
$tageswerk$;

DROP TRIGGER IF EXISTS utility_meter_import_mappings_prepare ON public.utility_meter_import_mappings;
CREATE TRIGGER utility_meter_import_mappings_prepare
  BEFORE INSERT OR UPDATE ON public.utility_meter_import_mappings
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_prepare_import_mapping();
DROP TRIGGER IF EXISTS utility_meter_import_mappings_no_delete ON public.utility_meter_import_mappings;
CREATE TRIGGER utility_meter_import_mappings_no_delete
  BEFORE DELETE ON public.utility_meter_import_mappings
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_reject_import_delete();

ALTER TABLE public.utility_meter_import_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_meter_import_mappings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS utility_meter_import_mappings_select ON public.utility_meter_import_mappings;
DROP POLICY IF EXISTS utility_meter_import_mappings_insert ON public.utility_meter_import_mappings;
DROP POLICY IF EXISTS utility_meter_import_mappings_update ON public.utility_meter_import_mappings;

CREATE POLICY utility_meter_import_mappings_select
  ON public.utility_meter_import_mappings
  FOR SELECT TO authenticated
  USING (
    public.tageswerk_meter_role(organization_id, facility_id)
      IN ('company_admin', 'facility_manager')
  );
CREATE POLICY utility_meter_import_mappings_insert
  ON public.utility_meter_import_mappings
  FOR INSERT TO authenticated
  WITH CHECK (
    public.tageswerk_meter_role(organization_id, facility_id)
      IN ('company_admin', 'facility_manager')
  );
CREATE POLICY utility_meter_import_mappings_update
  ON public.utility_meter_import_mappings
  FOR UPDATE TO authenticated
  USING (
    public.tageswerk_meter_role(organization_id, facility_id)
      IN ('company_admin', 'facility_manager')
  )
  WITH CHECK (
    public.tageswerk_meter_role(organization_id, facility_id)
      IN ('company_admin', 'facility_manager')
  );

REVOKE ALL ON TABLE public.utility_meter_import_mappings FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.utility_meter_import_mappings TO authenticated;

COMMIT;
