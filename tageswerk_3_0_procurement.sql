-- Tageswerk 3.0, Beschaffung
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Voraussetzung: public.tageswerk_bind_operation_facility aus tageswerk_3_0_daily_reports.sql.
-- Mitarbeiter melden Bedarf. Genehmigen und Ablehnen bleibt der Leitung vorbehalten.
--
-- INSERT-Policy (Mangel-Verknuepfung): Facility- UND Organization-Bindung
-- = produktiver Live-Stand nach D-PROC-01 / Phase 20.
-- Frueher schwacher Stand (nur facility_id, ohne organization_id) ist VERBOTEN.
-- Diese Datei NICHT erneut gegen eine bestehende Prod-DB ausfuehren, wenn die
-- Tabelle schon existiert (nicht idempotent). Policy-Nachzug: nur die
-- Freigabe-Vorlage sql-proposals/procurement_defect_link_policy-NICHT-AUSFUEHREN.sql
-- bzw. tests/integration/security/25-procurement-policy-TEST.sql (Test).

BEGIN;

CREATE TABLE public.procurement_requests (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  title text NOT NULL,
  quantity numeric(14,3) NOT NULL,
  unit text NOT NULL DEFAULT 'Stück',
  reason text NOT NULL,
  urgency text NOT NULL,
  status text NOT NULL DEFAULT 'submitted',
  defect_id uuid REFERENCES public.defects (id),
  requested_by uuid NOT NULL DEFAULT auth.uid(),
  requested_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text NOT NULL DEFAULT '',
  CONSTRAINT procurement_requests_title CHECK (char_length(btrim(title)) BETWEEN 1 AND 180),
  CONSTRAINT procurement_requests_quantity CHECK (quantity > 0),
  CONSTRAINT procurement_requests_reason CHECK (char_length(btrim(reason)) >= 3),
  CONSTRAINT procurement_requests_urgency CHECK (urgency IN ('low', 'normal', 'high', 'critical')),
  CONSTRAINT procurement_requests_status CHECK (status IN ('submitted', 'approved', 'rejected'))
);

CREATE OR REPLACE FUNCTION public.tageswerk_review_procurement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF public.tageswerk_meter_role(OLD.organization_id, OLD.facility_id) NOT IN ('company_admin', 'facility_manager') THEN
    RAISE EXCEPTION 'Freigeben darf die Betriebsleitung oder Geschäftsführung.';
  END IF;
  IF OLD.status <> 'submitted' OR NEW.status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Diese Anfrage wurde bereits entschieden.';
  END IF;
  IF char_length(btrim(NEW.review_note)) < 3 THEN
    RAISE EXCEPTION 'Bitte eine Begründung mit mindestens 3 Zeichen eintragen.';
  END IF;
  NEW.reviewed_by := auth.uid();
  NEW.reviewed_at := pg_catalog.now();
  RETURN NEW;
END;
$tageswerk$;

CREATE TRIGGER procurement_requests_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.procurement_requests
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();
CREATE TRIGGER procurement_requests_review
  BEFORE UPDATE OF status ON public.procurement_requests
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_review_procurement();

ALTER TABLE public.procurement_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY procurement_requests_select ON public.procurement_requests FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);
CREATE POLICY procurement_requests_insert ON public.procurement_requests FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND status = 'submitted'
    AND public.tageswerk_meter_role(
      procurement_requests.organization_id,
      procurement_requests.facility_id
    ) IS NOT NULL
    AND (
      procurement_requests.defect_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.defects AS defect
        WHERE defect.id = procurement_requests.defect_id
          AND defect.facility_id = procurement_requests.facility_id
          AND defect.organization_id = procurement_requests.organization_id
    OR (requested_by = auth.uid() AND status = 'submitted')
  )
  WITH CHECK (
    (
      public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager')
      AND status IN ('submitted', 'approved', 'rejected')
    )
    OR (requested_by = auth.uid() AND status = 'submitted' AND reviewed_by IS NULL)
  );

REVOKE ALL ON TABLE public.procurement_requests FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.procurement_requests TO authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_review_procurement() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_review_procurement() TO authenticated;

COMMIT;
