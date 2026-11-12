-- Tageswerk 3.4.2, Abschluss der Wasserhygiene-Kontrollrunde
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Voraussetzung: tageswerk_3_3_water_hygiene.sql und tageswerk_3_4_technician_role.sql
-- sind bereits angewendet.
-- Die Installation ändert keine Richtlinien, keine Trigger, keine Messwerte und keine Entwürfe.
-- Sie ersetzt die Abschlussfunktion. Der Statuswechsel läuft danach nur für den eigenen
-- offenen Entwurf und nur, wenn der bestehende Transaktionsbeweis gilt.
-- Mitarbeiter und Techniker schließen damit die eigene Runde ihres Betriebs ab.
-- Fremde Entwürfe bleiben ausgeschlossen. Die Leserechte für Messungen bleiben:
-- Mitarbeiter sehen gespeicherte Messwerte weiterhin nicht.
-- Betriebsleitung und Geschäftsführung behalten ihre bisherigen Rechte.
-- Der Abschluss schreibt ohne EXCEPTION-Block in der Haupttransaktion.
-- already_stored gilt nur bei aktiver Berechtigung, identischen Messwerten und derselben Notiz.
-- Abweichende Messwerte oder Notizen bestätigen den Abschluss nicht und ändern keine Zeile.

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

CREATE OR REPLACE FUNCTION public.tageswerk_finish_own_water_round_draft(
  p_round_id uuid,
  p_facility_id uuid
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  organization uuid;
  closed_drafts integer;
BEGIN
  IF auth.uid() IS NULL OR p_round_id IS NULL OR p_facility_id IS NULL THEN
    RETURN 0;
  END IF;
  SELECT draft.organization_id
    INTO organization
  FROM public.water_round_drafts AS draft
  WHERE draft.round_id = p_round_id
    AND draft.user_id = auth.uid()
    AND draft.facility_id = p_facility_id
    AND draft.status = 'open';
  IF NOT FOUND OR public.tageswerk_meter_role(organization, p_facility_id) IS NULL THEN
    RETURN 0;
  END IF;
  IF public.tageswerk_water_round_checks_in_transaction(p_round_id, p_facility_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Der Entwurf wird nur über die vorgesehene Funktion abgeschlossen oder verworfen.';
  END IF;
  UPDATE public.water_round_drafts
  SET status = 'completed',
      revision = revision + 1
  WHERE round_id = p_round_id
    AND user_id = auth.uid()
    AND facility_id = p_facility_id
    AND status = 'open';
  GET DIAGNOSTICS closed_drafts = ROW_COUNT;
  RETURN closed_drafts;
END;
$tageswerk$;

REVOKE ALL ON FUNCTION public.tageswerk_finish_own_water_round_draft(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_finish_own_water_round_draft(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.tageswerk_record_water_round(
  p_round_id uuid,
  p_checks jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  item jsonb;
  facility uuid;
  pool uuid;
  seen uuid[] := ARRAY[]::uuid[];
  prepared jsonb[] := ARRAY[]::jsonb[];
  inserted uuid;
  ids uuid[] := ARRAY[]::uuid[];
  closed_drafts integer;
BEGIN
  IF auth.uid() IS NULL
     OR p_round_id IS NULL
     OR jsonb_typeof(p_checks) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_checks) < 1
     OR jsonb_array_length(p_checks) > 30 THEN
    RAISE EXCEPTION 'Die Kontrollrunde ist unvollständig.';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_checks) LOOP
    pool := (item->>'pool_id')::uuid;
    IF pool IS NULL OR pool = ANY (seen) THEN
      RAISE EXCEPTION 'Jedes Becken wird in der Kontrollrunde nur einmal gespeichert.';
    END IF;
    seen := seen || pool;
    IF facility IS NULL THEN
      facility := (item->>'facility_id')::uuid;
    ELSIF facility IS DISTINCT FROM (item->>'facility_id')::uuid THEN
      RAISE EXCEPTION 'Eine Kontrollrunde gehört zu einem Betrieb.';
    END IF;
    IF facility IS NULL
       OR public.tageswerk_meter_role(public.tageswerk_facility_organization(facility), facility) IS NULL THEN
      RAISE EXCEPTION 'Keine Berechtigung für diesen Betrieb.';
    END IF;
    prepared := prepared || ARRAY[item];
  END LOOP;
  IF public.tageswerk_own_water_round_stored(p_round_id, p_checks) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'already_stored', 'round_id', p_round_id);
  END IF;
  FOREACH item IN ARRAY prepared LOOP
    pool := (item->>'pool_id')::uuid;
    inserted := pg_catalog.gen_random_uuid();
    INSERT INTO public.water_checks (id, pool_id, facility_id, note, round_id, readings)
    VALUES (
      inserted,
      pool,
      facility,
      coalesce(item->>'note', ''),
      p_round_id,
      coalesce(item->'readings', '[]'::jsonb)
    );
    ids := ids || inserted;
  END LOOP;
  closed_drafts := public.tageswerk_finish_own_water_round_draft(p_round_id, facility);
  IF closed_drafts IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Die Kontrollrunde konnte nicht eindeutig abgeschlossen werden.';
  END IF;
  RETURN pg_catalog.jsonb_build_object('status', 'stored', 'round_id', p_round_id, 'ids', pg_catalog.to_jsonb(ids));
END;
$tageswerk$;

REVOKE ALL ON FUNCTION public.tageswerk_record_water_round(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_record_water_round(uuid, jsonb) TO authenticated;

COMMIT;
