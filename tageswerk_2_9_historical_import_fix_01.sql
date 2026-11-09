-- Tageswerk 2.9, Korrektur 01 des historischen Imports.
-- Ersetzt nur public.tageswerk_commit_historical_import(uuid,uuid,text,text,jsonb).
-- Tabellen, andere Funktionen, Eigentümer und Ausführungsrechte bleiben unverändert.
-- CREATE OR REPLACE FUNCTION behält Eigentümer und bestehende Berechtigungen.
-- Diese Datei setzt die bereits installierte Importmigration voraus.
-- Noch nicht ausführen.

BEGIN;

DO $guard$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*)
    INTO v_count
  FROM pg_catalog.pg_proc AS funktion
  JOIN pg_catalog.pg_namespace AS schema
    ON schema.oid = funktion.pronamespace
  WHERE schema.nspname = 'public'
    AND funktion.proname = 'tageswerk_commit_historical_import';
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'tageswerk_commit_historical_import muss genau einmal vorhanden sein.';
  END IF;
  PERFORM 'public.tageswerk_commit_historical_import(uuid,uuid,text,text,jsonb)'::pg_catalog.regprocedure;
END
$guard$;

CREATE OR REPLACE FUNCTION public.tageswerk_commit_historical_import(
  p_facility_id uuid,
  p_client_token uuid,
  p_inhalt_sha256 text,
  p_dateiname text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  v_hash text;
  v_batch_id uuid;
  v_stored_hash text;
  v_status text;
  v_count integer;
  v_assess jsonb;
  v_first jsonb;
  v_item jsonb;
  v_source_id uuid;
  v_reading_id uuid;
  v_updated integer;
  v_meter_active boolean;
BEGIN
  PERFORM public.tageswerk_import_require_manager(p_facility_id);
  PERFORM pg_advisory_xact_lock(
    hashtext('tageswerk.utility_facility'),
    hashtext(p_facility_id::text)
  );

  IF p_client_token IS NULL THEN
    RAISE EXCEPTION 'Die Importkennung fehlt.';
  END IF;
  v_hash := lower(btrim(COALESCE(p_inhalt_sha256, '')));
  IF v_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Die Dateikennung ist kein SHA-256.';
  END IF;

  SELECT batch.id, batch.inhalt_sha256, batch.status, batch.row_count
    INTO v_batch_id, v_stored_hash, v_status, v_count
  FROM public.utility_meter_import_batches batch
  WHERE batch.facility_id = p_facility_id
    AND batch.client_token = p_client_token;
  IF FOUND THEN
    IF v_status = 'uebernommen' AND v_stored_hash = v_hash THEN
      RETURN jsonb_build_object(
        'status', 'uebernommen',
        'batch_id', v_batch_id,
        'zeilen', v_count,
        'erneut', true
      );
    END IF;
    RAISE EXCEPTION 'Die Importkennung wurde bereits für eine andere Datei verwendet.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.utility_meter_import_batches batch
    WHERE batch.facility_id = p_facility_id
      AND batch.inhalt_sha256 = v_hash
      AND batch.status = 'uebernommen'
  ) THEN
    RAISE EXCEPTION 'Diese Datei wurde für den Betrieb bereits importiert.';
  END IF;

  v_assess := public.tageswerk_assess_historical_import(p_facility_id, p_payload);
  IF COALESCE((v_assess->>'blockiert')::integer, 0) > 0
     OR (v_assess->>'schreibbar')::boolean IS DISTINCT FROM true THEN
    IF COALESCE((v_assess->>'blockiert')::integer, 0) > 0 THEN
      v_first := v_assess->'zeilen'->0;
      RAISE EXCEPTION
        'Historischer Import abgebrochen. % Datensätze sind nicht übernehmbar, es wird nichts geschrieben. Erster Fehler bei %: %',
        (v_assess->>'blockiert')::integer,
        COALESCE(v_first->>'datensatz_id', '(ohne Kennung)'),
        COALESCE(v_first->'gruende'->>0, 'Die Zeile ist nicht übernehmbar.');
    END IF;
    RAISE EXCEPTION 'Historischer Import abgebrochen. Der Import enthält keine übernehmbaren Datensätze.';
  END IF;
  IF char_length(btrim(COALESCE(p_dateiname, ''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Der Dateiname fehlt oder ist zu lang.';
  END IF;

  INSERT INTO public.utility_meter_import_batches (
    facility_id, client_token, inhalt_sha256, dateiname, format_version, status
  ) VALUES (
    p_facility_id, p_client_token, v_hash, btrim(p_dateiname), 1, 'offen'
  )
  RETURNING id INTO v_batch_id;

  v_count := 0;

  FOR v_item IN
    SELECT element
    FROM jsonb_array_elements(v_assess->'datensaetze') AS element
    ORDER BY (element->>'reading_at')::timestamptz, element->>'datensatz_id'
  LOOP
    INSERT INTO public.utility_meter_import_readings (
      batch_id,
      meter_id,
      excel_schluessel,
      datensatz_id,
      quelle_blatt,
      quelle_zelle,
      original_zaehlerstand,
      korrigierter_zaehlerstand,
      uebernommener_wert,
      entscheidung,
      begruendung,
      ablesedatum,
      ablesezeitraum,
      uhrzeit_angenommen,
      bestaetigte_uhrzeit,
      ablesezeit_bestaetigt,
      pruefhinweis
    ) VALUES (
      v_batch_id,
      (v_item->>'meter_id')::uuid,
      v_item->>'excel_schluessel',
      v_item->>'datensatz_id',
      v_item->>'quelle_blatt',
      v_item->>'quelle_zelle',
      v_item->>'original_zaehlerstand',
      NULLIF(v_item->>'korrigierter_zaehlerstand', ''),
      (v_item->>'reading_value')::numeric,
      v_item->>'entscheidung',
      NULLIF(v_item->>'begruendung', ''),
      (v_item->>'ablesedatum')::date,
      v_item->>'ablesezeitraum',
      (v_item->>'uhrzeit_angenommen')::boolean,
      (v_item->>'bestaetigte_uhrzeit')::time,
      (v_item->>'reading_at')::timestamptz,
      NULLIF(v_item->>'pruefhinweis', '')
    )
    RETURNING id INTO v_source_id;

    SELECT meter.is_active
      INTO v_meter_active
    FROM public.utility_meters AS meter
    WHERE meter.id = (v_item->>'meter_id')::uuid
      AND meter.facility_id = p_facility_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Der Zähler gehört nicht zum Importvorgang.';
    END IF;

    IF v_meter_active IS NOT TRUE THEN
      PERFORM public.tageswerk_issue_historical_permit(
        v_batch_id,
        (v_item->>'meter_id')::uuid,
        (v_item->>'reading_value')::numeric,
        (v_item->>'reading_at')::timestamptz
      );
    END IF;

    INSERT INTO public.utility_meter_readings (
      meter_id, reading_type, reading_value, reading_at
    ) VALUES (
      (v_item->>'meter_id')::uuid,
      'regular',
      (v_item->>'reading_value')::numeric,
      (v_item->>'reading_at')::timestamptz
    )
    RETURNING id INTO v_reading_id;

    UPDATE public.utility_meter_import_readings
    SET reading_id = v_reading_id
    WHERE id = v_source_id
      AND reading_id IS NULL;

    IF v_meter_active IS NOT TRUE AND EXISTS (
      SELECT 1
      FROM public.utility_meter_import_permits AS permit
      WHERE permit.batch_id = v_batch_id
        AND permit.meter_id = (v_item->>'meter_id')::uuid
        AND permit.reading_value = (v_item->>'reading_value')::numeric
        AND permit.reading_at = (v_item->>'reading_at')::timestamptz
    ) THEN
      RAISE EXCEPTION 'Die historische Freigabe wurde nicht verbraucht.';
    END IF;

    v_count := v_count + 1;
  END LOOP;

  IF v_count <> jsonb_array_length(v_assess->'datensaetze')
     OR EXISTS (
       SELECT 1
       FROM public.utility_meter_import_readings source
       WHERE source.batch_id = v_batch_id
         AND source.reading_id IS NULL
     ) THEN
    RAISE EXCEPTION 'Die Herkunft einer Ablesung konnte nicht zugeordnet werden.';
  END IF;

  UPDATE public.utility_meter_import_batches
  SET status = 'uebernommen',
      row_count = v_count
  WHERE id = v_batch_id
    AND status = 'offen';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'Der Importvorgang konnte nicht abgeschlossen werden.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.utility_meter_import_permits AS permit
    WHERE permit.batch_id = v_batch_id
  ) THEN
    RAISE EXCEPTION 'Die historische Freigabe wurde nicht verbraucht.';
  END IF;

  RETURN jsonb_build_object(
    'status', 'uebernommen',
    'batch_id', v_batch_id,
    'zeilen', v_count,
    'erneut', false
  );
END;
$tageswerk$;

COMMIT;
