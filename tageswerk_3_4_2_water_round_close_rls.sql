-- Tageswerk 3.4.2, RLS-Korrektur beim Abschluss der Wasserhygiene
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Voraussetzung: tageswerk_3_4_2_water_round_close.sql und
-- tageswerk_3_4_2_water_round_close_uuid.sql sind bereits angewendet.
-- Diese Datei ändert keine Richtlinie, keinen Trigger, keine Messung und keinen Entwurf.
-- Sie ergänzt nur den geschützten Statuswechsel und ersetzt die Abschlussfunktion.
-- Der Aufrufer schreibt die Messungen weiter selbst.
-- Abgeschlossen wird ausschließlich der eigene offene Entwurf, und nur wenn
-- tageswerk_water_round_checks_in_transaction wahr ist.
-- Fremde und bereits abgeschlossene Entwürfe bleiben unverändert.
-- Die Update-Richtlinie bleibt für einen direkten Statuswechsel unverändert.

BEGIN;

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
