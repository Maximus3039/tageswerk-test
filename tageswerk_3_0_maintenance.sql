-- Tageswerk 3.0, Wartung
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Voraussetzung: public.tageswerk_bind_operation_facility aus tageswerk_3_0_daily_reports.sql.
-- Der nächste Termin wird nicht gespeichert. Die Oberfläche berechnet ihn aus Anker,
-- Intervall und der letzten erledigten Wartung, analog zur Zählerfälligkeit.

BEGIN;

CREATE TABLE public.assets (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  name text NOT NULL,
  location text NOT NULL DEFAULT '',
  interval_count integer NOT NULL,
  interval_unit text NOT NULL,
  responsible_user_id uuid,
  anchor_at timestamptz NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT assets_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT assets_interval CHECK (interval_count BETWEEN 1 AND 365 AND interval_unit IN ('day', 'week', 'month'))
);

CREATE TABLE public.maintenance_logs (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.assets (id),
  completed_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  completed_by uuid NOT NULL DEFAULT auth.uid(),
  note text NOT NULL,
  CONSTRAINT maintenance_logs_note CHECK (char_length(btrim(note)) >= 1)
);

CREATE TABLE public.asset_defects (
  asset_id uuid NOT NULL REFERENCES public.assets (id),
  defect_id uuid NOT NULL REFERENCES public.defects (id),
  PRIMARY KEY (asset_id, defect_id)
);

CREATE TRIGGER assets_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.asset_defects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_defects FORCE ROW LEVEL SECURITY;

CREATE POLICY assets_select ON public.assets FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);
CREATE POLICY assets_insert ON public.assets FOR INSERT TO authenticated
  WITH CHECK (public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager'));

CREATE POLICY maintenance_logs_select ON public.maintenance_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.assets asset WHERE asset.id = asset_id AND public.tageswerk_meter_role(asset.organization_id, asset.facility_id) IS NOT NULL));
CREATE POLICY maintenance_logs_insert ON public.maintenance_logs FOR INSERT TO authenticated
  WITH CHECK (
    completed_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.assets asset
      WHERE asset.id = asset_id
        AND (
          asset.responsible_user_id = auth.uid()
          OR public.tageswerk_meter_role(asset.organization_id, asset.facility_id) IN ('company_admin', 'facility_manager')
        )
    )
  );

CREATE POLICY asset_defects_select ON public.asset_defects FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.assets asset WHERE asset.id = asset_id AND public.tageswerk_meter_role(asset.organization_id, asset.facility_id) IS NOT NULL));
CREATE POLICY asset_defects_insert ON public.asset_defects FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.assets asset
      JOIN public.defects defect ON defect.id = defect_id
      WHERE asset.id = asset_id
        AND defect.facility_id = asset.facility_id
        AND public.tageswerk_meter_role(asset.organization_id, asset.facility_id) IN ('company_admin', 'facility_manager')
    )
  );

REVOKE ALL ON TABLE public.assets FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.maintenance_logs FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.asset_defects FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.assets TO authenticated;
GRANT SELECT, INSERT ON TABLE public.maintenance_logs TO authenticated;
GRANT SELECT, INSERT ON TABLE public.asset_defects TO authenticated;

COMMIT;
