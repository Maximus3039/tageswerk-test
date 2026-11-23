-- Tageswerk 3.7.0 TEST: lesende Importvorschau.
-- NUR gamvnzggcrrlnyoknllu. Nicht auf PROD.
-- Kein tageswerk_commit_historical_import.
-- tageswerk_prepare_reading wird nicht ersetzt.

BEGIN;

DO $guard$
BEGIN
  IF position(
    'Der Zählerstand passt nicht zwischen die benachbarten Ablesungen'
    IN pg_get_functiondef('public.tageswerk_prepare_reading()'::regprocedure)
  ) = 0 THEN
    RAISE EXCEPTION 'tageswerk_prepare_reading weicht ab. Vorschau nicht installiert.';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.tageswerk_import_parse_stand(p_text text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $tageswerk$
DECLARE
  v_text text;
  v_value numeric;
BEGIN
  v_text := btrim(p_text);
  IF v_text IS NULL OR v_text !~ '^[0-9]+([.,][0-9]+)?$' THEN
    RETURN NULL;
  END IF;
  v_text := replace(v_text, ',', '.');
  IF v_text ~ '\.[0-9]{4,}$' THEN
    RETURN NULL;
  END IF;
  v_value := v_text::numeric;
  IF v_value > 99999999999.999 THEN
    RETURN NULL;
  END IF;
  RETURN v_value;
END;
$tageswerk$;

CREATE TABLE IF NOT EXISTS public.utility_meter_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  client_token uuid NOT NULL,
  inhalt_sha256 text NOT NULL,
  dateiname text NOT NULL,
  format_version integer NOT NULL DEFAULT 1,
  status text NOT NULL,
  row_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  committed_at timestamptz,
  CONSTRAINT utility_meter_import_batches_facility_org_fk
    FOREIGN KEY (facility_id, organization_id)
    REFERENCES public.facilities (id, organization_id),
  CONSTRAINT utility_meter_import_batches_hash_check
    CHECK (inhalt_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT utility_meter_import_batches_name_check
    CHECK (char_length(dateiname) BETWEEN 1 AND 500),
  CONSTRAINT utility_meter_import_batches_version_check
    CHECK (format_version = 1),
  CONSTRAINT utility_meter_import_batches_status_check
    CHECK (status IN ('offen', 'uebernommen')),
  CONSTRAINT utility_meter_import_batches_state_check CHECK (
    (
      status = 'offen'
      AND committed_at IS NULL
      AND row_count IS NULL
    ) OR (
      status = 'uebernommen'
      AND committed_at IS NOT NULL
      AND row_count IS NOT NULL
      AND row_count >= 0
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS utility_meter_import_batches_token_key
  ON public.utility_meter_import_batches (facility_id, client_token);
CREATE UNIQUE INDEX IF NOT EXISTS utility_meter_import_batches_hash_key
  ON public.utility_meter_import_batches (facility_id, inhalt_sha256)
  WHERE status = 'uebernommen';

CREATE TABLE IF NOT EXISTS public.utility_meter_import_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.utility_meter_import_batches (id),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  meter_id uuid NOT NULL REFERENCES public.utility_meters (id),
  reading_id uuid REFERENCES public.utility_meter_readings (id),
  excel_schluessel text NOT NULL,
  datensatz_id text NOT NULL,
  quelle_blatt text NOT NULL,
  quelle_zelle text NOT NULL,
  original_zaehlerstand text NOT NULL,
  korrigierter_zaehlerstand text,
  uebernommener_wert numeric(14,3) NOT NULL,
  entscheidung text NOT NULL,
  begruendung text,
  ablesedatum date NOT NULL,
  ablesezeitraum text NOT NULL,
  uhrzeit_angenommen boolean NOT NULL,
  bestaetigte_uhrzeit time NOT NULL,
  ablesezeit_bestaetigt timestamptz NOT NULL,
  pruefhinweis text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT utility_meter_import_readings_facility_org_fk
    FOREIGN KEY (facility_id, organization_id)
    REFERENCES public.facilities (id, organization_id),
  CONSTRAINT utility_meter_import_readings_identity_check
    CHECK (datensatz_id = quelle_blatt || '!' || quelle_zelle),
  CONSTRAINT utility_meter_import_readings_sheet_check
    CHECK (
      char_length(quelle_blatt) BETWEEN 1 AND 100
      AND position('!' IN quelle_blatt) = 0
    ),
  CONSTRAINT utility_meter_import_readings_cell_check
    CHECK (quelle_zelle ~ '^[A-Za-z]{1,3}[0-9]{1,7}$'),
  CONSTRAINT utility_meter_import_readings_original_check
    CHECK (char_length(original_zaehlerstand) BETWEEN 1 AND 200),
  CONSTRAINT utility_meter_import_readings_decision_check
    CHECK (entscheidung IN ('bestaetigt', 'korrigiert')),
  CONSTRAINT utility_meter_import_readings_correction_check CHECK (
    (
      entscheidung = 'bestaetigt'
      AND korrigierter_zaehlerstand IS NULL
    ) OR (
      entscheidung = 'korrigiert'
      AND korrigierter_zaehlerstand IS NOT NULL
      AND char_length(btrim(korrigierter_zaehlerstand)) BETWEEN 1 AND 200
    )
  ),
  CONSTRAINT utility_meter_import_readings_daypart_check
    CHECK (ablesezeitraum IN ('vormittag', 'abend')),
  CONSTRAINT utility_meter_import_readings_value_check
    CHECK (uebernommener_wert >= 0),
  CONSTRAINT utility_meter_import_readings_note_check CHECK (
    (begruendung IS NULL OR char_length(begruendung) BETWEEN 1 AND 2000)
    AND (pruefhinweis IS NULL OR char_length(pruefhinweis) BETWEEN 1 AND 2000)
  ),
  CONSTRAINT utility_meter_import_readings_key_check
    CHECK (char_length(excel_schluessel) BETWEEN 1 AND 200)
);

CREATE UNIQUE INDEX IF NOT EXISTS utility_meter_import_readings_cell_key
  ON public.utility_meter_import_readings (facility_id, quelle_blatt, quelle_zelle);
CREATE UNIQUE INDEX IF NOT EXISTS utility_meter_import_readings_record_key
  ON public.utility_meter_import_readings (batch_id, datensatz_id);
CREATE UNIQUE INDEX IF NOT EXISTS utility_meter_import_readings_reading_key
  ON public.utility_meter_import_readings (reading_id)
  WHERE reading_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS utility_meter_import_readings_open_match
  ON public.utility_meter_import_readings (batch_id, meter_id, ablesezeit_bestaetigt)
  WHERE reading_id IS NULL;



CREATE OR REPLACE FUNCTION public.tageswerk_prepare_import_batch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Eine Anmeldung ist erforderlich.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM 'offen' OR NEW.status IS DISTINCT FROM 'uebernommen' THEN
      RAISE EXCEPTION 'Ein Importvorgang wird nur von offen auf übernommen gesetzt.';
    END IF;
    IF NEW.facility_id IS DISTINCT FROM OLD.facility_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.client_token IS DISTINCT FROM OLD.client_token
       OR NEW.inhalt_sha256 IS DISTINCT FROM OLD.inhalt_sha256
       OR NEW.dateiname IS DISTINCT FROM OLD.dateiname
       OR NEW.format_version IS DISTINCT FROM OLD.format_version
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Ein Importvorgang behält Herkunft und Dateikennung.';
    END IF;
    IF NEW.created_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Nur der begonnene Importvorgang darf abgeschlossen werden.';
    END IF;
    IF public.tageswerk_meter_role(OLD.organization_id, OLD.facility_id)
         NOT IN ('company_admin', 'facility_manager') THEN
      RAISE EXCEPTION 'Historische Importe darf die Betriebsleitung oder Geschäftsführung.';
    END IF;
    IF NEW.row_count IS NULL OR NEW.row_count < 0 THEN
      RAISE EXCEPTION 'Die Anzahl der übernommenen Zeilen fehlt.';
    END IF;
    NEW.committed_at := now();
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'offen' THEN
    RAISE EXCEPTION 'Ein Importvorgang beginnt offen.';
  END IF;
  NEW.dateiname := btrim(NEW.dateiname);
  NEW.inhalt_sha256 := lower(btrim(NEW.inhalt_sha256));
  NEW.format_version := 1;
  NEW.created_by := auth.uid();
  NEW.created_at := now();
  NEW.committed_at := NULL;
  NEW.row_count := NULL;
  SELECT f.organization_id
    INTO NEW.organization_id
  FROM public.facilities f
  WHERE f.id = NEW.facility_id;
  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'Der Betrieb wurde nicht gefunden.';
  END IF;
  IF public.tageswerk_meter_role(NEW.organization_id, NEW.facility_id)
       NOT IN ('company_admin', 'facility_manager') THEN
    RAISE EXCEPTION 'Historische Importe darf die Betriebsleitung oder Geschäftsführung.';
  END IF;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_prepare_import_reading()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  v_batch public.utility_meter_import_batches%ROWTYPE;
  v_reading public.utility_meter_readings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Eine Anmeldung ist erforderlich.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.reading_id IS NOT NULL THEN
      RAISE EXCEPTION 'Die Herkunft einer übernommenen Ablesung ist unveränderlich.';
    END IF;
    IF NEW.batch_id IS DISTINCT FROM OLD.batch_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.facility_id IS DISTINCT FROM OLD.facility_id
       OR NEW.meter_id IS DISTINCT FROM OLD.meter_id
       OR NEW.excel_schluessel IS DISTINCT FROM OLD.excel_schluessel
       OR NEW.datensatz_id IS DISTINCT FROM OLD.datensatz_id
       OR NEW.quelle_blatt IS DISTINCT FROM OLD.quelle_blatt
       OR NEW.quelle_zelle IS DISTINCT FROM OLD.quelle_zelle
       OR NEW.original_zaehlerstand IS DISTINCT FROM OLD.original_zaehlerstand
       OR NEW.korrigierter_zaehlerstand IS DISTINCT FROM OLD.korrigierter_zaehlerstand
       OR NEW.uebernommener_wert IS DISTINCT FROM OLD.uebernommener_wert
       OR NEW.entscheidung IS DISTINCT FROM OLD.entscheidung
       OR NEW.begruendung IS DISTINCT FROM OLD.begruendung
       OR NEW.ablesedatum IS DISTINCT FROM OLD.ablesedatum
       OR NEW.ablesezeitraum IS DISTINCT FROM OLD.ablesezeitraum
       OR NEW.uhrzeit_angenommen IS DISTINCT FROM OLD.uhrzeit_angenommen
       OR NEW.bestaetigte_uhrzeit IS DISTINCT FROM OLD.bestaetigte_uhrzeit
       OR NEW.ablesezeit_bestaetigt IS DISTINCT FROM OLD.ablesezeit_bestaetigt
       OR NEW.pruefhinweis IS DISTINCT FROM OLD.pruefhinweis
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'An der Herkunft ändert sich nur die zugeordnete Ablesung.';
    END IF;
    SELECT * INTO v_reading
    FROM public.utility_meter_readings
    WHERE id = NEW.reading_id;
    IF NOT FOUND
       OR v_reading.meter_id IS DISTINCT FROM NEW.meter_id
       OR v_reading.reading_type IS DISTINCT FROM 'regular'
       OR v_reading.reading_value IS DISTINCT FROM NEW.uebernommener_wert
       OR v_reading.reading_at IS DISTINCT FROM NEW.ablesezeit_bestaetigt
       OR v_reading.voided_at IS NOT NULL
       OR v_reading.recorded_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Die zugeordnete Ablesung stimmt nicht mit der Herkunft überein.';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v_batch
  FROM public.utility_meter_import_batches
  WHERE id = NEW.batch_id;
  IF NOT FOUND
     OR v_batch.status IS DISTINCT FROM 'offen'
     OR v_batch.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Die Herkunft gehört zu einem offenen Importvorgang des angemeldeten Benutzers.';
  END IF;
  IF public.tageswerk_meter_role(v_batch.organization_id, v_batch.facility_id)
       NOT IN ('company_admin', 'facility_manager') THEN
    RAISE EXCEPTION 'Historische Importe darf die Betriebsleitung oder Geschäftsführung.';
  END IF;
  NEW.organization_id := v_batch.organization_id;
  NEW.facility_id := v_batch.facility_id;
  NEW.reading_id := NULL;
  NEW.created_at := now();
  NEW.excel_schluessel := btrim(NEW.excel_schluessel);
  NEW.quelle_blatt := btrim(NEW.quelle_blatt);
  NEW.quelle_zelle := btrim(NEW.quelle_zelle);
  NEW.datensatz_id := btrim(NEW.datensatz_id);
  NEW.original_zaehlerstand := btrim(NEW.original_zaehlerstand);
  NEW.begruendung := NULLIF(btrim(NEW.begruendung), '');
  NEW.pruefhinweis := NULLIF(btrim(NEW.pruefhinweis), '');
  IF NOT EXISTS (
    SELECT 1
    FROM public.utility_meter_import_mappings mapping
    WHERE mapping.facility_id = NEW.facility_id
      AND mapping.meter_id = NEW.meter_id
      AND mapping.excel_schluessel = NEW.excel_schluessel
      AND mapping.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Die Herkunft passt zu keiner bestätigten Zählerzuordnung.';
  END IF;
  RETURN NEW;
END;
$tageswerk$;

DROP TRIGGER IF EXISTS utility_meter_import_batches_prepare ON public.utility_meter_import_batches;
CREATE TRIGGER utility_meter_import_batches_prepare
  BEFORE INSERT OR UPDATE ON public.utility_meter_import_batches
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_prepare_import_batch();
DROP TRIGGER IF EXISTS utility_meter_import_batches_no_delete ON public.utility_meter_import_batches;
CREATE TRIGGER utility_meter_import_batches_no_delete
  BEFORE DELETE ON public.utility_meter_import_batches
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_reject_import_delete();
DROP TRIGGER IF EXISTS utility_meter_import_readings_prepare ON public.utility_meter_import_readings;
CREATE TRIGGER utility_meter_import_readings_prepare
  BEFORE INSERT OR UPDATE ON public.utility_meter_import_readings
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_prepare_import_reading();
DROP TRIGGER IF EXISTS utility_meter_import_readings_no_delete ON public.utility_meter_import_readings;
CREATE TRIGGER utility_meter_import_readings_no_delete
  BEFORE DELETE ON public.utility_meter_import_readings
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_reject_import_delete();

ALTER TABLE public.utility_meter_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_meter_import_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.utility_meter_import_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_meter_import_readings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS utility_meter_import_batches_select ON public.utility_meter_import_batches;
CREATE POLICY utility_meter_import_batches_select
  ON public.utility_meter_import_batches
  FOR SELECT TO authenticated
  USING (
    public.tageswerk_meter_role(organization_id, facility_id)
      IN ('company_admin', 'facility_manager')
  );
DROP POLICY IF EXISTS utility_meter_import_readings_select ON public.utility_meter_import_readings;
CREATE POLICY utility_meter_import_readings_select
  ON public.utility_meter_import_readings
  FOR SELECT TO authenticated
  USING (
    public.tageswerk_meter_role(organization_id, facility_id)
      IN ('company_admin', 'facility_manager')
  );

REVOKE ALL ON TABLE public.utility_meter_import_batches FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.utility_meter_import_readings FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.utility_meter_import_batches TO authenticated;
GRANT SELECT ON TABLE public.utility_meter_import_readings TO authenticated;

CREATE OR REPLACE FUNCTION public.tageswerk_import_require_manager(p_facility_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $tageswerk$
DECLARE
  v_org uuid;
  v_role text;
BEGIN
  SELECT f.organization_id,
         public.tageswerk_meter_role(f.organization_id, f.id)
    INTO v_org, v_role
  FROM public.facilities f
  WHERE f.id = p_facility_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Der Betrieb wurde nicht gefunden.';
  END IF;
  IF v_role NOT IN ('company_admin', 'facility_manager') THEN
    RAISE EXCEPTION 'Historische Importe darf die Betriebsleitung oder Geschäftsführung.';
  END IF;
  RETURN v_org;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_assess_historical_import(
  p_facility_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $tageswerk$
DECLARE
  v_org uuid;
  v_item jsonb;
  v_obj jsonb;
  v_rows jsonb[] := ARRAY[]::jsonb[];
  v_existing jsonb := '[]'::jsonb;
  v_gruende jsonb;
  v_ord integer := 0;
  v_n integer;
  v_i integer;
  v_pick integer;
  v_key text;
  v_blatt text;
  v_zelle text;
  v_datensatz text;
  v_original text;
  v_korrigiert text;
  v_entscheidung text;
  v_begruendung text;
  v_hinweis text;
  v_zeitraum text;
  v_datum date;
  v_uhrzeit time;
  v_angenommen boolean;
  v_wert numeric;
  v_meter uuid;
  v_active boolean;
  v_altbestand boolean;
  v_at timestamptz;
  v_prev_found boolean;
  v_prev_type text;
  v_prev_series uuid;
  v_prev_value numeric;
  v_next_found boolean;
  v_next_type text;
  v_next_series uuid;
  v_next_value numeric;
  v_series uuid;
  v_latest timestamptz;
  v_ready integer;
  v_blocked integer;
  v_zeilen jsonb;
  v_effects jsonb;
  v_records jsonb;
BEGIN
  v_org := public.tageswerk_import_require_manager(p_facility_id);
  PERFORM pg_advisory_xact_lock(
    hashtext('tageswerk.utility_facility'),
    hashtext(p_facility_id::text)
  );

  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Die Importdaten müssen eine Liste sein.';
  END IF;
  IF jsonb_array_length(p_payload) > 10000 THEN
    RAISE EXCEPTION 'Der Import enthält zu viele Datensätze.';
  END IF;

  FOR v_item IN
    SELECT element
    FROM jsonb_array_elements(p_payload) AS element
  LOOP
    v_ord := v_ord + 1;
    v_gruende := '[]'::jsonb;
    v_key := NULL;
    v_blatt := NULL;
    v_zelle := NULL;
    v_datensatz := NULL;
    v_original := NULL;
    v_korrigiert := NULL;
    v_entscheidung := NULL;
    v_begruendung := NULL;
    v_hinweis := NULL;
    v_zeitraum := NULL;
    v_datum := NULL;
    v_uhrzeit := NULL;
    v_angenommen := NULL;
    v_wert := NULL;
    v_meter := NULL;
    v_active := NULL;
    v_altbestand := NULL;
    v_at := NULL;

    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      v_rows := array_append(v_rows, jsonb_build_object(
        'ord', v_ord,
        'datensatz_id', 'Zeile ' || v_ord,
        'accepted', false,
        'gruende', jsonb_build_array('Der Datensatz ist kein Objekt.')
      ));
      CONTINUE;
    END IF;

    v_key := NULLIF(btrim(v_item->>'excel_schluessel'), '');
    v_blatt := NULLIF(btrim(v_item->>'quelle_blatt'), '');
    v_zelle := NULLIF(btrim(v_item->>'quelle_zelle'), '');
    v_datensatz := NULLIF(btrim(v_item->>'datensatz_id'), '');
    v_original := NULLIF(btrim(v_item->>'original_zaehlerstand'), '');
    v_korrigiert := NULLIF(btrim(v_item->>'korrigierter_zaehlerstand'), '');
    v_entscheidung := NULLIF(btrim(v_item->>'entscheidung'), '');
    v_begruendung := NULLIF(btrim(v_item->>'begruendung'), '');
    v_hinweis := NULLIF(btrim(v_item->>'pruefhinweis'), '');
    v_zeitraum := NULLIF(btrim(v_item->>'ablesezeitraum'), '');

    IF v_key IS NULL OR char_length(v_key) > 200 THEN
      v_gruende := v_gruende || jsonb_build_array('Der Zählerschlüssel fehlt.');
    END IF;
    IF v_blatt IS NULL
       OR char_length(v_blatt) > 100
       OR position('!' IN v_blatt) > 0
       OR v_blatt ~ '[[:cntrl:]]'
       OR v_zelle IS NULL
       OR v_zelle !~ '^[A-Za-z]{1,3}[0-9]{1,7}$' THEN
      v_gruende := v_gruende || jsonb_build_array('Blatt oder Zelle ist ungültig.');
    ELSIF v_datensatz IS DISTINCT FROM v_blatt || '!' || v_zelle THEN
      v_gruende := v_gruende || jsonb_build_array('Die Datensatzkennung entspricht nicht Blatt und Zelle.');
    END IF;
    IF v_original IS NULL OR char_length(v_original) > 200 THEN
      v_gruende := v_gruende || jsonb_build_array('Der Originalwert fehlt.');
    END IF;
    IF char_length(COALESCE(v_begruendung, '')) > 2000
       OR char_length(COALESCE(v_hinweis, '')) > 2000 THEN
      v_gruende := v_gruende || jsonb_build_array('Begründung oder Prüfhinweis ist zu lang.');
    END IF;
    IF v_zeitraum NOT IN ('vormittag', 'abend') THEN
      v_gruende := v_gruende || jsonb_build_array('Die Tageszeit muss Vormittag oder Abend sein.');
    END IF;
    IF jsonb_typeof(v_item->'uhrzeit_angenommen') IS DISTINCT FROM 'boolean' THEN
      v_gruende := v_gruende || jsonb_build_array('Die Angabe, ob die Uhrzeit angenommen wurde, fehlt.');
    ELSE
      v_angenommen := (v_item->>'uhrzeit_angenommen')::boolean;
    END IF;
    IF (v_item->>'uhrzeit_bestaetigt') IS DISTINCT FROM 'true' THEN
      v_gruende := v_gruende || jsonb_build_array('Die Uhrzeit ist nicht ausdrücklich bestätigt.');
    END IF;
    IF v_item->>'ablesedatum' IS NULL THEN
      v_gruende := v_gruende || jsonb_build_array('Das Ablesedatum ist ungültig.');
    ELSE
      BEGIN
        v_datum := (v_item->>'ablesedatum')::date;
      EXCEPTION
        WHEN invalid_text_representation OR datetime_field_overflow THEN
          v_gruende := v_gruende || jsonb_build_array('Das Ablesedatum ist ungültig.');
      END;
    END IF;
    IF v_item->>'bestaetigte_uhrzeit' IS NULL THEN
      v_gruende := v_gruende || jsonb_build_array('Die bestätigte Uhrzeit ist ungültig.');
    ELSE
      BEGIN
        v_uhrzeit := (v_item->>'bestaetigte_uhrzeit')::time;
      EXCEPTION
        WHEN invalid_text_representation OR datetime_field_overflow THEN
          v_gruende := v_gruende || jsonb_build_array('Die bestätigte Uhrzeit ist ungültig.');
      END;
    END IF;

    IF v_entscheidung = 'bestaetigt' THEN
      IF v_korrigiert IS NOT NULL THEN
        v_gruende := v_gruende || jsonb_build_array('Eine bestätigte Zeile darf keinen Korrekturwert enthalten.');
      END IF;
      v_wert := public.tageswerk_import_parse_stand(v_original);
      IF v_wert IS NULL THEN
        v_gruende := v_gruende || jsonb_build_array('Der Zählerstand ist ungültig oder hat mehr als drei Nachkommastellen.');
      END IF;
    ELSIF v_entscheidung = 'korrigiert' THEN
      v_wert := public.tageswerk_import_parse_stand(v_korrigiert);
      IF v_wert IS NULL THEN
        v_gruende := v_gruende || jsonb_build_array('Der Zählerstand ist ungültig oder hat mehr als drei Nachkommastellen.');
      END IF;
    ELSE
      v_gruende := v_gruende || jsonb_build_array('Die Prüfentscheidung ist nicht bestätigt.');
    END IF;

    IF v_datum IS NOT NULL AND v_uhrzeit IS NOT NULL
       AND (v_item->>'uhrzeit_bestaetigt') = 'true' THEN
      v_at := (v_datum + v_uhrzeit) AT TIME ZONE 'Europe/Berlin';
      IF v_at > now() + interval '5 minutes' THEN
        v_gruende := v_gruende || jsonb_build_array('Der Zeitpunkt liegt in der Zukunft.');
      END IF;
    END IF;

    IF v_key IS NOT NULL THEN
      SELECT mapping.meter_id, meter.is_active, mapping.altbestand_bestaetigt
        INTO v_meter, v_active, v_altbestand
      FROM public.utility_meter_import_mappings mapping
      JOIN public.utility_meters meter ON meter.id = mapping.meter_id
      JOIN public.tageswerk_import_medium_unit(
        mapping.excel_verbrauchsart,
        mapping.excel_einheit
      ) AS translated
        ON translated.medium = meter.medium
       AND translated.unit = meter.unit
      WHERE mapping.facility_id = p_facility_id
        AND mapping.organization_id = v_org
        AND mapping.excel_schluessel = v_key
        AND mapping.revoked_at IS NULL
        AND meter.facility_id = p_facility_id
        AND meter.organization_id = v_org;
      IF NOT FOUND THEN
        v_gruende := v_gruende || jsonb_build_array('Die Zählerzuordnung fehlt oder passt nicht zu Medium und Einheit.');
        v_meter := NULL;
      END IF;
    END IF;

    v_rows := array_append(v_rows, jsonb_build_object(
      'ord', v_ord,
      'datensatz_id', COALESCE(v_datensatz, 'Zeile ' || v_ord),
      'excel_schluessel', v_key,
      'meter_id', v_meter,
      'reading_at', v_at,
      'reading_value', v_wert,
      'series_id', NULL,
      'is_active', v_active,
      'altbestand', COALESCE(v_altbestand, false),
      'accepted', false,
      'gruende', v_gruende,
      'quelle_blatt', v_blatt,
      'quelle_zelle', v_zelle,
      'original_zaehlerstand', v_original,
      'korrigierter_zaehlerstand', CASE WHEN v_entscheidung = 'korrigiert' THEN v_korrigiert ELSE NULL END,
      'entscheidung', v_entscheidung,
      'begruendung', v_begruendung,
      'ablesedatum', v_datum,
      'ablesezeitraum', v_zeitraum,
      'uhrzeit_angenommen', COALESCE(v_angenommen, false),
      'bestaetigte_uhrzeit', v_uhrzeit,
      'pruefhinweis', v_hinweis
    ));
  END LOOP;

  v_n := COALESCE(array_length(v_rows, 1), 0);
  IF v_n = 0 THEN
    RETURN jsonb_build_object(
      'uebernehmbar', 0,
      'blockiert', 0,
      'schreibbar', false,
      'zeilen', '[]'::jsonb,
      'verbrauchsauswirkungen', '[]'::jsonb,
      'datensaetze', '[]'::jsonb
    );
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'meter_id', reading.meter_id,
    'reading_id', reading.id,
    'reading_at', reading.reading_at,
    'created_at', reading.created_at,
    'reading_type', reading.reading_type,
    'series_id', reading.series_id,
    'reading_value', public.tageswerk_effective_reading_value(reading.id)
  )), '[]'::jsonb)
    INTO v_existing
  FROM public.utility_meter_readings reading
  WHERE reading.voided_at IS NULL
    AND reading.reading_type <> 'correction'
    AND reading.meter_id IN (
      SELECT (elem->>'meter_id')::uuid
      FROM unnest(v_rows) AS elem
      WHERE elem->>'meter_id' IS NOT NULL
    );

  FOR v_i IN 1..v_n LOOP
    v_obj := v_rows[v_i];
    IF v_obj->>'datensatz_id' IS NOT NULL AND (
      SELECT count(*)
      FROM unnest(v_rows) AS other
      WHERE other->>'datensatz_id' = v_obj->>'datensatz_id'
    ) > 1 THEN
      v_obj := jsonb_set(v_obj, '{gruende}', COALESCE(v_obj->'gruende', '[]'::jsonb) || jsonb_build_array('Die Datensatzkennung ist im Import mehrfach vorhanden.'));
    END IF;
    IF v_obj->>'quelle_blatt' IS NOT NULL AND v_obj->>'quelle_zelle' IS NOT NULL AND (
      SELECT count(*)
      FROM unnest(v_rows) AS other
      WHERE other->>'quelle_blatt' = v_obj->>'quelle_blatt'
        AND other->>'quelle_zelle' = v_obj->>'quelle_zelle'
    ) > 1 THEN
      v_obj := jsonb_set(v_obj, '{gruende}', COALESCE(v_obj->'gruende', '[]'::jsonb) || jsonb_build_array('Die Zelle ist im Import mehrfach vorhanden.'));
    END IF;
    IF v_obj->>'meter_id' IS NOT NULL AND v_obj->>'reading_at' IS NOT NULL AND (
      SELECT count(*)
      FROM unnest(v_rows) AS other
      WHERE other->>'meter_id' = v_obj->>'meter_id'
        AND (other->>'reading_at')::timestamptz = (v_obj->>'reading_at')::timestamptz
    ) > 1 THEN
      v_obj := jsonb_set(v_obj, '{gruende}', COALESCE(v_obj->'gruende', '[]'::jsonb) || jsonb_build_array('Der Zeitpunkt ist in der Datei mehrfach vorhanden.'));
    END IF;
    IF v_obj->>'meter_id' IS NOT NULL AND v_obj->>'reading_at' IS NOT NULL AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_existing) AS existing
      WHERE existing->>'meter_id' = v_obj->>'meter_id'
        AND (existing->>'reading_at')::timestamptz = (v_obj->>'reading_at')::timestamptz
    ) THEN
      v_obj := jsonb_set(v_obj, '{gruende}', COALESCE(v_obj->'gruende', '[]'::jsonb) || jsonb_build_array('Der Zeitpunkt ist bereits abgelesen.'));
    END IF;
    IF v_obj->>'quelle_blatt' IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.utility_meter_import_readings existing
      WHERE existing.facility_id = p_facility_id
        AND existing.quelle_blatt = v_obj->>'quelle_blatt'
        AND existing.quelle_zelle = v_obj->>'quelle_zelle'
    ) THEN
      v_obj := jsonb_set(v_obj, '{gruende}', COALESCE(v_obj->'gruende', '[]'::jsonb) || jsonb_build_array('Diese Zelle wurde bereits importiert.'));
    END IF;
    v_rows[v_i] := v_obj;
  END LOOP;

  LOOP
    v_pick := NULL;
    FOR v_i IN 1..v_n LOOP
      IF COALESCE(jsonb_array_length(v_rows[v_i]->'gruende'), 0) = 0
         AND (v_rows[v_i]->>'accepted')::boolean IS NOT TRUE
         AND v_rows[v_i]->>'reading_at' IS NOT NULL THEN
        IF v_pick IS NULL
           OR (v_rows[v_i]->>'reading_at')::timestamptz
                < (v_rows[v_pick]->>'reading_at')::timestamptz
           OR (
             (v_rows[v_i]->>'reading_at')::timestamptz
               = (v_rows[v_pick]->>'reading_at')::timestamptz
             AND v_i < v_pick
           ) THEN
          v_pick := v_i;
        END IF;
      END IF;
    END LOOP;
    EXIT WHEN v_pick IS NULL;

    v_obj := v_rows[v_pick];
    IF v_obj->>'meter_id' IS NULL
       OR v_obj->>'reading_value' IS NULL
       OR v_obj->>'reading_at' IS NULL THEN
      v_obj := jsonb_set(
        v_obj,
        '{gruende}',
        COALESCE(v_obj->'gruende', '[]'::jsonb) || jsonb_build_array('Die Zeile ist unvollständig.')
      );
      v_rows[v_pick] := v_obj;
      CONTINUE;
    END IF;

    SELECT anchor.reading_type, anchor.series_id, anchor.reading_value
      INTO v_prev_type, v_prev_series, v_prev_value
    FROM (
      SELECT
        (existing->>'reading_at')::timestamptz AS reading_at,
        existing->>'reading_type' AS reading_type,
        (existing->>'series_id')::uuid AS series_id,
        (existing->>'reading_value')::numeric AS reading_value
      FROM jsonb_array_elements(v_existing) AS existing
      WHERE existing->>'meter_id' = v_obj->>'meter_id'
        AND (existing->>'reading_at')::timestamptz < (v_obj->>'reading_at')::timestamptz
      UNION ALL
      SELECT
        (other->>'reading_at')::timestamptz,
        'regular',
        (other->>'series_id')::uuid,
        (other->>'reading_value')::numeric
      FROM unnest(v_rows) AS other
      WHERE (other->>'accepted')::boolean IS TRUE
        AND other->>'meter_id' = v_obj->>'meter_id'
        AND (other->>'reading_at')::timestamptz < (v_obj->>'reading_at')::timestamptz
    ) AS anchor
    ORDER BY anchor.reading_at DESC
    LIMIT 1;
    v_prev_found := FOUND;

    SELECT anchor.reading_type, anchor.series_id, anchor.reading_value
      INTO v_next_type, v_next_series, v_next_value
    FROM (
      SELECT
        (existing->>'reading_at')::timestamptz AS reading_at,
        existing->>'reading_type' AS reading_type,
        (existing->>'series_id')::uuid AS series_id,
        (existing->>'reading_value')::numeric AS reading_value
      FROM jsonb_array_elements(v_existing) AS existing
      WHERE existing->>'meter_id' = v_obj->>'meter_id'
        AND (existing->>'reading_at')::timestamptz > (v_obj->>'reading_at')::timestamptz
      UNION ALL
      SELECT
        (other->>'reading_at')::timestamptz,
        'regular',
        (other->>'series_id')::uuid,
        (other->>'reading_value')::numeric
      FROM unnest(v_rows) AS other
      WHERE (other->>'accepted')::boolean IS TRUE
        AND other->>'meter_id' = v_obj->>'meter_id'
        AND (other->>'reading_at')::timestamptz > (v_obj->>'reading_at')::timestamptz
    ) AS anchor
    ORDER BY anchor.reading_at ASC
    LIMIT 1;
    v_next_found := FOUND;

    IF v_prev_found THEN
      v_series := v_prev_series;
    ELSE
      v_series := COALESCE(v_next_series, gen_random_uuid());
    END IF;

    IF v_prev_found
       AND v_prev_series IS NOT DISTINCT FROM v_series
       AND (v_obj->>'reading_value')::numeric < v_prev_value THEN
      v_obj := jsonb_set(v_obj, '{gruende}', COALESCE(v_obj->'gruende', '[]'::jsonb) || jsonb_build_array('Der Stand ist rückläufig.'));
    END IF;
    IF v_next_found
       AND v_next_type IS DISTINCT FROM 'reset'
       AND v_next_series IS NOT DISTINCT FROM v_series
       AND (v_obj->>'reading_value')::numeric > v_next_value THEN
      v_obj := jsonb_set(v_obj, '{gruende}', COALESCE(v_obj->'gruende', '[]'::jsonb) || jsonb_build_array('Der Stand liegt über der folgenden Ablesung.'));
    END IF;

    IF (v_obj->>'is_active')::boolean IS NOT TRUE THEN
      SELECT max((existing->>'reading_at')::timestamptz)
        INTO v_latest
      FROM jsonb_array_elements(v_existing) AS existing
      WHERE existing->>'meter_id' = v_obj->>'meter_id';
      IF v_latest IS NULL THEN
        IF (v_obj->>'altbestand')::boolean IS NOT TRUE THEN
          v_obj := jsonb_set(v_obj, '{gruende}', COALESCE(v_obj->'gruende', '[]'::jsonb) || jsonb_build_array('Der deaktivierte Zähler hat keinen Bestand. Der Altbestand ist nicht bestätigt.'));
        END IF;
      ELSIF (v_obj->>'reading_at')::timestamptz >= v_latest THEN
        v_obj := jsonb_set(v_obj, '{gruende}', COALESCE(v_obj->'gruende', '[]'::jsonb) || jsonb_build_array('Für einen deaktivierten Zähler liegt die Ablesung nicht vor dem letzten vorhandenen Stand.'));
      END IF;
    END IF;

    IF COALESCE(jsonb_array_length(v_obj->'gruende'), 0) = 0 THEN
      v_obj := jsonb_set(v_obj, '{accepted}', 'true'::jsonb);
      v_obj := jsonb_set(v_obj, '{series_id}', to_jsonb(v_series));
    END IF;
    v_rows[v_pick] := v_obj;
  END LOOP;

  WITH timeline AS (
    SELECT
      (existing->>'meter_id')::uuid AS meter_id,
      (existing->>'series_id')::uuid AS series_id,
      (existing->>'reading_id')::uuid AS reading_id,
      (existing->>'reading_at')::timestamptz AS reading_at,
      (existing->>'created_at')::timestamptz AS created_at,
      existing->>'reading_type' AS reading_type,
      (existing->>'reading_value')::numeric AS reading_value
    FROM jsonb_array_elements(v_existing) AS existing
    UNION ALL
    SELECT
      (other->>'meter_id')::uuid,
      (other->>'series_id')::uuid,
      NULL::uuid,
      (other->>'reading_at')::timestamptz,
      now(),
      'regular',
      (other->>'reading_value')::numeric
    FROM unnest(v_rows) AS other
    WHERE (other->>'accepted')::boolean IS TRUE
  ),
  calculated AS (
    SELECT
      reading_id,
      reading_at,
      CASE
        WHEN lag(reading_value) OVER w IS NULL THEN NULL
        WHEN reading_type = 'reset' THEN NULL
        WHEN lag(reading_type) OVER w IN ('reset', 'regular')
             AND reading_value >= lag(reading_value) OVER w
          THEN reading_value - lag(reading_value) OVER w
        ELSE NULL
      END AS danach
    FROM timeline
    WINDOW w AS (PARTITION BY meter_id, series_id ORDER BY reading_at, created_at)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'reading_id', consumption.reading_id,
    'bisher', consumption.consumption_value,
    'danach', calculated.danach
  ) ORDER BY calculated.reading_at), '[]'::jsonb)
    INTO v_effects
  FROM calculated
  JOIN public.utility_meter_consumption consumption
    ON consumption.reading_id = calculated.reading_id
  WHERE calculated.reading_id IS NOT NULL
    AND consumption.consumption_value IS DISTINCT FROM calculated.danach;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'datensatz_id', elem->>'datensatz_id',
      'status', CASE WHEN (elem->>'accepted')::boolean THEN 'uebernehmbar' ELSE 'blockiert' END,
      'gruende', COALESCE(elem->'gruende', '[]'::jsonb)
    ) ORDER BY (elem->>'accepted')::boolean, (elem->>'ord')::integer), '[]'::jsonb),
    count(*) FILTER (WHERE (elem->>'accepted')::boolean),
    count(*) FILTER (WHERE (elem->>'accepted')::boolean IS NOT TRUE)
    INTO v_zeilen, v_ready, v_blocked
  FROM unnest(v_rows) AS elem;

  IF v_blocked = 0 THEN
    SELECT COALESCE(jsonb_agg(elem ORDER BY (elem->>'reading_at')::timestamptz, (elem->>'ord')::integer), '[]'::jsonb)
      INTO v_records
    FROM unnest(v_rows) AS elem
    WHERE (elem->>'accepted')::boolean IS TRUE;
  ELSE
    v_records := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'uebernehmbar', v_ready,
    'blockiert', v_blocked,
    'schreibbar', v_blocked = 0 AND v_ready > 0,
    'zeilen', v_zeilen,
    'verbrauchsauswirkungen', COALESCE(v_effects, '[]'::jsonb),
    'datensaetze', COALESCE(v_records, '[]'::jsonb)
  );
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_preview_historical_import(
  p_facility_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $tageswerk$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.tageswerk_assess_historical_import(p_facility_id, p_payload);
  RETURN v_result - 'datensaetze';
END;
$tageswerk$;

REVOKE ALL ON FUNCTION public.tageswerk_preview_historical_import(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_assess_historical_import(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_preview_historical_import(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_assess_historical_import(uuid, jsonb) TO authenticated;

DO $keep$
BEGIN
  IF position(
    'Der Zählerstand passt nicht zwischen die benachbarten Ablesungen'
    IN pg_get_functiondef('public.tageswerk_prepare_reading()'::regprocedure)
  ) = 0 THEN
    RAISE EXCEPTION 'tageswerk_prepare_reading wurde verändert. Transaktion wird zurückgesetzt.';
  END IF;
  IF to_regprocedure('public.tageswerk_commit_historical_import(uuid,uuid,text,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'Commit-RPC darf durch diese Datei nicht entstehen.';
  END IF;
END;
$keep$;

COMMIT;
