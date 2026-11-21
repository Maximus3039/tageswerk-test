-- Tageswerk 3.7.0, Metadaten für Mangel-Fotos.
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Speichert keine Bildbytes. Der Storage-Bucket defect-photos wird nur angelegt, wenn er fehlt.
-- Pfade bleiben betriebsbezogen. Keine öffentlichen Leserechte.

BEGIN;

CREATE TABLE IF NOT EXISTS public.defect_photos (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  defect_id uuid NOT NULL REFERENCES public.defects (id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  organization_id uuid NOT NULL,
  uploaded_by uuid NOT NULL DEFAULT auth.uid(),
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT defect_photos_path CHECK (char_length(btrim(storage_path)) BETWEEN 8 AND 400)
);

ALTER TABLE public.defect_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.defect_photos FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS defect_photos_select ON public.defect_photos;
DROP POLICY IF EXISTS defect_photos_insert ON public.defect_photos;

CREATE POLICY defect_photos_select ON public.defect_photos
  FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(defect_photos.organization_id, defect_photos.facility_id) IN ('company_admin', 'facility_manager', 'technician', 'employee'));

CREATE POLICY defect_photos_insert ON public.defect_photos
  FOR INSERT TO authenticated
  WITH CHECK (
    defect_photos.uploaded_by = auth.uid()
    AND public.tageswerk_meter_role(defect_photos.organization_id, defect_photos.facility_id) IN ('company_admin', 'facility_manager', 'technician', 'employee')
  );

REVOKE ALL ON TABLE public.defect_photos FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.defect_photos TO authenticated;

-- Storage-Bucket defect-photos nach Freigabe manuell anlegen, nicht öffentlich.

COMMIT;
