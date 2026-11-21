-- Tageswerk 3.6.2, betriebsbezogene Wetterkoordinaten
-- Nicht ohne ausdrückliche Freigabe ausführen. Nicht in der Produktivdatenbank anwenden,
-- solange die Freigabe fehlt.
-- Voraussetzung: public.facilities.latitude / longitude (tageswerk_3_6_0_facility_location.sql),
-- public.tageswerk_meter_role.
-- Erlaubt Leitungsrollen nur das Pflegen der Koordinaten, nicht Name oder Organisation.

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.facilities') IS NULL THEN
    RAISE EXCEPTION 'facilities fehlt.';
  END IF;
  IF to_regprocedure('public.tageswerk_meter_role(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'tageswerk_meter_role fehlt.';
  END IF;
  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'facilities' AND column_name IN ('latitude', 'longitude')
  ) < 2 THEN
    RAISE EXCEPTION 'Koordinaten-Spalten fehlen. Zuerst tageswerk_3_6_0_facility_location.sql ausführen.';
  END IF;
END;
$guard$;

GRANT UPDATE (latitude, longitude) ON TABLE public.facilities TO authenticated;

DROP POLICY IF EXISTS facilities_location_update ON public.facilities;
CREATE POLICY facilities_location_update ON public.facilities
  FOR UPDATE TO authenticated
  USING (
    public.tageswerk_meter_role(organization_id, id) IN ('company_admin', 'facility_manager')
  )
  WITH CHECK (
    public.tageswerk_meter_role(organization_id, id) IN ('company_admin', 'facility_manager')
  );

COMMIT;
