-- Tageswerk 3.4.2, Korrektur der bereits installierten Hilfsfunktion.
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Ersetzt nur tageswerk_own_water_round_stored(uuid, jsonb).
-- Die Abschlussfunktion bleibt unverändert.
-- Tabellen, Messwerte, Entwürfe, Richtlinien und Trigger bleiben unverändert.

BEGIN;
CREATE OR REPLACE FUNCTION public.tageswerk_own_water_round_stored(
  p_round_id uuid,
  p_checks jsonb
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  draft_count integer;
  organization uuid;
  facility uuid;
BEGIN
  IF p_round_id IS NULL
     OR auth.uid() IS NULL
     OR pg_catalog.jsonb_typeof(p_checks) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(p_checks) < 1
     OR pg_catalog.jsonb_array_length(p_checks) > 30 THEN
    RETURN false;
  END IF;
  SELECT count(*)::integer
    INTO draft_count
  FROM public.water_round_drafts AS draft
  WHERE draft.round_id = p_round_id
    AND draft.user_id = auth.uid()
    AND draft.status = 'completed';
  IF draft_count = 1 THEN
    SELECT draft.organization_id, draft.facility_id
      INTO organization, facility
    FROM public.water_round_drafts AS draft
    WHERE draft.round_id = p_round_id
      AND draft.user_id = auth.uid()
      AND draft.status = 'completed';
  END IF;
  IF draft_count IS DISTINCT FROM 1
     OR public.tageswerk_meter_role(organization, facility) IS NULL THEN
    RETURN false;
  END IF;
  IF (
       SELECT count(*)
       FROM public.water_checks AS check_row
       WHERE check_row.round_id = p_round_id
         AND check_row.recorded_by = auth.uid()
         AND check_row.facility_id = facility
     ) IS DISTINCT FROM pg_catalog.jsonb_array_length(p_checks)
     OR (
       SELECT count(DISTINCT (item->>'pool_id')::uuid)
       FROM pg_catalog.jsonb_array_elements(p_checks) AS item
     ) IS DISTINCT FROM pg_catalog.jsonb_array_length(p_checks)
     OR EXISTS (
       SELECT 1
       FROM public.water_checks AS check_row
       WHERE check_row.round_id = p_round_id
         AND (
           check_row.recorded_by IS DISTINCT FROM auth.uid()
           OR check_row.facility_id IS DISTINCT FROM facility
           OR NOT EXISTS (
             SELECT 1
             FROM pg_catalog.jsonb_array_elements(p_checks) AS item
             WHERE (item->>'pool_id')::uuid = check_row.pool_id
           )
         )
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.jsonb_array_elements(p_checks) AS item
       WHERE pg_catalog.jsonb_typeof(item->'readings') IS DISTINCT FROM 'array'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.jsonb_array_elements(p_checks) AS item
       JOIN public.water_checks AS check_row
         ON check_row.round_id = p_round_id
        AND check_row.pool_id = (item->>'pool_id')::uuid
        AND check_row.recorded_by = auth.uid()
        AND check_row.facility_id = facility
       WHERE coalesce(item->>'note', '') IS DISTINCT FROM check_row.note
         OR (
           SELECT count(*)
           FROM pg_catalog.jsonb_array_elements(COALESCE(check_row.readings, '[]'::jsonb)) AS stored
         ) IS DISTINCT FROM (
           SELECT count(*)
           FROM pg_catalog.jsonb_array_elements(item->'readings') AS submitted
         )
         OR (
           SELECT count(DISTINCT submitted->>'parameter_code')
           FROM pg_catalog.jsonb_array_elements(item->'readings') AS submitted
         ) IS DISTINCT FROM (
           SELECT count(*)
           FROM pg_catalog.jsonb_array_elements(item->'readings') AS submitted
         )
         OR EXISTS (
           SELECT 1
           FROM pg_catalog.jsonb_array_elements(COALESCE(check_row.readings, '[]'::jsonb)) AS stored
           WHERE NOT EXISTS (
             SELECT 1
             FROM pg_catalog.jsonb_array_elements(item->'readings') AS submitted
             WHERE submitted->>'parameter_code' = stored->>'parameter_code'
               AND (submitted->>'value')::numeric = (stored->>'value')::numeric
           )
         )
     ) THEN
    RAISE EXCEPTION 'Die gespeicherte Kontrollrunde stimmt nicht mit den übermittelten Angaben überein.';
  END IF;
  RETURN true;
END;
$tageswerk$;

REVOKE ALL ON FUNCTION public.tageswerk_own_water_round_stored(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_own_water_round_stored(uuid, jsonb) TO authenticated;

COMMIT;