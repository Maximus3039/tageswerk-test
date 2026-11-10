-- Tageswerk 3.0, Kontrollgänge
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Voraussetzung: public.tageswerk_meter_role, public.tageswerk_facility_organization
-- und public.tageswerk_bind_operation_facility aus tageswerk_3_0_daily_reports.sql.

BEGIN;

CREATE TABLE public.inspection_templates (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  name text NOT NULL,
  interval_count integer NOT NULL,
  interval_unit text NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT inspection_templates_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT inspection_templates_interval CHECK (interval_count BETWEEN 1 AND 365 AND interval_unit IN ('day', 'week', 'month'))
);

CREATE TABLE public.inspection_points (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.inspection_templates (id),
  label text NOT NULL,
  sort_order integer NOT NULL,
  CONSTRAINT inspection_points_label CHECK (char_length(btrim(label)) BETWEEN 1 AND 200)
);

CREATE TABLE public.inspection_runs (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.inspection_templates (id),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  name text NOT NULL,
  assigned_to uuid NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open',
  performed_by uuid,
  performed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT inspection_runs_status CHECK (status IN ('open', 'completed'))
);

CREATE TABLE public.inspection_results (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.inspection_runs (id),
  point_id uuid NOT NULL,
  label text NOT NULL,
  mark text NOT NULL DEFAULT 'unchecked',
  note text NOT NULL DEFAULT '',
  defect_id uuid REFERENCES public.defects (id),
  CONSTRAINT inspection_results_mark CHECK (mark IN ('ok', 'notable', 'unchecked')),
  CONSTRAINT inspection_results_unique UNIQUE (run_id, point_id)
);

CREATE TRIGGER inspection_templates_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.inspection_templates
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();
CREATE TRIGGER inspection_runs_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.inspection_runs
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();

ALTER TABLE public.inspection_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_points FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_results FORCE ROW LEVEL SECURITY;

CREATE POLICY inspection_templates_select ON public.inspection_templates FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);
CREATE POLICY inspection_templates_insert ON public.inspection_templates FOR INSERT TO authenticated
  WITH CHECK (public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager'));

CREATE POLICY inspection_points_select ON public.inspection_points FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.inspection_templates template WHERE template.id = template_id AND public.tageswerk_meter_role(template.organization_id, template.facility_id) IS NOT NULL));
CREATE POLICY inspection_points_insert ON public.inspection_points FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.inspection_templates template WHERE template.id = template_id AND public.tageswerk_meter_role(template.organization_id, template.facility_id) IN ('company_admin', 'facility_manager')));

CREATE POLICY inspection_runs_select ON public.inspection_runs FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);
CREATE POLICY inspection_runs_insert ON public.inspection_runs FOR INSERT TO authenticated
  WITH CHECK (public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager'));
CREATE POLICY inspection_runs_update ON public.inspection_runs FOR UPDATE TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL AND (assigned_to = auth.uid() OR public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager')))
  WITH CHECK (performed_by = auth.uid() AND status = 'completed');

CREATE POLICY inspection_results_select ON public.inspection_results FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.inspection_runs run WHERE run.id = run_id AND public.tageswerk_meter_role(run.organization_id, run.facility_id) IS NOT NULL));
CREATE POLICY inspection_results_insert ON public.inspection_results FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.inspection_runs run
    WHERE run.id = run_id
      AND (
        run.assigned_to = auth.uid()
        OR public.tageswerk_meter_role(run.organization_id, run.facility_id) IN ('company_admin', 'facility_manager')
      )
  ));
CREATE POLICY inspection_results_update ON public.inspection_results FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.inspection_runs run WHERE run.id = run_id AND (run.assigned_to = auth.uid() OR public.tageswerk_meter_role(run.organization_id, run.facility_id) IN ('company_admin', 'facility_manager'))))
  WITH CHECK (
    mark IN ('ok', 'notable', 'unchecked')
    AND (
      defect_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.inspection_runs run
        JOIN public.defects defect ON defect.id = defect_id
        WHERE run.id = run_id AND defect.facility_id = run.facility_id
      )
    )
  );

CREATE OR REPLACE FUNCTION public.tageswerk_create_inspection_template(
  p_facility_id uuid,
  p_name text,
  p_interval_count integer,
  p_interval_unit text,
  p_labels text[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $tageswerk$
DECLARE
  org uuid;
  new_id uuid;
  point_count integer;
BEGIN
  org := public.tageswerk_facility_organization(p_facility_id);
  IF org IS NULL OR public.tageswerk_meter_role(org, p_facility_id) NOT IN ('company_admin', 'facility_manager') THEN
    RAISE EXCEPTION 'Kontrollgänge legt die Betriebsleitung oder Geschäftsführung an.';
  END IF;
  INSERT INTO public.inspection_templates (organization_id, facility_id, name, interval_count, interval_unit)
  VALUES (org, p_facility_id, btrim(p_name), p_interval_count, p_interval_unit)
  RETURNING id INTO new_id;
  INSERT INTO public.inspection_points (template_id, label, sort_order)
  SELECT new_id, btrim(label), ordinality::integer
  FROM pg_catalog.unnest(p_labels) WITH ORDINALITY AS point(label, ordinality)
  WHERE char_length(btrim(label)) BETWEEN 1 AND 200;
  GET DIAGNOSTICS point_count = ROW_COUNT;
  IF point_count < 1 OR point_count > 30 THEN
    RAISE EXCEPTION 'Bitte mindestens einen und höchstens 30 Prüfpunkte eintragen.';
  END IF;
  RETURN pg_catalog.jsonb_build_object('id', new_id);
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_assign_inspection(
  p_template_id uuid,
  p_assigned_to uuid,
  p_due_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $tageswerk$
DECLARE
  template public.inspection_templates;
  new_id uuid;
BEGIN
  SELECT * INTO template FROM public.inspection_templates WHERE id = p_template_id;
  IF template.id IS NULL OR public.tageswerk_meter_role(template.organization_id, template.facility_id) NOT IN ('company_admin', 'facility_manager') THEN
    RAISE EXCEPTION 'Zuweisen darf die Betriebsleitung oder Geschäftsführung.';
  END IF;
  INSERT INTO public.inspection_runs (template_id, organization_id, facility_id, name, assigned_to, due_at)
  VALUES (template.id, template.organization_id, template.facility_id, template.name, p_assigned_to, p_due_at)
  RETURNING id INTO new_id;
  INSERT INTO public.inspection_results (run_id, point_id, label)
  SELECT new_id, point.id, point.label
  FROM public.inspection_points point
  WHERE point.template_id = template.id
  ORDER BY point.sort_order;
  RETURN pg_catalog.jsonb_build_object('id', new_id);
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_complete_inspection(
  p_run_id uuid,
  p_results jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $tageswerk$
DECLARE
  current_run public.inspection_runs;
BEGIN
  SELECT * INTO current_run FROM public.inspection_runs WHERE id = p_run_id;
  IF current_run.id IS NULL THEN
    RAISE EXCEPTION 'Der Kontrollgang wurde nicht gefunden.';
  END IF;
  IF current_run.assigned_to IS DISTINCT FROM auth.uid()
     AND public.tageswerk_meter_role(current_run.organization_id, current_run.facility_id) NOT IN ('company_admin', 'facility_manager') THEN
    RAISE EXCEPTION 'Dieser Kontrollgang ist einer anderen Person zugewiesen.';
  END IF;
  UPDATE public.inspection_results AS result
  SET mark = item.mark,
      note = coalesce(item.note, '')
  FROM pg_catalog.jsonb_to_recordset(p_results) AS item(point_id uuid, mark text, note text)
  WHERE result.run_id = p_run_id
    AND result.point_id = item.point_id
    AND item.mark IN ('ok', 'notable', 'unchecked');
  IF EXISTS (
    SELECT 1 FROM public.inspection_results result
    WHERE result.run_id = p_run_id AND result.mark NOT IN ('ok', 'notable', 'unchecked')
  ) THEN
    RAISE EXCEPTION 'Bitte jeden Prüfpunkt als in Ordnung, auffällig oder nicht geprüft markieren.';
  END IF;
  UPDATE public.inspection_runs
  SET status = 'completed',
      performed_by = auth.uid(),
      performed_at = pg_catalog.now()
  WHERE id = p_run_id;
  RETURN pg_catalog.jsonb_build_object('id', p_run_id, 'status', 'completed');
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_defect_from_inspection(
  p_run_id uuid,
  p_point_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $tageswerk$
DECLARE
  current_run public.inspection_runs;
  current_result public.inspection_results;
  new_id uuid;
BEGIN
  SELECT * INTO current_run FROM public.inspection_runs WHERE id = p_run_id;
  SELECT * INTO current_result FROM public.inspection_results WHERE run_id = p_run_id AND point_id = p_point_id;
  IF current_run.id IS NULL OR current_result.id IS NULL OR current_result.mark <> 'notable' THEN
    RAISE EXCEPTION 'Nur eine Auffälligkeit kann ein Mangel werden.';
  END IF;
  IF public.tageswerk_meter_role(current_run.organization_id, current_run.facility_id) IS NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung für den Betrieb.';
  END IF;
  INSERT INTO public.defects (organization_id, facility_id, title, description, priority, created_by)
  VALUES (
    current_run.organization_id,
    current_run.facility_id,
    current_run.name || ': ' || current_result.label,
    coalesce(nullif(btrim(current_result.note), ''), 'Bei der Kontrolle aufgefallen.'),
    'high',
    auth.uid()
  )
  RETURNING id INTO new_id;
  UPDATE public.inspection_results
  SET defect_id = new_id
  WHERE id = current_result.id;
  RETURN pg_catalog.jsonb_build_object('id', new_id, 'facility_id', current_run.facility_id);
END;
$tageswerk$;

REVOKE ALL ON TABLE public.inspection_templates FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.inspection_points FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.inspection_runs FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.inspection_results FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.inspection_templates TO authenticated;
GRANT SELECT, INSERT ON TABLE public.inspection_points TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.inspection_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.inspection_results TO authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_create_inspection_template(uuid, text, integer, text, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_assign_inspection(uuid, uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_complete_inspection(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_defect_from_inspection(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_create_inspection_template(uuid, text, integer, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_assign_inspection(uuid, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_complete_inspection(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_defect_from_inspection(uuid, uuid) TO authenticated;

COMMIT;
