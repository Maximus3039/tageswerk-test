-- Tageswerk 2.9, historischer Zählerimport
-- Entwurf für PostgreSQL 17.11. Noch nicht in Supabase ausführen.
-- Keine bestehenden Ablesungen ändern und keine Zähler anlegen.
--
-- Diese Datei setzt die bereits vorhandenen Tabellen und
-- tageswerk_prepare_reading voraus. Sie ersetzt diese Funktion
-- und ergänzt die Importtabellen einschließlich der Freigaben.
-- Der übrige Rumpf stammt aus tageswerk_2_9_migration.sql.
-- Geändert ist die Ablehnung deaktivierter Zähler. Sie gilt nur,
-- während tageswerk_commit_historical_import als Eigentümer läuft
-- und eine noch nicht verbrauchte Freigabezeile vorhanden ist.
-- Vor der Ausführung den live-Rumpf vergleichen:
--   SELECT md5(pg_get_functiondef('public.tageswerk_prepare_reading()'::regprocedure));
-- Weicht er vom lokalen Migrationsrumpf ab, diese Datei nicht anwenden.
-- Die ältere Migration danach nicht erneut ausführen.
--
-- Eine Sitzungsvariable verleiht keine Berechtigung.
-- Historische Ablesungen deaktivierter Zähler entstehen nur in
-- tageswerk_commit_historical_import. Die Funktion ist SECURITY
-- DEFINER und legt vorher eine Einmalzeile in
-- utility_meter_import_permits an. Der Trigger verbraucht sie nur,
-- wenn der aktuelle Benutzer der Eigentümer dieser Funktion ist.
-- anon, authenticated und service_role können die Zeile nicht
-- schreiben, nicht lesen und die Ausstell- oder Verbrauchfunktion
-- nicht aufrufen. Ein direkter INSERT löst die Sonderfreigabe
-- deshalb nicht aus und verbraucht sie auch nicht.
-- Der Eigentümer der Funktion kann Freigaben weiterhin selbst
-- schreiben. Das ist die verbleibende Grenze.
-- Normale Erfassung, Korrektur, Rücksetzung und Zählerwechsel
-- legen keine Freigabe an und bleiben unverändert.
-- Die Funktion erfindet keine Uhrzeit. 09:00 und 21:00 sind keine Vorgabe.

BEGIN;

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

CREATE OR REPLACE FUNCTION public.tageswerk_import_medium_unit(
  p_art text,
  p_einheit text
)
RETURNS TABLE (medium text, unit text)
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $tageswerk$
  WITH folded AS (
    SELECT
      translate(
        btrim(p_art),
        'ÄÖÜäöüABCDEFGHIJKLMNOPQRSTUVWXYZ',
        'aouaouabcdefghijklmnopqrstuvwxyz'
      ) AS art,
      translate(
        btrim(p_einheit),
        'ÄÖÜäöü³ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        'aouaou3abcdefghijklmnopqrstuvwxyz'
      ) AS einheit
  )
  SELECT map.medium, map.unit
  FROM folded
  JOIN (
    VALUES
      ('wasser', 'm3', 'water', 'm3'),
      ('strom', 'kwh', 'electricity', 'kWh'),
      ('erdgas', 'm3', 'gas', 'm3'),
      ('erdgas', 'kwh', 'gas', 'kWh'),
      ('gas', 'm3', 'gas', 'm3'),
      ('gas', 'kwh', 'gas', 'kWh'),
      ('warme', 'kwh', 'heat', 'kWh'),
      ('warme', 'm3', 'heat', 'm3'),
      ('waerme', 'kwh', 'heat', 'kWh'),
      ('waerme', 'm3', 'heat', 'm3')
  ) AS map(art, einheit, medium, unit)
    ON map.art = folded.art
   AND map.einheit = folded.einheit;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_reject_import_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  RAISE EXCEPTION 'Importierte Herkunftsdaten werden nicht gelöscht.';
END;
$tageswerk$;

CREATE TABLE public.utility_meter_import_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  excel_schluessel text NOT NULL,
  excel_bezeichnung text NOT NULL,
  excel_verbrauchsart text NOT NULL,
  excel_einheit text NOT NULL,
  meter_id uuid NOT NULL REFERENCES public.utility_meters (id),
  altbestand_bestaetigt boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by uuid NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid,
  CONSTRAINT utility_meter_import_mappings_facility_org_fk
    FOREIGN KEY (facility_id, organization_id)
    REFERENCES public.facilities (id, organization_id),
  CONSTRAINT utility_meter_import_mappings_key_check
    CHECK (char_length(btrim(excel_schluessel)) BETWEEN 1 AND 200),
  CONSTRAINT utility_meter_import_mappings_label_check
    CHECK (char_length(btrim(excel_bezeichnung)) BETWEEN 1 AND 200),
  CONSTRAINT utility_meter_import_mappings_medium_check
    CHECK (char_length(btrim(excel_verbrauchsart)) BETWEEN 1 AND 50),
  CONSTRAINT utility_meter_import_mappings_unit_check
    CHECK (char_length(btrim(excel_einheit)) BETWEEN 1 AND 20),
  CONSTRAINT utility_meter_import_mappings_revoke_check CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX utility_meter_import_mappings_active_key
  ON public.utility_meter_import_mappings (facility_id, excel_schluessel)
  WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX utility_meter_import_mappings_active_meter
  ON public.utility_meter_import_mappings (meter_id)
  WHERE revoked_at IS NULL;

CREATE TABLE public.utility_meter_import_batches (
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

CREATE UNIQUE INDEX utility_meter_import_batches_token_key
  ON public.utility_meter_import_batches (facility_id, client_token);
CREATE UNIQUE INDEX utility_meter_import_batches_hash_key
  ON public.utility_meter_import_batches (facility_id, inhalt_sha256)
  WHERE status = 'uebernommen';

CREATE TABLE public.utility_meter_import_readings (
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

CREATE UNIQUE INDEX utility_meter_import_readings_cell_key
  ON public.utility_meter_import_readings (facility_id, quelle_blatt, quelle_zelle);
CREATE UNIQUE INDEX utility_meter_import_readings_record_key
  ON public.utility_meter_import_readings (batch_id, datensatz_id);
CREATE UNIQUE INDEX utility_meter_import_readings_reading_key
  ON public.utility_meter_import_readings (reading_id)
  WHERE reading_id IS NOT NULL;
CREATE INDEX utility_meter_import_readings_open_match
  ON public.utility_meter_import_readings (batch_id, meter_id, ablesezeit_bestaetigt)
  WHERE reading_id IS NULL;

CREATE OR REPLACE FUNCTION public.tageswerk_prepare_import_mapping()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  v_meter public.utility_meters%ROWTYPE;
  v_medium text;
  v_unit text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Eine Anmeldung ist erforderlich.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'Eine aufgehobene Zählerzuordnung bleibt aufgehoben.';
    END IF;
    IF NEW.facility_id IS DISTINCT FROM OLD.facility_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.excel_schluessel IS DISTINCT FROM OLD.excel_schluessel
       OR NEW.excel_bezeichnung IS DISTINCT FROM OLD.excel_bezeichnung
       OR NEW.excel_verbrauchsart IS DISTINCT FROM OLD.excel_verbrauchsart
       OR NEW.excel_einheit IS DISTINCT FROM OLD.excel_einheit
       OR NEW.meter_id IS DISTINCT FROM OLD.meter_id
       OR NEW.altbestand_bestaetigt IS DISTINCT FROM OLD.altbestand_bestaetigt
       OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
       OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
      RAISE EXCEPTION 'Eine Zählerzuordnung kann nur aufgehoben werden.';
    END IF;
    IF NEW.revoked_at IS NULL THEN
      RAISE EXCEPTION 'Eine Zählerzuordnung kann nur aufgehoben werden.';
    END IF;
    IF public.tageswerk_meter_role(OLD.organization_id, OLD.facility_id)
         NOT IN ('company_admin', 'facility_manager') THEN
      RAISE EXCEPTION 'Historische Importe darf die Betriebsleitung oder Geschäftsführung.';
    END IF;
    NEW.revoked_at := now();
    NEW.revoked_by := auth.uid();
    RETURN NEW;
  END IF;

  SELECT * INTO v_meter
  FROM public.utility_meters
  WHERE id = NEW.meter_id;
  IF NOT FOUND OR v_meter.facility_id IS DISTINCT FROM NEW.facility_id THEN
    RAISE EXCEPTION 'Der Zähler gehört nicht zu diesem Betrieb.';
  END IF;
  NEW.organization_id := v_meter.organization_id;
  NEW.excel_schluessel := btrim(NEW.excel_schluessel);
  NEW.excel_bezeichnung := btrim(NEW.excel_bezeichnung);
  NEW.excel_verbrauchsart := btrim(NEW.excel_verbrauchsart);
  NEW.excel_einheit := btrim(NEW.excel_einheit);
  IF public.tageswerk_meter_role(NEW.organization_id, NEW.facility_id)
       NOT IN ('company_admin', 'facility_manager') THEN
    RAISE EXCEPTION 'Historische Importe darf die Betriebsleitung oder Geschäftsführung.';
  END IF;
  SELECT mapped.medium, mapped.unit
    INTO v_medium, v_unit
  FROM public.tageswerk_import_medium_unit(NEW.excel_verbrauchsart, NEW.excel_einheit) AS mapped;
  IF v_medium IS NULL THEN
    RAISE EXCEPTION 'Verbrauchsart oder Einheit lässt sich keinem Tageswerk-Zähler zuordnen.';
  END IF;
  IF v_meter.medium IS DISTINCT FROM v_medium OR v_meter.unit IS DISTINCT FROM v_unit THEN
    RAISE EXCEPTION 'Verbrauchsart oder Einheit passt nicht zum Zähler.';
  END IF;
  IF NEW.altbestand_bestaetigt IS TRUE AND v_meter.is_active IS TRUE THEN
    RAISE EXCEPTION 'Altbestand gilt nur für einen deaktivierten Zähler.';
  END IF;
  NEW.confirmed_by := auth.uid();
  NEW.confirmed_at := now();
  NEW.revoked_at := NULL;
  NEW.revoked_by := NULL;
  RETURN NEW;
END;
$tageswerk$;

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

CREATE TRIGGER utility_meter_import_mappings_prepare
  BEFORE INSERT OR UPDATE ON public.utility_meter_import_mappings
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_prepare_import_mapping();
CREATE TRIGGER utility_meter_import_mappings_no_delete
  BEFORE DELETE ON public.utility_meter_import_mappings
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_reject_import_delete();
CREATE TRIGGER utility_meter_import_batches_prepare
  BEFORE INSERT OR UPDATE ON public.utility_meter_import_batches
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_prepare_import_batch();
CREATE TRIGGER utility_meter_import_batches_no_delete
  BEFORE DELETE ON public.utility_meter_import_batches
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_reject_import_delete();
CREATE TRIGGER utility_meter_import_readings_prepare
  BEFORE INSERT OR UPDATE ON public.utility_meter_import_readings
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_prepare_import_reading();
CREATE TRIGGER utility_meter_import_readings_no_delete
  BEFORE DELETE ON public.utility_meter_import_readings
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_reject_import_delete();

ALTER TABLE public.utility_meter_import_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_meter_import_mappings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.utility_meter_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_meter_import_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.utility_meter_import_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_meter_import_readings FORCE ROW LEVEL SECURITY;

CREATE POLICY utility_meter_import_mappings_select
  ON public.utility_meter_import_mappings
  FOR SELECT TO authenticated
  USING (
    public.tageswerk_meter_role(organization_id, facility_id)
      IN ('company_admin', 'facility_manager')
  );
CREATE POLICY utility_meter_import_mappings_insert
  ON public.utility_meter_import_mappings
  FOR INSERT TO authenticated
  WITH CHECK (
    public.tageswerk_meter_role(organization_id, facility_id)
      IN ('company_admin', 'facility_manager')
  );
CREATE POLICY utility_meter_import_mappings_update
  ON public.utility_meter_import_mappings
  FOR UPDATE TO authenticated
  USING (
    public.tageswerk_meter_role(organization_id, facility_id)
      IN ('company_admin', 'facility_manager')
  )
  WITH CHECK (
    public.tageswerk_meter_role(organization_id, facility_id)
      IN ('company_admin', 'facility_manager')
  );

CREATE POLICY utility_meter_import_batches_select
  ON public.utility_meter_import_batches
  FOR SELECT TO authenticated
  USING (
    public.tageswerk_meter_role(organization_id, facility_id)
      IN ('company_admin', 'facility_manager')
  );
CREATE POLICY utility_meter_import_batches_insert
  ON public.utility_meter_import_batches
  FOR INSERT TO authenticated
  WITH CHECK (
    public.tageswerk_meter_role(organization_id, facility_id)
      IN ('company_admin', 'facility_manager')
  );
CREATE POLICY utility_meter_import_batches_update
  ON public.utility_meter_import_batches
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    AND public.tageswerk_meter_role(organization_id, facility_id)
          IN ('company_admin', 'facility_manager')
  )
  WITH CHECK (
    created_by = auth.uid()
    AND public.tageswerk_meter_role(organization_id, facility_id)
          IN ('company_admin', 'facility_manager')
  );

CREATE POLICY utility_meter_import_readings_select
  ON public.utility_meter_import_readings
  FOR SELECT TO authenticated
  USING (
    public.tageswerk_meter_role(organization_id, facility_id)
      IN ('company_admin', 'facility_manager')
  );
CREATE POLICY utility_meter_import_readings_insert
  ON public.utility_meter_import_readings
  FOR INSERT TO authenticated
  WITH CHECK (
    public.tageswerk_meter_role(organization_id, facility_id)
      IN ('company_admin', 'facility_manager')
  );
CREATE POLICY utility_meter_import_readings_update
  ON public.utility_meter_import_readings
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.utility_meter_import_batches batch
      WHERE batch.id = utility_meter_import_readings.batch_id
        AND batch.created_by = auth.uid()
        AND public.tageswerk_meter_role(batch.organization_id, batch.facility_id)
              IN ('company_admin', 'facility_manager')
    )
  )
  WITH CHECK (
    public.tageswerk_meter_role(organization_id, facility_id)
      IN ('company_admin', 'facility_manager')
  );

CREATE TABLE public.utility_meter_import_permits (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.utility_meter_import_batches (id),
  meter_id uuid NOT NULL REFERENCES public.utility_meters (id),
  reading_value numeric(14,3) NOT NULL,
  reading_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (batch_id, meter_id, reading_value, reading_at)
);

ALTER TABLE public.utility_meter_import_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_meter_import_permits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.utility_meter_import_permits
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tageswerk_issue_historical_permit(
  p_batch_id uuid,
  p_meter_id uuid,
  p_reading_value numeric,
  p_reading_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  v_batch public.utility_meter_import_batches%ROWTYPE;
  v_meter public.utility_meters%ROWTYPE;
  v_role text;
BEGIN
  IF auth.uid() IS NULL
     OR p_batch_id IS NULL
     OR p_meter_id IS NULL
     OR p_reading_value IS NULL
     OR p_reading_at IS NULL THEN
    RAISE EXCEPTION 'Die historische Freigabe ist unvollständig.';
  END IF;

  SELECT batch.*
    INTO v_batch
  FROM public.utility_meter_import_batches AS batch
  WHERE batch.id = p_batch_id;
  IF NOT FOUND
     OR v_batch.status IS DISTINCT FROM 'offen'
     OR v_batch.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Der Importvorgang darf keine historische Ablesung freigeben.';
  END IF;

  SELECT meter.*
    INTO v_meter
  FROM public.utility_meters AS meter
  WHERE meter.id = p_meter_id;
  IF NOT FOUND
     OR v_meter.facility_id IS DISTINCT FROM v_batch.facility_id
     OR v_meter.organization_id IS DISTINCT FROM v_batch.organization_id THEN
    RAISE EXCEPTION 'Der Zähler gehört nicht zum Importvorgang.';
  END IF;

  v_role := public.tageswerk_meter_role(v_batch.organization_id, v_batch.facility_id);
  IF v_role NOT IN ('company_admin', 'facility_manager') THEN
    RAISE EXCEPTION 'Historische Importe darf die Betriebsleitung oder Geschäftsführung.';
  END IF;

  INSERT INTO public.utility_meter_import_permits (
    batch_id, meter_id, reading_value, reading_at
  ) VALUES (
    p_batch_id, p_meter_id, p_reading_value, p_reading_at
  );
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_consume_historical_permit(
  p_meter_id uuid,
  p_reading_value numeric,
  p_reading_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL
     OR p_meter_id IS NULL
     OR p_reading_value IS NULL
     OR p_reading_at IS NULL THEN
    RETURN false;
  END IF;

  WITH picked AS (
    SELECT candidate.id
    FROM public.utility_meter_import_permits AS candidate
    JOIN public.utility_meter_import_batches AS batch
      ON batch.id = candidate.batch_id
    JOIN public.utility_meters AS meter
      ON meter.id = candidate.meter_id
    WHERE candidate.meter_id = p_meter_id
      AND candidate.reading_value = p_reading_value
      AND candidate.reading_at = p_reading_at
      AND batch.status = 'offen'
      AND batch.created_by = auth.uid()
      AND batch.facility_id = meter.facility_id
      AND batch.organization_id = meter.organization_id
      AND public.tageswerk_meter_role(batch.organization_id, batch.facility_id)
            IN ('company_admin', 'facility_manager')
    ORDER BY candidate.created_at, candidate.id
    FOR UPDATE OF candidate SKIP LOCKED
    LIMIT 1
  )
  DELETE FROM public.utility_meter_import_permits AS permit
  USING picked
  WHERE permit.id = picked.id
  RETURNING permit.id INTO v_id;

  RETURN v_id IS NOT NULL;
END;
$tageswerk$;

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

CREATE OR REPLACE FUNCTION public.tageswerk_prepare_reading()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  meter public.utility_meters%ROWTYPE;
  actor_role text;
  original public.utility_meter_readings%ROWTYPE;
  previous_reading public.utility_meter_readings%ROWTYPE;
  next_reading public.utility_meter_readings%ROWTYPE;
  previous_value numeric;
  next_value numeric;
  fallback_value numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Eine Anmeldung ist erforderlich.';
  END IF;

  SELECT * INTO meter
  FROM public.utility_meters
  WHERE id = CASE WHEN TG_OP = 'UPDATE' THEN OLD.meter_id ELSE NEW.meter_id END;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Zähler wurde nicht gefunden.';
  END IF;

  actor_role := public.tageswerk_meter_role(meter.organization_id, meter.facility_id);
  IF actor_role IS NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung für diesen Zähler.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('tageswerk.utility_facility'),
    hashtext(meter.facility_id::text)
  );

  SELECT * INTO meter
  FROM public.utility_meters
  WHERE id = CASE WHEN TG_OP = 'UPDATE' THEN OLD.meter_id ELSE NEW.meter_id END;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'Eine Stornierung ist endgültig.';
    END IF;
    IF NEW.meter_id IS DISTINCT FROM OLD.meter_id
       OR NEW.series_id IS DISTINCT FROM OLD.series_id
       OR NEW.reading_type IS DISTINCT FROM OLD.reading_type
       OR NEW.reading_value IS DISTINCT FROM OLD.reading_value
       OR NEW.reading_at IS DISTINCT FROM OLD.reading_at
       OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.note IS DISTINCT FROM OLD.note
       OR NEW.photo_path IS DISTINCT FROM OLD.photo_path
       OR NEW.corrects_reading_id IS DISTINCT FROM OLD.corrects_reading_id
       OR NEW.parent_meter_id IS DISTINCT FROM OLD.parent_meter_id
       OR NEW.counts_in_facility_total IS DISTINCT FROM OLD.counts_in_facility_total THEN
      RAISE EXCEPTION 'Eine Stornierung ändert nur den Stornierungsvermerk.';
    END IF;
    IF NEW.voided_at IS NULL OR NEW.void_reason IS NULL THEN
      RAISE EXCEPTION 'Eine vorhandene Ablesung kann nur mit Begründung storniert werden.';
    END IF;
    IF actor_role NOT IN ('company_admin', 'facility_manager') THEN
      RAISE EXCEPTION 'Stornieren darf die Betriebsleitung oder Geschäftsführung.';
    END IF;

    NEW.voided_at := now();
    NEW.voided_by := auth.uid();
    NEW.void_reason := btrim(NEW.void_reason);

    IF OLD.reading_type <> 'correction'
       AND EXISTS (
         SELECT 1
         FROM public.utility_meter_readings correction
         WHERE correction.corrects_reading_id = OLD.id
           AND correction.voided_at IS NULL
       ) THEN
      RAISE EXCEPTION 'Diese Ablesung hat eine gültige Korrektur und kann nicht storniert werden. Stornieren Sie zuerst die Korrektur.';
    END IF;

    IF OLD.reading_type = 'reset'
       AND EXISTS (
         SELECT 1
         FROM public.utility_meter_readings later
         WHERE later.meter_id = OLD.meter_id
           AND later.id <> OLD.id
           AND later.voided_at IS NULL
           AND later.reading_type <> 'correction'
           AND later.reading_at > OLD.reading_at
       ) THEN
      RAISE EXCEPTION 'Eine Rücksetzung mit späteren Ablesungen kann nicht storniert werden.';
    END IF;

    IF OLD.reading_type <> 'correction'
       AND NOT EXISTS (
         SELECT 1
         FROM public.utility_meter_readings earlier
         WHERE earlier.meter_id = OLD.meter_id
           AND earlier.series_id = OLD.series_id
           AND earlier.id <> OLD.id
           AND earlier.voided_at IS NULL
           AND earlier.reading_type <> 'correction'
           AND earlier.reading_at < OLD.reading_at
       )
       AND EXISTS (
         SELECT 1
         FROM public.utility_meter_readings later
         WHERE later.meter_id = OLD.meter_id
           AND later.series_id = OLD.series_id
           AND later.id <> OLD.id
           AND later.voided_at IS NULL
           AND later.reading_type <> 'correction'
           AND later.reading_at > OLD.reading_at
       ) THEN
      RAISE EXCEPTION 'Der erste Stand einer fortgesetzten Zählreihe kann nicht storniert werden.';
    END IF;

    IF OLD.reading_type = 'regular'
       AND EXISTS (
         SELECT 1
         FROM public.utility_meter_readings later
         WHERE later.meter_id = OLD.meter_id
           AND later.series_id = OLD.series_id
           AND later.voided_at IS NULL
           AND later.reading_type = 'reset'
           AND later.reading_at > OLD.reading_at
           AND NOT EXISTS (
             SELECT 1
             FROM public.utility_meter_readings between_reading
             WHERE between_reading.meter_id = OLD.meter_id
               AND between_reading.series_id = OLD.series_id
               AND between_reading.id <> OLD.id
               AND between_reading.voided_at IS NULL
               AND between_reading.reading_type = 'regular'
               AND between_reading.reading_at > OLD.reading_at
               AND between_reading.reading_at < later.reading_at
           )
       ) THEN
      RAISE EXCEPTION 'Der letzte normale Stand vor einer Rücksetzung kann nicht storniert werden.';
    END IF;

    IF OLD.reading_type = 'correction' THEN
      SELECT * INTO original
      FROM public.utility_meter_readings
      WHERE id = OLD.corrects_reading_id;
      SELECT COALESCE(
        (
          SELECT other.reading_value
          FROM public.utility_meter_readings other
          WHERE other.corrects_reading_id = original.id
            AND other.id <> OLD.id
            AND other.voided_at IS NULL
          ORDER BY other.created_at DESC, other.id DESC
          LIMIT 1
        ),
        original.reading_value
      ) INTO fallback_value;
      SELECT * INTO previous_reading
      FROM public.utility_meter_readings anchor
      WHERE anchor.meter_id = original.meter_id
        AND anchor.series_id = original.series_id
        AND anchor.id <> original.id
        AND anchor.voided_at IS NULL
        AND anchor.reading_type <> 'correction'
        AND anchor.reading_at < original.reading_at
      ORDER BY anchor.reading_at DESC, anchor.created_at DESC
      LIMIT 1;
      SELECT * INTO next_reading
      FROM public.utility_meter_readings anchor
      WHERE anchor.meter_id = original.meter_id
        AND anchor.series_id = original.series_id
        AND anchor.id <> original.id
        AND anchor.voided_at IS NULL
        AND anchor.reading_type <> 'correction'
        AND anchor.reading_at > original.reading_at
      ORDER BY anchor.reading_at ASC, anchor.created_at ASC
      LIMIT 1;
      IF original.reading_type = 'regular' THEN
        previous_value := CASE WHEN previous_reading.id IS NULL THEN NULL
          ELSE public.tageswerk_effective_reading_value(previous_reading.id) END;
        next_value := CASE
          WHEN next_reading.id IS NULL OR next_reading.reading_type = 'reset' THEN NULL
          ELSE public.tageswerk_effective_reading_value(next_reading.id) END;
        IF (previous_value IS NOT NULL AND fallback_value < previous_value)
           OR (next_value IS NOT NULL AND fallback_value > next_value) THEN
          RAISE EXCEPTION 'Die Stornierung würde einen unplausiblen Zählerstand wiederherstellen.';
        END IF;
      ELSIF original.reading_type = 'reset' THEN
        IF next_reading.id IS NOT NULL THEN
          IF next_reading.reading_type IS DISTINCT FROM 'regular'
             OR fallback_value > public.tageswerk_effective_reading_value(next_reading.id) THEN
            RAISE EXCEPTION 'Die Stornierung würde einen unplausiblen Rücksetzstand wiederherstellen.';
          END IF;
        END IF;
      ELSE
        RAISE EXCEPTION 'Diese Korrektur kann nicht sicher storniert werden.';
      END IF;
    ELSIF OLD.reading_type = 'regular' THEN
      SELECT * INTO previous_reading
      FROM public.utility_meter_readings anchor
      WHERE anchor.meter_id = OLD.meter_id
        AND anchor.series_id = OLD.series_id
        AND anchor.id <> OLD.id
        AND anchor.voided_at IS NULL
        AND anchor.reading_type <> 'correction'
        AND anchor.reading_at < OLD.reading_at
      ORDER BY anchor.reading_at DESC, anchor.created_at DESC
      LIMIT 1;
      SELECT * INTO next_reading
      FROM public.utility_meter_readings anchor
      WHERE anchor.meter_id = OLD.meter_id
        AND anchor.series_id = OLD.series_id
        AND anchor.id <> OLD.id
        AND anchor.voided_at IS NULL
        AND anchor.reading_type <> 'correction'
        AND anchor.reading_at > OLD.reading_at
      ORDER BY anchor.reading_at ASC, anchor.created_at ASC
      LIMIT 1;
      IF previous_reading.id IS NOT NULL
         AND next_reading.reading_type = 'regular'
         AND public.tageswerk_effective_reading_value(next_reading.id)
             < public.tageswerk_effective_reading_value(previous_reading.id) THEN
        RAISE EXCEPTION 'Die Stornierung würde die Zählreihe unplausibel machen.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.reading_type <> 'correction' AND meter.is_active IS NOT TRUE THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS funktion
      WHERE funktion.oid = 'public.tageswerk_commit_historical_import(uuid,uuid,text,text,jsonb)'::pg_catalog.regprocedure
        AND funktion.proowner = CURRENT_USER::pg_catalog.regrole
    ) THEN
      RAISE EXCEPTION 'Für einen deaktivierten Zähler wird keine neue Ablesung erfasst. Korrekturen bleiben möglich.';
    END IF;
    IF NOT public.tageswerk_consume_historical_permit(
      NEW.meter_id,
      NEW.reading_value,
      NEW.reading_at
    ) THEN
      RAISE EXCEPTION 'Für einen deaktivierten Zähler wird keine neue Ablesung erfasst. Korrekturen bleiben möglich.';
    END IF;
  END IF;
  IF actor_role = 'employee' AND NEW.reading_type <> 'regular' THEN
    RAISE EXCEPTION 'Mitarbeiter erfassen normale Zählerstände.';
  END IF;

  NEW.recorded_by := auth.uid();
  NEW.created_at := now();
  NEW.voided_at := NULL;
  NEW.voided_by := NULL;
  NEW.void_reason := NULL;
  NEW.note := NULLIF(btrim(NEW.note), '');
  NEW.photo_path := NULLIF(btrim(NEW.photo_path), '');
  NEW.parent_meter_id := meter.parent_meter_id;
  NEW.counts_in_facility_total := meter.parent_meter_id IS NULL AND meter.counts_in_facility_total;

  IF NEW.reading_type = 'correction' THEN
    SELECT * INTO original
    FROM public.utility_meter_readings
    WHERE id = NEW.corrects_reading_id;
    IF NOT FOUND
       OR original.meter_id <> NEW.meter_id
       OR original.reading_type = 'correction'
       OR original.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'Die Korrektur bezieht sich auf eine gültige ursprüngliche Ablesung desselben Zählers.';
    END IF;
    NEW.series_id := original.series_id;
    NEW.reading_at := original.reading_at;
    NEW.parent_meter_id := original.parent_meter_id;
    NEW.counts_in_facility_total := original.counts_in_facility_total;
    SELECT * INTO previous_reading
    FROM public.utility_meter_readings anchor
    WHERE anchor.meter_id = original.meter_id
      AND anchor.series_id = original.series_id
      AND anchor.id <> original.id
      AND anchor.voided_at IS NULL
      AND anchor.reading_type <> 'correction'
      AND anchor.reading_at < original.reading_at
    ORDER BY anchor.reading_at DESC, anchor.created_at DESC
    LIMIT 1;
    SELECT * INTO next_reading
    FROM public.utility_meter_readings anchor
    WHERE anchor.meter_id = original.meter_id
      AND anchor.series_id = original.series_id
      AND anchor.id <> original.id
      AND anchor.voided_at IS NULL
      AND anchor.reading_type <> 'correction'
      AND anchor.reading_at > original.reading_at
    ORDER BY anchor.reading_at ASC, anchor.created_at ASC
    LIMIT 1;
    IF original.reading_type = 'regular' THEN
      previous_value := CASE WHEN previous_reading.id IS NULL THEN NULL
        ELSE public.tageswerk_effective_reading_value(previous_reading.id) END;
      next_value := CASE
        WHEN next_reading.id IS NULL OR next_reading.reading_type = 'reset' THEN NULL
        ELSE public.tageswerk_effective_reading_value(next_reading.id) END;
      IF (previous_value IS NOT NULL AND NEW.reading_value < previous_value)
         OR (next_value IS NOT NULL AND NEW.reading_value > next_value) THEN
        RAISE EXCEPTION 'Der korrigierte Stand passt nicht zu den benachbarten Ablesungen.';
      END IF;
    ELSIF original.reading_type = 'reset' THEN
      IF next_reading.id IS NOT NULL THEN
        IF next_reading.reading_type IS DISTINCT FROM 'regular'
           OR NEW.reading_value > public.tageswerk_effective_reading_value(next_reading.id) THEN
          RAISE EXCEPTION 'Der korrigierte Rücksetzstand passt nicht zur folgenden Ablesung.';
        END IF;
      END IF;
    ELSE
      RAISE EXCEPTION 'Diese Ablesung kann nicht korrigiert werden.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.reading_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Die Ablesezeit liegt in der Zukunft.';
  END IF;

  SELECT * INTO previous_reading
  FROM public.utility_meter_readings anchor
  WHERE anchor.meter_id = NEW.meter_id
    AND anchor.voided_at IS NULL
    AND anchor.reading_type <> 'correction'
    AND anchor.reading_at < NEW.reading_at
  ORDER BY anchor.reading_at DESC, anchor.created_at DESC
  LIMIT 1;
  SELECT * INTO next_reading
  FROM public.utility_meter_readings anchor
  WHERE anchor.meter_id = NEW.meter_id
    AND anchor.voided_at IS NULL
    AND anchor.reading_type <> 'correction'
    AND anchor.reading_at > NEW.reading_at
  ORDER BY anchor.reading_at ASC, anchor.created_at ASC
  LIMIT 1;

  IF NEW.reading_type = 'reset' THEN
    IF next_reading.id IS NOT NULL THEN
      RAISE EXCEPTION 'Eine Rücksetzung ist nur nach der letzten Ablesung möglich.';
    END IF;
    IF previous_reading.reading_type IS DISTINCT FROM 'regular' THEN
      RAISE EXCEPTION 'Eine Rücksetzung braucht zuvor einen normalen Stand als Verbrauchsgrenze.';
    END IF;
    NEW.series_id := previous_reading.series_id;
    RETURN NEW;
  END IF;

  IF previous_reading.id IS NULL THEN
    NEW.series_id := COALESCE(next_reading.series_id, gen_random_uuid());
  ELSE
    NEW.series_id := previous_reading.series_id;
  END IF;

  previous_value := CASE
    WHEN previous_reading.id IS NULL OR previous_reading.series_id IS DISTINCT FROM NEW.series_id THEN NULL
    ELSE public.tageswerk_effective_reading_value(previous_reading.id)
  END;
  next_value := CASE
    WHEN next_reading.id IS NULL
         OR next_reading.series_id IS DISTINCT FROM NEW.series_id
         OR next_reading.reading_type = 'reset' THEN NULL
    ELSE public.tageswerk_effective_reading_value(next_reading.id)
  END;
  IF (previous_value IS NOT NULL AND NEW.reading_value < previous_value)
     OR (next_value IS NOT NULL AND NEW.reading_value > next_value) THEN
    RAISE EXCEPTION 'Der Zählerstand passt nicht zwischen die benachbarten Ablesungen.';
  END IF;
  RETURN NEW;
END;
$tageswerk$;

REVOKE ALL ON FUNCTION public.tageswerk_import_parse_stand(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_import_medium_unit(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_reject_import_delete() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_prepare_import_mapping() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_prepare_import_batch() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_prepare_import_reading() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_issue_historical_permit(uuid, uuid, numeric, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.tageswerk_consume_historical_permit(uuid, numeric, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.tageswerk_import_require_manager(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_assess_historical_import(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_preview_historical_import(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_commit_historical_import(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.tageswerk_prepare_reading() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.tageswerk_import_parse_stand(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_import_medium_unit(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_reject_import_delete() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_prepare_import_mapping() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_prepare_import_batch() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_prepare_import_reading() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_import_require_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_assess_historical_import(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_preview_historical_import(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_commit_historical_import(uuid, uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_prepare_reading() TO authenticated;

REVOKE ALL ON TABLE public.utility_meter_import_mappings FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.utility_meter_import_batches FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.utility_meter_import_readings FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.utility_meter_import_permits FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.utility_meter_import_mappings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.utility_meter_import_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.utility_meter_import_readings TO authenticated;

COMMIT;
