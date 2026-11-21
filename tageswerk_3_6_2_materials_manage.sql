-- Tageswerk 3.6.2, Materialpflege ohne Löschen
-- Nicht ohne ausdrückliche Freigabe ausführen. Nicht in der Produktivdatenbank anwenden,
-- solange die Freigabe fehlt.
-- Voraussetzung: public.materials, public.tageswerk_meter_role.
-- Ergänzt is_active und UPDATE für Leitungsrollen. Bestehende Bestände bleiben erhalten.

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.materials') IS NULL THEN
    RAISE EXCEPTION 'materials fehlt. Zuerst tageswerk_3_1_materials.sql ausführen.';
  END IF;
  IF to_regprocedure('public.tageswerk_meter_role(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'tageswerk_meter_role fehlt.';
  END IF;
END;
$guard$;

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.materials.is_active IS 'Deaktivierte Materialien bleiben in der Historie und werden in der Bestandsliste ausgeblendet.';

DROP POLICY IF EXISTS materials_update ON public.materials;
CREATE POLICY materials_update ON public.materials
  FOR UPDATE TO authenticated
  USING (
    public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager')
  )
  WITH CHECK (
    public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager')
  );

GRANT SELECT, INSERT, UPDATE ON TABLE public.materials TO authenticated;

COMMIT;
