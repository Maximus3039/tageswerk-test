-- Tageswerk 3.5.1: Archiv für abgeschlossene Mängel.
-- Einmal im SQL-Editor ausführen, nachdem diese Datei freigegeben ist.
-- Dieses Skript ändert keine bestehenden Mängel, Arbeitsvermerke oder Messdaten.
-- Die Strukturprüfung liest die vorhandene Tabelle und stoppt, wenn eine erwartete Spalte fehlt.
-- Bestehende RLS-Richtlinien werden nicht ersetzt. Der Trigger schützt archivierte Zeilen zusätzlich.

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
    AND column_name NOT IN ('defect_id', 'action', 'note', 'actor_id');
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
      AND column_name = 'actor_id'
      AND data_type <> 'uuid'
  ) THEN
    RAISE EXCEPTION 'defect_events.action, note oder actor_id hat nicht den vom Verlauf erwarteten Typ.';
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
SET search_path = ''
AS $guard$
DECLARE
  flag text := pg_catalog.current_setting('tageswerk.defect_archive', true);
  old_body jsonb;
  new_body jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Archivierte Mängel können nicht gelöscht werden.';
    END IF;
    RETURN OLD;
  END IF;

  old_body := pg_catalog.to_jsonb(OLD) - 'archived_at' - 'archived_by';
  new_body := pg_catalog.to_jsonb(NEW) - 'archived_at' - 'archived_by';

  IF OLD.archived_at IS NOT NULL THEN
    IF flag IS DISTINCT FROM 'restore' THEN
      RAISE EXCEPTION 'Archivierte Mängel können nicht verändert werden.';
    END IF;
    IF NEW.archived_at IS NOT NULL OR NEW.archived_by IS NOT NULL THEN
      RAISE EXCEPTION 'Die Wiederherstellung entfernt nur die Archivierung.';
    END IF;
    IF old_body IS DISTINCT FROM new_body THEN
      RAISE EXCEPTION 'Die Wiederherstellung verändert keine gespeicherten Angaben.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at
     OR NEW.archived_by IS DISTINCT FROM OLD.archived_by THEN
    IF flag IS DISTINCT FROM 'archive' THEN
      RAISE EXCEPTION 'Archivierung ist nur über die vorgesehene Funktion möglich.';
    END IF;
    IF OLD.status IS DISTINCT FROM 'resolved' OR NEW.status IS DISTINCT FROM 'resolved' THEN
      RAISE EXCEPTION 'Nur abgeschlossene Mängel können archiviert werden.';
    END IF;
    IF NEW.archived_at IS NULL OR NEW.archived_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Die Archivierung braucht Zeitpunkt und die angemeldete Person.';
    END IF;
    IF old_body IS DISTINCT FROM new_body THEN
      RAISE EXCEPTION 'Die Archivierung verändert keine gespeicherten Angaben.';
    END IF;
  ELSIF NEW.status = 'resolved'
    AND OLD.status IS DISTINCT FROM 'resolved'
    AND NEW.resolved_at IS NOT DISTINCT FROM OLD.resolved_at THEN
    NEW.resolved_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END;
$guard$;

DROP TRIGGER IF EXISTS aa_defects_archive_guard ON public.defects;
CREATE TRIGGER aa_defects_archive_guard
  BEFORE UPDATE OR DELETE ON public.defects
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
  IF NOT public.tageswerk_defect_archive_allowed(current_row.organization_id, current_row.facility_id) THEN
    RAISE EXCEPTION 'Nur Betriebsleitung und Geschäftsführung dürfen archivieren.';
  END IF;
  IF current_row.status IS DISTINCT FROM 'resolved' THEN
    RAISE EXCEPTION 'Nur abgeschlossene Mängel können archiviert werden.';
  END IF;
  IF current_row.archived_at IS NOT NULL THEN
    RETURN;
  END IF;
  PERFORM pg_catalog.set_config('tageswerk.defect_archive', 'archive', true);
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
  INSERT INTO public.defect_events (defect_id, action, note, actor_id)
  VALUES (p_defect_id, 'Gesehen und archiviert', 'Gesehen und archiviert.', auth.uid());
  PERFORM pg_catalog.set_config('tageswerk.defect_archive', '', true);
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
  PERFORM pg_catalog.set_config('tageswerk.defect_archive', 'archive', true);
  WITH marked AS (
    UPDATE public.defects AS defect
    SET archived_at = pg_catalog.now(),
        archived_by = auth.uid()
    WHERE defect.facility_id = p_facility_id
      AND defect.organization_id = facility_org
      AND defect.status = 'resolved'
      AND defect.archived_at IS NULL
    RETURNING defect.id
  ), logged AS (
    INSERT INTO public.defect_events (defect_id, action, note, actor_id)
    SELECT marked.id, 'Gesehen und archiviert', 'Gesehen und archiviert.', auth.uid()
    FROM marked
    RETURNING defect_id
  )
  SELECT count(*)::integer INTO archived_count FROM logged;
  PERFORM pg_catalog.set_config('tageswerk.defect_archive', '', true);
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
  IF NOT public.tageswerk_defect_archive_allowed(current_row.organization_id, current_row.facility_id) THEN
    RAISE EXCEPTION 'Nur Betriebsleitung und Geschäftsführung dürfen archivierte Mängel zurückholen.';
  END IF;
  IF current_row.archived_at IS NULL THEN
    RAISE EXCEPTION 'Dieser Mangel liegt nicht im Archiv.';
  END IF;
  PERFORM pg_catalog.set_config('tageswerk.defect_archive', 'restore', true);
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
  INSERT INTO public.defect_events (defect_id, action, note, actor_id)
  VALUES (p_defect_id, 'Aus Archiv zurückgeholt', 'Aus Archiv zurückgeholt.', auth.uid());
  PERFORM pg_catalog.set_config('tageswerk.defect_archive', '', true);
END;
$restore$;

REVOKE UPDATE (archived_at, archived_by) ON public.defects FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.tageswerk_defect_archive_allowed(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_defect_archive_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_archive_defect(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_archive_closed_defects(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_restore_archived_defect(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_archive_defect(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_archive_closed_defects(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_restore_archived_defect(uuid) TO authenticated;

COMMIT;
