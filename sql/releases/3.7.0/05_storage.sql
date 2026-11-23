-- Tageswerk 3.7.0 Storage. Privater Bucket defect-photos.
-- Kein öffentlicher Zugriff. Keine anderen Buckets. Kein UPDATE/DELETE auf Objekten.

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'defect-photos',
  'defect-photos',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false
WHERE storage.buckets.public IS DISTINCT FROM false;

DO $storage_fn$
BEGIN
  IF to_regprocedure('public.tageswerk_defect_photo_storage_allowed(text)') IS NOT NULL THEN
    RAISE NOTICE 'tageswerk_defect_photo_storage_allowed existiert, unverändert.';
    RETURN;
  END IF;
  EXECUTE $fn$
    CREATE FUNCTION public.tageswerk_defect_photo_storage_allowed(p_name text)
    RETURNS boolean
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
    DECLARE
      v_folder text;
      v_facility uuid;
      v_org uuid;
    BEGIN
      IF auth.uid() IS NULL THEN
        RETURN false;
      END IF;
      v_folder := (storage.foldername(p_name))[1];
      IF v_folder IS NULL OR v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN false;
      END IF;
      v_facility := v_folder::uuid;
      v_org := public.tageswerk_facility_organization(v_facility);
      IF v_org IS NULL THEN
        RETURN false;
      END IF;
      RETURN public.tageswerk_meter_role(v_org, v_facility)
        IN ('company_admin', 'facility_manager', 'technician', 'employee');
    END;
    $body$;
  $fn$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.tageswerk_defect_photo_storage_allowed(text) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.tageswerk_defect_photo_storage_allowed(text) TO authenticated';
END;
$storage_fn$;

DO $storage_pol$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'defect_photos_storage_select'
  ) THEN
    CREATE POLICY defect_photos_storage_select ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'defect-photos'
        AND public.tageswerk_defect_photo_storage_allowed(name)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'defect_photos_storage_insert'
  ) THEN
    CREATE POLICY defect_photos_storage_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'defect-photos'
        AND public.tageswerk_defect_photo_storage_allowed(name)
      );
  END IF;
END;
$storage_pol$;

COMMIT;
