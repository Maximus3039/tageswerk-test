-- Tageswerk 3.7.0 RLS. Nur neue Tabellen, nur anlegen wenn die Policy fehlt.
-- Keine Policy auf defects, facilities, readings, filters, archive.

BEGIN;

ALTER TABLE public.utility_monthly_consumption ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_monthly_consumption FORCE ROW LEVEL SECURITY;

DO $monthly_pol$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'utility_monthly_consumption'
      AND policyname = 'utility_monthly_consumption_select'
  ) THEN
    CREATE POLICY utility_monthly_consumption_select
      ON public.utility_monthly_consumption FOR SELECT TO authenticated
      USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'utility_monthly_consumption'
      AND policyname = 'utility_monthly_consumption_insert'
  ) THEN
    CREATE POLICY utility_monthly_consumption_insert
      ON public.utility_monthly_consumption FOR INSERT TO authenticated
      WITH CHECK (
        public.tageswerk_meter_role(organization_id, facility_id)
          IN ('company_admin', 'facility_manager')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'utility_monthly_consumption'
      AND policyname = 'utility_monthly_consumption_update'
  ) THEN
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
  END IF;
END;
$monthly_pol$;

REVOKE ALL ON TABLE public.utility_monthly_consumption FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.utility_monthly_consumption TO authenticated;

ALTER TABLE public.utility_monthly_consumption_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_monthly_consumption_revisions FORCE ROW LEVEL SECURITY;

DO $rev_pol$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'utility_monthly_consumption_revisions'
      AND policyname = 'utility_monthly_consumption_revisions_select'
  ) THEN
    CREATE POLICY utility_monthly_consumption_revisions_select
      ON public.utility_monthly_consumption_revisions FOR SELECT TO authenticated
      USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'utility_monthly_consumption_revisions'
      AND policyname = 'utility_monthly_consumption_revisions_insert'
  ) THEN
    CREATE POLICY utility_monthly_consumption_revisions_insert
      ON public.utility_monthly_consumption_revisions FOR INSERT TO authenticated
      WITH CHECK (
        public.tageswerk_meter_role(organization_id, facility_id)
          IN ('company_admin', 'facility_manager')
      );
  END IF;
END;
$rev_pol$;

REVOKE ALL ON TABLE public.utility_monthly_consumption_revisions FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.utility_monthly_consumption_revisions TO authenticated;

ALTER TABLE public.defect_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.defect_photos FORCE ROW LEVEL SECURITY;

DO $photo_pol$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'defect_photos'
      AND policyname = 'defect_photos_select'
  ) THEN
    CREATE POLICY defect_photos_select ON public.defect_photos
      FOR SELECT TO authenticated
      USING (
        public.tageswerk_meter_role(defect_photos.organization_id, defect_photos.facility_id)
          IN ('company_admin', 'facility_manager', 'technician', 'employee')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'defect_photos'
      AND policyname = 'defect_photos_insert'
  ) THEN
    CREATE POLICY defect_photos_insert ON public.defect_photos
      FOR INSERT TO authenticated
      WITH CHECK (
        defect_photos.uploaded_by = auth.uid()
        AND public.tageswerk_meter_role(defect_photos.organization_id, defect_photos.facility_id)
          IN ('company_admin', 'facility_manager', 'technician', 'employee')
      );
  END IF;
END;
$photo_pol$;

REVOKE ALL ON TABLE public.defect_photos FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.defect_photos TO authenticated;

COMMIT;
