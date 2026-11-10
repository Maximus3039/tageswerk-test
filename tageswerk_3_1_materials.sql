-- Tageswerk 3.1, Materialbestände
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Voraussetzung: public.tageswerk_meter_role, public.tageswerk_bind_operation_facility,
-- public.assets, public.maintenance_logs und public.procurement_requests.
-- Der aktuelle Bestand wird nicht gespeichert. Er ergibt sich aus den Buchungen.
-- Die Sitzungsprüfung für Betriebsleitung und Mitarbeiter aus Tageswerk 3.0 ist offen
-- und darf nicht als bestanden geführt werden.

BEGIN;

CREATE TABLE public.materials (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  name text NOT NULL,
  location text NOT NULL,
  unit text NOT NULL,
  minimum_quantity numeric(14,3) NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT materials_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT materials_location CHECK (char_length(btrim(location)) BETWEEN 1 AND 200),
  CONSTRAINT materials_unit CHECK (char_length(btrim(unit)) BETWEEN 1 AND 40),
  CONSTRAINT materials_minimum CHECK (minimum_quantity >= 0)
);

CREATE TABLE public.material_movements (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  material_id uuid NOT NULL REFERENCES public.materials (id),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  direction text NOT NULL,
  quantity numeric(14,3) NOT NULL,
  note text NOT NULL DEFAULT '',
  recorded_by uuid NOT NULL DEFAULT auth.uid(),
  recorded_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  maintenance_log_id uuid REFERENCES public.maintenance_logs (id),
  procurement_request_id uuid REFERENCES public.procurement_requests (id),
  CONSTRAINT material_movements_direction CHECK (direction IN ('in', 'out')),
  CONSTRAINT material_movements_quantity CHECK (quantity > 0),
  CONSTRAINT material_movements_note CHECK (char_length(note) <= 2000)
);

ALTER TABLE public.procurement_requests
  ADD COLUMN material_id uuid REFERENCES public.materials (id);

CREATE UNIQUE INDEX procurement_requests_one_open_material
  ON public.procurement_requests (material_id)
  WHERE status = 'submitted' AND material_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tageswerk_material_movement_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  stock numeric(14,3);
BEGIN
  NEW.recorded_by := auth.uid();
  NEW.recorded_at := pg_catalog.now();
  -- Sperrt gleichzeitige Buchungen desselben Materials, ohne eine Änderungsregel
  -- für die Materialzeile zu öffnen. Die zweite Entnahme sieht den neuen Bestand.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.material_id::text, 0));
  IF NOT EXISTS (
    SELECT 1 FROM public.materials material
    WHERE material.id = NEW.material_id AND material.facility_id = NEW.facility_id
  ) THEN
    RAISE EXCEPTION 'Das Material gehört zu einem anderen Betrieb.';
  END IF;
  IF NEW.maintenance_log_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.maintenance_logs log
    JOIN public.assets asset ON asset.id = log.asset_id
    WHERE log.id = NEW.maintenance_log_id AND asset.facility_id = NEW.facility_id
  ) THEN
    RAISE EXCEPTION 'Die Wartung gehört zu einem anderen Betrieb.';
  END IF;
  IF NEW.direction = 'out' THEN
    SELECT coalesce(sum(CASE WHEN direction = 'in' THEN quantity ELSE -quantity END), 0)
      INTO stock
    FROM public.material_movements
    WHERE material_id = NEW.material_id;
    IF stock < NEW.quantity THEN
      RAISE EXCEPTION 'Der Bestand reicht für diese Entnahme nicht.';
    END IF;
  END IF;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_procurement_material_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  IF NEW.material_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.material_id::text, 0));
  IF NOT EXISTS (
    SELECT 1 FROM public.materials material
    WHERE material.id = NEW.material_id AND material.facility_id = NEW.facility_id
  ) THEN
    RAISE EXCEPTION 'Das Material gehört zu einem anderen Betrieb.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.procurement_requests request
    WHERE request.material_id = NEW.material_id
      AND request.status = 'submitted'
      AND request.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'Für dieses Material liegt bereits eine offene Beschaffung vor.';
  END IF;
  RETURN NEW;
END;
$tageswerk$;

CREATE TRIGGER materials_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.materials
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();
CREATE TRIGGER material_movements_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.material_movements
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();
CREATE TRIGGER material_movements_guard
  BEFORE INSERT ON public.material_movements
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_material_movement_guard();
CREATE TRIGGER procurement_requests_material_guard
  BEFORE INSERT OR UPDATE OF material_id ON public.procurement_requests
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_procurement_material_guard();

ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials FORCE ROW LEVEL SECURITY;
ALTER TABLE public.material_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_movements FORCE ROW LEVEL SECURITY;

CREATE POLICY materials_select ON public.materials FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);
CREATE POLICY materials_insert ON public.materials FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager')
  );

CREATE POLICY material_movements_select ON public.material_movements FOR SELECT TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL);
CREATE POLICY material_movements_insert ON public.material_movements FOR INSERT TO authenticated
  WITH CHECK (
    recorded_by = auth.uid()
    AND public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.materials material
      WHERE material.id = material_id AND material.facility_id = facility_id
    )
  );

REVOKE ALL ON TABLE public.materials FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.material_movements FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.materials TO authenticated;
GRANT SELECT, INSERT ON TABLE public.material_movements TO authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_material_movement_guard() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_procurement_material_guard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_material_movement_guard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_procurement_material_guard() TO authenticated;

COMMIT;
