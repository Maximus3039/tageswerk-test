-- Tageswerk 3.7.0 TEST: Zählerwechsel-RPC.
-- NUR gamvnzggcrrlnyoknllu. Nicht auf PROD.
-- Text aus tageswerk_2_9_meter_replacement.sql. CREATE OR REPLACE, kein DROP.

BEGIN;

CREATE OR REPLACE FUNCTION public.tageswerk_replace_utility_meter(
  p_meter_id uuid,
  p_closing_value numeric,
  p_removed_at timestamptz,
  p_new_label text,
  p_new_meter_number text,
  p_new_location text,
  p_opening_value numeric,
  p_installed_at timestamptz,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $tageswerk$
DECLARE
  v_old public.utility_meters%ROWTYPE;
  v_role text;
  v_latest_at timestamptz;
  v_changed integer;
  v_new_id uuid;
  v_label text;
  v_number text;
  v_location text;
  v_note text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Eine Anmeldung ist erforderlich.';
  END IF;

  IF p_meter_id IS NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung für diesen Zähler.';
  END IF;

  IF p_closing_value IS NULL OR p_opening_value IS NULL THEN
    RAISE EXCEPTION 'Bitte Abschlussstand und Anfangsstand eingeben.';
  END IF;
  IF p_closing_value < 0 OR p_opening_value < 0 THEN
    RAISE EXCEPTION 'Bitte einen Zählerstand ab 0 eingeben.';
  END IF;
  IF p_removed_at IS NULL OR p_installed_at IS NULL THEN
    RAISE EXCEPTION 'Bitte Ausbau- und Einbauzeitpunkt eingeben.';
  END IF;
  IF p_installed_at < p_removed_at THEN
    RAISE EXCEPTION 'Der Einbau darf nicht vor dem Ausbau liegen.';
  END IF;

  v_label := btrim(p_new_label);
  IF v_label IS NULL OR v_label = '' THEN
    RAISE EXCEPTION 'Bitte eine Bezeichnung für den neuen Zähler eingeben.';
  END IF;
  IF char_length(v_label) > 200 THEN
    RAISE EXCEPTION 'Die Bezeichnung darf höchstens 200 Zeichen haben.';
  END IF;

  v_number := NULLIF(btrim(p_new_meter_number), '');
  IF v_number IS NOT NULL AND char_length(v_number) > 100 THEN
    RAISE EXCEPTION 'Die Zählernummer darf höchstens 100 Zeichen haben.';
  END IF;

  v_location := NULLIF(btrim(p_new_location), '');
  IF v_location IS NOT NULL AND char_length(v_location) > 200 THEN
    RAISE EXCEPTION 'Der Standort darf höchstens 200 Zeichen haben.';
  END IF;

  v_note := NULLIF(btrim(p_note), '');
  IF v_note IS NOT NULL AND char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'Die Bemerkung darf höchstens 2000 Zeichen haben.';
  END IF;

  SELECT * INTO v_old
  FROM public.utility_meters
  WHERE id = p_meter_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Keine Berechtigung für diesen Zähler.';
  END IF;

  v_role := public.tageswerk_meter_role(v_old.organization_id, v_old.facility_id);
  IF v_role IS DISTINCT FROM 'facility_manager'
     AND v_role IS DISTINCT FROM 'company_admin' THEN
    RAISE EXCEPTION 'Zähler wechseln darf die Betriebsleitung oder Geschäftsführung.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('tageswerk.utility_facility'),
    hashtext(v_old.facility_id::text)
  );

  SELECT * INTO v_old
  FROM public.utility_meters
  WHERE id = p_meter_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Keine Berechtigung für diesen Zähler.';
  END IF;

  v_role := public.tageswerk_meter_role(v_old.organization_id, v_old.facility_id);
  IF v_role IS DISTINCT FROM 'facility_manager'
     AND v_role IS DISTINCT FROM 'company_admin' THEN
    RAISE EXCEPTION 'Zähler wechseln darf die Betriebsleitung oder Geschäftsführung.';
  END IF;
  IF v_old.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Ein deaktivierter Zähler kann nicht gewechselt werden.';
  END IF;

  SELECT reading.reading_at INTO v_latest_at
  FROM public.utility_meter_readings reading
  WHERE reading.meter_id = v_old.id
    AND reading.voided_at IS NULL
    AND reading.reading_type <> 'correction'
  ORDER BY reading.reading_at DESC, reading.created_at DESC
  LIMIT 1;
  IF v_latest_at IS NOT NULL AND p_removed_at <= v_latest_at THEN
    RAISE EXCEPTION 'Der Ausbau muss nach der letzten Ablesung liegen.';
  END IF;

  INSERT INTO public.utility_meter_readings (
    meter_id,
    reading_type,
    reading_value,
    reading_at,
    note
  )
  VALUES (
    v_old.id,
    'regular',
    p_closing_value,
    p_removed_at,
    v_note
  );

  UPDATE public.utility_meters
  SET is_active = false
  WHERE id = v_old.id
    AND is_active IS TRUE;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> 1 THEN
    RAISE EXCEPTION 'Der bisherige Zähler konnte nicht deaktiviert werden.';
  END IF;

  INSERT INTO public.utility_meters (
    facility_id,
    medium,
    unit,
    label,
    meter_number,
    location,
    interval_unit,
    interval_count,
    parent_meter_id,
    counts_in_facility_total,
    replaces_meter_id
  )
  VALUES (
    v_old.facility_id,
    v_old.medium,
    v_old.unit,
    v_label,
    v_number,
    v_location,
    v_old.interval_unit,
    v_old.interval_count,
    v_old.parent_meter_id,
    v_old.counts_in_facility_total,
    v_old.id
  )
  RETURNING id INTO v_new_id;
  IF v_new_id IS NULL THEN
    RAISE EXCEPTION 'Der neue Zähler wurde nicht angelegt.';
  END IF;

  INSERT INTO public.utility_meter_readings (
    meter_id,
    reading_type,
    reading_value,
    reading_at
  )
  VALUES (
    v_new_id,
    'regular',
    p_opening_value,
    p_installed_at
  );

  RETURN v_new_id;
END;
$tageswerk$;

COMMENT ON FUNCTION public.tageswerk_replace_utility_meter(
  uuid, numeric, timestamptz, text, text, text, numeric, timestamptz, text
) IS 'Wechselt einen Zähler atomar: Abschlussstand, Deaktivierung, Nachfolger und Anfangsstand.';

REVOKE ALL ON FUNCTION public.tageswerk_replace_utility_meter(
  uuid, numeric, timestamptz, text, text, text, numeric, timestamptz, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.tageswerk_replace_utility_meter(
  uuid, numeric, timestamptz, text, text, text, numeric, timestamptz, text
) TO authenticated;

COMMIT;
