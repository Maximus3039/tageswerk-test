-- Tageswerk 3.7.0 TEST: Kenntnisnahmen kritischer Mängel.
-- NUR gamvnzggcrrlnyoknllu. Nicht auf PROD.
-- Frontend: dashboard.js loadCriticalAcks / insert defect_id + acknowledged_by.

BEGIN;

CREATE TABLE IF NOT EXISTS public.critical_defect_acknowledgements (
  defect_id uuid NOT NULL REFERENCES public.defects (id),
  acknowledged_by uuid NOT NULL DEFAULT auth.uid(),
  acknowledged_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (defect_id, acknowledged_by)
);

ALTER TABLE public.critical_defect_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.critical_defect_acknowledgements FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS critical_defect_acknowledgements_select ON public.critical_defect_acknowledgements;
DROP POLICY IF EXISTS critical_defect_acknowledgements_insert ON public.critical_defect_acknowledgements;

CREATE POLICY critical_defect_acknowledgements_select
  ON public.critical_defect_acknowledgements
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.defects defect
      WHERE defect.id = defect_id
        AND public.tageswerk_meter_role(defect.organization_id, defect.facility_id) IS NOT NULL
    )
  );

CREATE POLICY critical_defect_acknowledgements_insert
  ON public.critical_defect_acknowledgements
  FOR INSERT TO authenticated
  WITH CHECK (
    acknowledged_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.defects defect
      WHERE defect.id = defect_id
        AND public.tageswerk_meter_role(defect.organization_id, defect.facility_id)
          IN ('company_admin', 'facility_manager')
    )
  );

REVOKE ALL ON TABLE public.critical_defect_acknowledgements FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.critical_defect_acknowledgements TO authenticated;

COMMIT;
