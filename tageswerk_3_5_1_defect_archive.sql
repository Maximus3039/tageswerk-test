-- Tageswerk 3.5.1: Archiv für abgeschlossene Mängel.
-- Einmal im SQL-Editor ausführen, nachdem diese Datei freigegeben ist.
-- Dieses Skript ändert keine bestehenden Mängel, Arbeitsvermerke oder Messdaten.
-- Die Strukturprüfung liest die vorhandene Tabelle und stoppt, wenn eine erwartete Spalte fehlt.
-- Bestehende RLS-Richtlinien werden nicht ersetzt. Der Trigger schützt archivierte Zeilen zusätzlich.
-- company_admin gilt nur mit facility_id IS NULL für die ganze Organisation, wie memberships_role_scope_check.
-- facility_manager gilt nur für die eigene facility_id. Mitarbeiter und Techniker archivieren nicht.
-- Eine frei gesetzte Einstellung reicht nicht. Nur ein Eintrag in tageswerk_private.defect_archive_permit erlaubt die Archivspalten.
-- authenticated hat Änderungsrechte für status, assigned_to und change_note und kein Tabellenrecht UPDATE.
-- Das Tabellenrecht UPDATE wird entzogen und nur für Spalten wieder erteilt, die vorher schon geändert werden durften.
-- Neue Objekte gehören danach dem Eigentümer von public.defects. Die Freigabezeile wird im Trigger gelöscht.
-- defect_events.organization_id und defect_events.facility_id sind Pflichtfelder ohne Vorgabewert.
-- private.audit_defect_change und private.require_defect_review_note bleiben unverändert.
-- Der Funktionstext dieser beiden Trigger liegt hier nicht vor und wird nicht nachgebildet.

BEGIN;

DO $structure$
DECLARE
  missing text;
  event_gap text;
BEGIN
  SELECT string_agg(expected.table_name || '.' || expected.column_name, ', ' ORDER BY expected.table_name, expected.column_name)
    INTO missing
  FROM (
    VALUES
      ('defects', 'id'),
      ('defects', 'organization_id'),
      ('defects', 'facility_id'),
      ('defects', 'title'),
      ('defects', 'description'),
      ('defects', 'priority'),
      ('defects', 'status'),
      ('defects', 'assigned_to'),
      ('defects', 'created_by'),
      ('defects', 'created_at'),
      ('defects', 'resolution_due_at'),
      ('defects', 'change_note'),
      ('defect_events', 'defect_id'),
      ('defect_events', 'organization_id'),
      ('defect_events', 'facility_id'),
      ('defect_events', 'action'),
      ('defect_events', 'note'),
      ('defect_events', 'actor_id'),
      ('defect_events', 'created_at'),
      ('memberships', 'user_id'),
      ('memberships', 'organization_id'),
      ('memberships', 'facility_id'),
      ('memberships', 'role'),
      ('memberships', 'is_active'),
      ('facilities', 'id'),
      ('facilities', 'organization_id')
  ) AS expected(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS live
    WHERE live.table_schema = 'public'
      AND live.table_name = expected.table_name
      AND live.column_name = expected.column_name
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Die vorhandene Mängelstruktur weicht ab. Fehlende Spalten: %', missing;
  END IF;

  SELECT string_agg(column_name, ', ' ORDER BY column_name)
    INTO event_gap
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'defect_events'
    AND is_nullable = 'NO'
    AND column_default IS NULL
    AND column_name NOT IN ('defect_id', 'action', 'note', 'actor_id', 'organization_id', 'facility_id');
  IF event_gap IS NOT NULL THEN
    RAISE EXCEPTION 'defect_events braucht weitere Pflichtspalten ohne Vorgabewert: %', event_gap;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'defect_events'
      AND column_name IN ('action', 'note')
      AND data_type NOT IN ('text', 'character varying')
  ) OR EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'defect_events'
      AND column_name IN ('actor_id', 'organization_id', 'facility_id')
      AND data_type <> 'uuid'
  ) OR EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'defect_events'
      AND column_name IN ('organization_id', 'facility_id')
      AND is_nullable <> 'NO'
  ) THEN
    RAISE EXCEPTION 'defect_events.action, note, actor_id, organization_id oder facility_id hat nicht den vom Verlauf erwarteten Typ.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.defects'::regclass
      AND relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.defect_events'::regclass
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS ist auf defects oder defect_events nicht aktiv.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polrelid = 'public.defects'::regclass
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polrelid = 'public.defect_events'::regclass
  ) THEN
    RAISE EXCEPTION 'Für defects oder defect_events fehlt eine RLS-Richtlinie.';
  END IF;
END;
$structure$;

ALTER TABLE public.defects
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

DO $columns$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'defects' AND column_name = 'archived_at'
      AND (data_type <> 'timestamp with time zone' OR is_nullable <> 'YES' OR column_default IS NOT NULL)
  ) OR EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'defects' AND column_name = 'archived_by'
      AND (data_type <> 'uuid' OR is_nullable <> 'YES' OR column_default IS NOT NULL)
  ) OR EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'defects' AND column_name = 'resolved_at'
      AND (data_type <> 'timestamp with time zone' OR is_nullable <> 'YES' OR column_default IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Die Archivspalten haben nicht den erwarteten Typ oder einen Vorgabewert.';
  END IF;
END;
$columns$;

ALTER TABLE public.defects DROP CONSTRAINT IF EXISTS defects_archive_pair_check;
ALTER TABLE public.defects
  ADD CONSTRAINT defects_archive_pair_check CHECK (
    (archived_at IS NULL AND archived_by IS NULL)
    OR (archived_at IS NOT NULL AND archived_by IS NOT NULL AND status = 'resolved')
  );

COMMENT ON COLUMN public.defects.archived_at IS 'Zeitpunkt der Archivierung. NULL heißt: nicht archiviert.';
COMMENT ON COLUMN public.defects.archived_by IS 'Person, die den abgeschlossenen Mangel archiviert hat.';
COMMENT ON COLUMN public.defects.resolved_at IS 'Zeitpunkt des Übergangs auf abgeschlossen. Bestehende Zeilen bleiben leer.';

CREATE SCHEMA IF NOT EXISTS tageswerk_private;
REVOKE ALL ON SCHEMA tageswerk_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS tageswerk_private.defect_archive_permit (
  defect_id uuid PRIMARY KEY,
  operation text NOT NULL,
  actor_id uuid NOT NULL,
  CONSTRAINT defect_archive_permit_operation CHECK (operation IN ('archive', 'restore'))
);

REVOKE ALL ON TABLE tageswerk_private.defect_archive_permit FROM PUBLIC, anon, authenticated;

DO $permit_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON TABLE tageswerk_private.defect_archive_permit FROM service_role;
  END IF;
END;
$permit_roles$;

CREATE OR REPLACE FUNCTION public.tageswerk_defect_archive_allowed(p_organization_id uuid, p_facility_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $allowed$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships AS membership
    WHERE membership.user_id = auth.uid()
      AND membership.is_active IS TRUE
      AND membership.organization_id = p_organization_id
      AND (
        (membership.role = 'company_admin' AND membership.facility_id IS NULL)
        OR (membership.role = 'facility_manager' AND membership.facility_id = p_facility_id)
      )
  );
$allowed$;

CREATE OR REPLACE FUNCTION public.tageswerk_defect_archive_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $guard$
DECLARE
  permit_operation text;
  old_body jsonb;
  new_body jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Archivierte Mängel können nicht gelöscht werden.';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.archived_at IS NOT NULL OR NEW.archived_by IS NOT NULL THEN
      RAISE EXCEPTION 'Archivierung ist nur über die vorgesehene Funktion möglich.';
    END IF;
    IF NEW.status = 'resolved' THEN
      NEW.resolved_at := pg_catalog.now();
    ELSIF NEW.resolved_at IS NOT NULL THEN
      NEW.resolved_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  SELECT permit.operation
    INTO permit_operation
  FROM tageswerk_private.defect_archive_permit AS permit
  WHERE permit.defect_id = NEW.id
    AND permit.actor_id = auth.uid();

  old_body := pg_catalog.to_jsonb(OLD) - 'archived_at' - 'archived_by' - 'resolved_at';
  new_body := pg_catalog.to_jsonb(NEW) - 'archived_at' - 'archived_by' - 'resolved_at';

  IF OLD.archived_at IS NOT NULL
     OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
     OR NEW.archived_by IS DISTINCT FROM OLD.archived_by THEN
    IF OLD.archived_at IS NOT NULL THEN
      IF permit_operation IS DISTINCT FROM 'restore' THEN
        RAISE EXCEPTION 'Archivierte Mängel können nicht verändert werden.';
      END IF;
      IF NEW.archived_at IS NOT NULL OR NEW.archived_by IS NOT NULL THEN
        RAISE EXCEPTION 'Die Wiederherstellung entfernt nur die Archivierung.';
      END IF;
      IF NEW.change_note IS DISTINCT FROM OLD.change_note
         OR NEW.status IS DISTINCT FROM OLD.status
         OR NEW.resolution_due_at IS DISTINCT FROM OLD.resolution_due_at
         OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
         OR old_body IS DISTINCT FROM new_body THEN
        RAISE EXCEPTION 'Die Wiederherstellung verändert keine Arbeitsvermerke, Fristen oder den Status.';
      END IF;
    ELSE
      IF permit_operation IS DISTINCT FROM 'archive' THEN
        RAISE EXCEPTION 'Archivierung ist nur über die vorgesehene Funktion möglich.';
      END IF;
      IF OLD.status IS DISTINCT FROM 'resolved' OR NEW.status IS DISTINCT FROM 'resolved' THEN
        RAISE EXCEPTION 'Nur abgeschlossene Mängel können archiviert werden.';
      END IF;
      IF NEW.archived_at IS NULL OR NEW.archived_by IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Die Archivierung braucht Zeitpunkt und die angemeldete Person.';
      END IF;
      IF NEW.change_note IS DISTINCT FROM OLD.change_note
         OR NEW.status IS DISTINCT FROM OLD.status
         OR NEW.resolution_due_at IS DISTINCT FROM OLD.resolution_due_at
         OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
         OR old_body IS DISTINCT FROM new_body THEN
        RAISE EXCEPTION 'Die Archivierung verändert keine Arbeitsvermerke, Fristen oder den Status.';
      END IF;
    END IF;
    DELETE FROM tageswerk_private.defect_archive_permit AS permit
    WHERE permit.defect_id = NEW.id
      AND permit.actor_id = auth.uid();
    RETURN NEW;
  END IF;

  IF NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM 'resolved' THEN
    NEW.resolved_at := pg_catalog.now();
  ELSIF NEW.resolved_at IS DISTINCT FROM OLD.resolved_at THEN
    RAISE EXCEPTION 'Der Abschlusszeitpunkt kann nicht direkt geändert werden.';
  END IF;
  RETURN NEW;
END;
$guard$;

-- Die vorhandenen Trigger audit_defect_change, require_defect_review_note,
-- trg_protect_resolution_deadlines, trg_set_default_resolution_due und
-- validate_defect_assignment werden nicht ersetzt. Ihr Funktionstext ist hier nicht vorhanden.
DROP TRIGGER IF EXISTS aa_defects_archive_guard ON public.defects;
CREATE TRIGGER aa_defects_archive_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.defects
  FOR EACH ROW
  EXECUTE FUNCTION public.tageswerk_defect_archive_guard();

CREATE OR REPLACE FUNCTION public.tageswerk_archive_defect(p_defect_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $archive$
DECLARE
  current_row public.defects%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Anmeldung erforderlich.';
  END IF;
  SELECT * INTO current_row
  FROM public.defects
  WHERE id = p_defect_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mangel nicht gefunden.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.facilities AS facility
    WHERE facility.id = current_row.facility_id
      AND facility.organization_id = current_row.organization_id
  ) THEN
    RAISE EXCEPTION 'Mangel nicht gefunden.';
  END IF;
  IF NOT public.tageswerk_defect_archive_allowed(current_row.organization_id, current_row.facility_id) THEN
    RAISE EXCEPTION 'Nur Betriebsleitung und Geschäftsführung dürfen archivieren.';
  END IF;
  IF current_row.status IS DISTINCT FROM 'resolved' THEN
    RAISE EXCEPTION 'Nur abgeschlossene Mängel können archiviert werden.';
  END IF;
  IF current_row.archived_at IS NOT NULL THEN
    RETURN;
  END IF;
  INSERT INTO tageswerk_private.defect_archive_permit (defect_id, operation, actor_id)
  VALUES (p_defect_id, 'archive', auth.uid());
  UPDATE public.defects
  SET archived_at = pg_catalog.now(),
      archived_by = auth.uid()
  WHERE id = p_defect_id
    AND facility_id = current_row.facility_id
    AND organization_id = current_row.organization_id
    AND status = 'resolved'
    AND archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Der Mangel konnte nicht archiviert werden.';
  END IF;
  INSERT INTO public.defect_events (defect_id, organization_id, facility_id, action, note, actor_id)
  VALUES (p_defect_id, current_row.organization_id, current_row.facility_id, 'Gesehen und archiviert', 'Gesehen und archiviert.', auth.uid());
  DELETE FROM tageswerk_private.defect_archive_permit AS permit
  WHERE permit.defect_id = p_defect_id
    AND permit.actor_id = auth.uid();
END;
$archive$;

CREATE OR REPLACE FUNCTION public.tageswerk_archive_closed_defects(p_facility_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $bulk$
DECLARE
  facility_org uuid;
  archived_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Anmeldung erforderlich.';
  END IF;
  IF p_facility_id IS NULL THEN
    RAISE EXCEPTION 'Bitte einen Betrieb auswählen.';
  END IF;
  SELECT facility.organization_id INTO facility_org
  FROM public.facilities AS facility
  WHERE facility.id = p_facility_id;
  IF facility_org IS NULL THEN
    RAISE EXCEPTION 'Betrieb nicht gefunden.';
  END IF;
  IF NOT public.tageswerk_defect_archive_allowed(facility_org, p_facility_id) THEN
    RAISE EXCEPTION 'Nur Betriebsleitung und Geschäftsführung dürfen archivieren.';
  END IF;
  INSERT INTO tageswerk_private.defect_archive_permit (defect_id, operation, actor_id)
  SELECT defect.id, 'archive', auth.uid()
  FROM public.defects AS defect
  WHERE defect.facility_id = p_facility_id
    AND defect.organization_id = facility_org
    AND defect.status = 'resolved'
    AND defect.archived_at IS NULL;
  WITH marked AS (
    UPDATE public.defects AS defect
    SET archived_at = pg_catalog.now(),
        archived_by = auth.uid()
    WHERE defect.facility_id = p_facility_id
      AND defect.organization_id = facility_org
      AND defect.status = 'resolved'
      AND defect.archived_at IS NULL
    RETURNING defect.id, defect.organization_id, defect.facility_id
  ), logged AS (
    INSERT INTO public.defect_events (defect_id, organization_id, facility_id, action, note, actor_id)
    SELECT marked.id, marked.organization_id, marked.facility_id, 'Gesehen und archiviert', 'Gesehen und archiviert.', auth.uid()
    FROM marked
    RETURNING defect_id
  )
  SELECT count(*)::integer INTO archived_count FROM logged;
  DELETE FROM tageswerk_private.defect_archive_permit AS permit
  WHERE permit.actor_id = auth.uid()
    AND permit.operation = 'archive'
    AND permit.defect_id IN (
      SELECT defect.id
      FROM public.defects AS defect
      WHERE defect.facility_id = p_facility_id
        AND defect.organization_id = facility_org
    );
  RETURN archived_count;
END;
$bulk$;

CREATE OR REPLACE FUNCTION public.tageswerk_restore_archived_defect(p_defect_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $restore$
DECLARE
  current_row public.defects%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Anmeldung erforderlich.';
  END IF;
  SELECT * INTO current_row
  FROM public.defects
  WHERE id = p_defect_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mangel nicht gefunden.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.facilities AS facility
    WHERE facility.id = current_row.facility_id
      AND facility.organization_id = current_row.organization_id
  ) THEN
    RAISE EXCEPTION 'Mangel nicht gefunden.';
  END IF;
  IF NOT public.tageswerk_defect_archive_allowed(current_row.organization_id, current_row.facility_id) THEN
    RAISE EXCEPTION 'Nur Betriebsleitung und Geschäftsführung dürfen archivierte Mängel zurückholen.';
  END IF;
  IF current_row.archived_at IS NULL THEN
    RAISE EXCEPTION 'Dieser Mangel liegt nicht im Archiv.';
  END IF;
  INSERT INTO tageswerk_private.defect_archive_permit (defect_id, operation, actor_id)
  VALUES (p_defect_id, 'restore', auth.uid());
  UPDATE public.defects
  SET archived_at = NULL,
      archived_by = NULL
  WHERE id = p_defect_id
    AND facility_id = current_row.facility_id
    AND organization_id = current_row.organization_id
    AND archived_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Der Mangel konnte nicht aus dem Archiv geholt werden.';
  END IF;
  INSERT INTO public.defect_events (defect_id, organization_id, facility_id, action, note, actor_id)
  VALUES (p_defect_id, current_row.organization_id, current_row.facility_id, 'Aus Archiv zurückgeholt', 'Aus Archiv zurückgeholt.', auth.uid());
  DELETE FROM tageswerk_private.defect_archive_permit AS permit
  WHERE permit.defect_id = p_defect_id
    AND permit.actor_id = auth.uid();
END;
$restore$;

DO $column_rights$
DECLARE
  editable text;
  service_editable text;
BEGIN
  SELECT string_agg(pg_catalog.quote_ident(cols.column_name), ', ' ORDER BY cols.ordinal_position)
    INTO editable
  FROM information_schema.columns AS cols
  WHERE cols.table_schema = 'public'
    AND cols.table_name = 'defects'
    AND cols.column_name NOT IN ('archived_at', 'archived_by', 'resolved_at')
    AND (
      pg_catalog.has_table_privilege('authenticated', 'public.defects', 'UPDATE')
      OR pg_catalog.has_column_privilege('authenticated', 'public.defects', cols.column_name, 'UPDATE')
    );
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    SELECT string_agg(pg_catalog.quote_ident(cols.column_name), ', ' ORDER BY cols.ordinal_position)
      INTO service_editable
    FROM information_schema.columns AS cols
    WHERE cols.table_schema = 'public'
      AND cols.table_name = 'defects'
      AND cols.column_name NOT IN ('archived_at', 'archived_by', 'resolved_at')
      AND (
        pg_catalog.has_table_privilege('service_role', 'public.defects', 'UPDATE')
        OR pg_catalog.has_column_privilege('service_role', 'public.defects', cols.column_name, 'UPDATE')
      );
    REVOKE UPDATE ON TABLE public.defects FROM service_role;
  END IF;
  REVOKE UPDATE ON TABLE public.defects FROM PUBLIC, anon, authenticated;
  IF editable IS NOT NULL THEN
    EXECUTE format('GRANT UPDATE (%s) ON TABLE public.defects TO authenticated', editable);
  END IF;
  IF service_editable IS NOT NULL THEN
    EXECUTE format('GRANT UPDATE (%s) ON TABLE public.defects TO service_role', service_editable);
  END IF;
END;
$column_rights$;

REVOKE ALL ON FUNCTION public.tageswerk_defect_archive_allowed(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_defect_archive_guard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_defect_archive_guard() TO authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_archive_defect(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_archive_closed_defects(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_restore_archived_defect(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_archive_defect(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_archive_closed_defects(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_restore_archived_defect(uuid) TO authenticated;

DO $owners$
DECLARE
  defects_owner name;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(relation.relowner)
    INTO defects_owner
  FROM pg_catalog.pg_class AS relation
  WHERE relation.oid = 'public.defects'::regclass;
  EXECUTE format('ALTER SCHEMA tageswerk_private OWNER TO %I', defects_owner);
  EXECUTE format('ALTER TABLE tageswerk_private.defect_archive_permit OWNER TO %I', defects_owner);
  EXECUTE format('ALTER FUNCTION public.tageswerk_defect_archive_guard() OWNER TO %I', defects_owner);
  EXECUTE format('ALTER FUNCTION public.tageswerk_defect_archive_allowed(uuid, uuid) OWNER TO %I', defects_owner);
  EXECUTE format('ALTER FUNCTION public.tageswerk_archive_defect(uuid) OWNER TO %I', defects_owner);
  EXECUTE format('ALTER FUNCTION public.tageswerk_archive_closed_defects(uuid) OWNER TO %I', defects_owner);
  EXECUTE format('ALTER FUNCTION public.tageswerk_restore_archived_defect(uuid) OWNER TO %I', defects_owner);
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.tageswerk_defect_archive_guard() TO service_role';
  END IF;
END;
$owners$;

COMMIT;
