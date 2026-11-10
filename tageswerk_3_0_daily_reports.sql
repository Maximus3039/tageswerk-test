-- Tageswerk 3.0, Tagesberichte
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Voraussetzung: public.tageswerk_meter_role und public.tageswerk_facility_organization.
-- Die Datei sendet keine E-Mail. Sie stellt nur den Text einer Zusammenfassung bereit.

BEGIN;

CREATE OR REPLACE FUNCTION public.tageswerk_bind_operation_facility()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  org uuid;
BEGIN
  org := public.tageswerk_facility_organization(NEW.facility_id);
  IF org IS NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung für den Betrieb.';
  END IF;
  NEW.organization_id := org;
  RETURN NEW;
END;
$tageswerk$;

CREATE TABLE public.daily_reports (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  report_date date NOT NULL,
  incidents text NOT NULL DEFAULT '',
  handover text NOT NULL DEFAULT '',
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT daily_reports_text_present CHECK (char_length(btrim(incidents)) > 0 OR char_length(btrim(handover)) > 0),
  CONSTRAINT daily_reports_one_per_day UNIQUE (facility_id, report_date)
);

CREATE TABLE public.daily_report_revisions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.daily_reports (id),
  editor_id uuid NOT NULL DEFAULT auth.uid(),
  edited_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  incidents text NOT NULL,
  handover text NOT NULL,
  change_note text NOT NULL,
  CONSTRAINT daily_report_revisions_note CHECK (char_length(btrim(change_note)) >= 3)
);

CREATE TABLE public.daily_report_defects (
  report_id uuid NOT NULL REFERENCES public.daily_reports (id),
  defect_id uuid NOT NULL REFERENCES public.defects (id),
  PRIMARY KEY (report_id, defect_id)
);

CREATE OR REPLACE FUNCTION public.tageswerk_revise_daily_report()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  IF NEW.incidents IS NOT DISTINCT FROM OLD.incidents AND NEW.handover IS NOT DISTINCT FROM OLD.handover THEN
    RETURN NEW;
  END IF;
  IF char_length(btrim(coalesce(current_setting('tageswerk.change_note', true), ''))) < 3 THEN
    RAISE EXCEPTION 'Bitte den Grund der Änderung mit mindestens 3 Zeichen eintragen.';
  END IF;
  INSERT INTO public.daily_report_revisions (report_id, incidents, handover, change_note)
  VALUES (OLD.id, OLD.incidents, OLD.handover, btrim(current_setting('tageswerk.change_note', true)));
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$tageswerk$;

CREATE TRIGGER daily_reports_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();

CREATE TRIGGER daily_reports_revise
  BEFORE UPDATE OF incidents, handover ON public.daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_revise_daily_report();

CREATE OR REPLACE FUNCTION public.tageswerk_daily_report_summary(p_report_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $tageswerk$
  SELECT pg_catalog.jsonb_build_object(
    'send', false,
    'subject', 'Tagesbericht ' || report.report_date::text || ' · ' || facility.name,
    'body', 'Besondere Vorkommnisse:' || chr(10) || report.incidents || chr(10) || chr(10) || 'Hinweis für die nächste Schicht:' || chr(10) || report.handover
  )
  FROM public.daily_reports report
  JOIN public.facilities facility ON facility.id = report.facility_id
  WHERE report.id = p_report_id
    AND public.tageswerk_meter_role(report.organization_id, report.facility_id) IN ('company_admin', 'facility_manager');
$tageswerk$;

ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE public.daily_report_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_report_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.daily_report_defects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_report_defects FORCE ROW LEVEL SECURITY;

CREATE POLICY daily_reports_select ON public.daily_reports FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);
CREATE POLICY daily_reports_insert ON public.daily_reports FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);
CREATE POLICY daily_reports_update ON public.daily_reports FOR UPDATE TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL)
  WITH CHECK (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);

CREATE POLICY daily_report_revisions_select ON public.daily_report_revisions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.daily_reports report WHERE report.id = report_id AND public.tageswerk_meter_role(report.organization_id, report.facility_id) IS NOT NULL));
CREATE POLICY daily_report_revisions_insert ON public.daily_report_revisions FOR INSERT TO authenticated
  WITH CHECK (
    editor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.daily_reports report
      WHERE report.id = report_id
        AND public.tageswerk_meter_role(report.organization_id, report.facility_id) IS NOT NULL
    )
  );

CREATE POLICY daily_report_defects_select ON public.daily_report_defects FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.daily_reports report WHERE report.id = report_id AND public.tageswerk_meter_role(report.organization_id, report.facility_id) IS NOT NULL));
CREATE POLICY daily_report_defects_insert ON public.daily_report_defects FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public.daily_reports report
    JOIN public.defects defect ON defect.id = defect_id
    WHERE report.id = report_id
      AND defect.facility_id = report.facility_id
      AND public.tageswerk_meter_role(report.organization_id, report.facility_id) IS NOT NULL
  ));

CREATE OR REPLACE FUNCTION public.tageswerk_update_daily_report(
  p_report_id uuid,
  p_incidents text,
  p_handover text,
  p_change_note text
) RETURNS public.daily_reports
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $tageswerk$
DECLARE
  saved public.daily_reports;
BEGIN
  PERFORM pg_catalog.set_config('tageswerk.change_note', coalesce(p_change_note, ''), true);
  UPDATE public.daily_reports
  SET incidents = coalesce(p_incidents, ''),
      handover = coalesce(p_handover, '')
  WHERE id = p_report_id
  RETURNING * INTO saved;
  IF saved.id IS NULL THEN
    RAISE EXCEPTION 'Der Bericht wurde nicht gespeichert.';
  END IF;
  RETURN saved;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_link_daily_report_defect(
  p_report_id uuid,
  p_defect_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $tageswerk$
DECLARE
  report_facility uuid;
  defect_facility uuid;
BEGIN
  SELECT facility_id INTO report_facility FROM public.daily_reports WHERE id = p_report_id;
  SELECT facility_id INTO defect_facility FROM public.defects WHERE id = p_defect_id;
  IF report_facility IS NULL OR report_facility IS DISTINCT FROM defect_facility THEN
    RAISE EXCEPTION 'Der Mangel gehört zu einem anderen Betrieb.';
  END IF;
  INSERT INTO public.daily_report_defects (report_id, defect_id)
  VALUES (p_report_id, p_defect_id)
  ON CONFLICT DO NOTHING;
  RETURN pg_catalog.jsonb_build_object('id', p_report_id, 'defect_id', p_defect_id);
END;
$tageswerk$;

REVOKE ALL ON TABLE public.daily_reports FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.daily_report_revisions FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.daily_report_defects FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.daily_reports TO authenticated;
GRANT SELECT, INSERT ON TABLE public.daily_report_revisions TO authenticated;
GRANT SELECT, INSERT ON TABLE public.daily_report_defects TO authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_bind_operation_facility() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_revise_daily_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_bind_operation_facility() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_revise_daily_report() TO authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_daily_report_summary(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_update_daily_report(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_link_daily_report_defect(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_daily_report_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_update_daily_report(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_link_daily_report_defect(uuid, uuid) TO authenticated;

COMMIT;
