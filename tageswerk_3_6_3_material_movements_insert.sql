-- Tageswerk 3.6.3, material_movements_insert: facility_id eindeutig qualifizieren.
-- Nicht ohne ausdrückliche Freigabe ausführen. Keine produktive Ausführung durch die Entwicklung.
-- Eine unqualifizierte Betriebs-ID in der EXISTS-Unterabfrage bindet in PostgreSQL
-- an die innere Tabelle und macht die Betriebsprüfung wirkungslos.
-- Der Trigger tageswerk_material_movement_guard bleibt unverändert.

BEGIN;

DROP POLICY IF EXISTS material_movements_insert ON public.material_movements;

CREATE POLICY material_movements_insert ON public.material_movements FOR INSERT TO authenticated
  WITH CHECK (
    recorded_by = auth.uid()
    AND public.tageswerk_meter_role(material_movements.organization_id, material_movements.facility_id) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.materials material
      WHERE material.id = material_movements.material_id
        AND material.facility_id = material_movements.facility_id
        AND material.organization_id = material_movements.organization_id
    )
  );

COMMIT;
