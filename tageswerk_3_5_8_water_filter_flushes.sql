-- Tageswerk 3.5.8, Filterspülungen (Phase A – Datenbank und Sicherheit)
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Voraussetzung: public.water_pools, public.tageswerk_meter_role (inkl. technician),
-- public.tageswerk_facility_organization und public.tageswerk_bind_operation_facility.
-- Die Datei ist nicht wiederholbar. Ein zweiter Lauf setzt die Transaktion zurück.
-- Installationsreihenfolge nach Freigabe und ohne Wiederholung der Vorgänger:
-- … tageswerk_3_3_water_hygiene.sql, tageswerk_3_4_technician_role.sql, …
-- danach diese Datei.
-- Bestehende Wasser-, Mängel- und Zählertabellen werden nicht gelöscht oder zurückgesetzt.
-- Keine Lockerung bestehender RLS-Policies anderer Module.
--
-- Mitarbeiter sehen aktive Filter und dürfen Spülungen dokumentieren, lesen aber keine Historie.
-- Techniker lesen die Historie, verwalten keine Filter.
-- Betriebsleitung und Geschäftsführung verwalten Filter im berechtigten Betrieb.
-- Spülprotokolle sind unveränderlich. Die letzte Spülung am Filter folgt dem
-- zeitlich neuesten Eintrag (flushed_at, danach recorded_at, danach id).
-- flushed_at darf höchstens 24 Stunden zurückliegen und nicht in der Zukunft liegen.

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.water_pools') IS NULL THEN
    RAISE EXCEPTION 'water_pools fehlt. Zuerst tageswerk_3_3_water_hygiene.sql installieren.';
  END IF;
  IF to_regprocedure('public.tageswerk_meter_role(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'tageswerk_meter_role fehlt.';
  END IF;
  IF to_regprocedure('public.tageswerk_bind_operation_facility()') IS NULL THEN
    RAISE EXCEPTION 'tageswerk_bind_operation_facility fehlt.';
  END IF;
  IF to_regclass('public.water_filters') IS NOT NULL
     OR to_regclass('public.water_filter_flushes') IS NOT NULL THEN
    RAISE EXCEPTION 'Filterspülungen sind bereits installiert. Diese Datei nicht erneut ausführen.';
  END IF;
END;
$guard$;

CREATE TABLE public.water_filters (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  pool_id uuid NOT NULL REFERENCES public.water_pools (id),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  last_flushed_at timestamptz,
  last_flushed_by uuid,
  CONSTRAINT water_filters_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT water_filters_last_flush CHECK (
    (last_flushed_at IS NULL AND last_flushed_by IS NULL)
    OR (last_flushed_at IS NOT NULL AND last_flushed_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX water_filters_pool_active_name
  ON public.water_filters (pool_id, lower(btrim(name)))
  WHERE active IS TRUE;

CREATE INDEX water_filters_facility_pool
  ON public.water_filters (facility_id, pool_id);

CREATE INDEX water_filters_facility_active
  ON public.water_filters (facility_id, active);

CREATE TABLE public.water_filter_flushes (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  pool_id uuid NOT NULL REFERENCES public.water_pools (id),
  filter_id uuid NOT NULL REFERENCES public.water_filters (id),
  flushed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  recorded_by uuid NOT NULL DEFAULT auth.uid(),
  note text NOT NULL DEFAULT '',
  CONSTRAINT water_filter_flushes_note CHECK (char_length(note) <= 2000)
);

CREATE INDEX water_filter_flushes_filter_flushed
  ON public.water_filter_flushes (filter_id, flushed_at DESC, recorded_at DESC, id DESC);

CREATE INDEX water_filter_flushes_facility_flushed
  ON public.water_filter_flushes (facility_id, flushed_at DESC);

CREATE OR REPLACE FUNCTION public.tageswerk_normalize_water_filter()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  pool public.water_pools;
BEGIN
  NEW.name := btrim(coalesce(NEW.name, ''));
  IF char_length(NEW.name) < 1 OR char_length(NEW.name) > 200 THEN
    RAISE EXCEPTION 'Bitte eine Filterbezeichnung mit 1 bis 200 Zeichen eintragen.';
  END IF;
  SELECT * INTO pool FROM public.water_pools WHERE id = NEW.pool_id;
  IF pool.id IS NULL THEN
    RAISE EXCEPTION 'Das Becken wurde nicht gefunden.';
  END IF;
  IF NEW.facility_id IS DISTINCT FROM pool.facility_id THEN
    RAISE EXCEPTION 'Der Filter gehört zu einem anderen Betrieb als das Becken.';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM pool.organization_id THEN
    RAISE EXCEPTION 'Der Filter gehört zu einer anderen Organisation als das Becken.';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := pg_catalog.now();
    NEW.last_flushed_at := NULL;
    NEW.last_flushed_by := NULL;
    NEW.active := coalesce(NEW.active, true);
  END IF;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_protect_water_filter()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Filter werden nicht gelöscht, sondern deaktiviert.';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.facility_id IS DISTINCT FROM OLD.facility_id
    OR NEW.pool_id IS DISTINCT FROM OLD.pool_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Die Zuordnung eines Filters bleibt unverändert.';
  END IF;
  IF (NEW.last_flushed_at IS DISTINCT FROM OLD.last_flushed_at
      OR NEW.last_flushed_by IS DISTINCT FROM OLD.last_flushed_by)
     AND pg_catalog.pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'Die letzte Spülung wird nur durch Spülprotokolle gesetzt.';
  END IF;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_stamp_water_filter_flush()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  filter_row public.water_filters;
  now_ts timestamptz := pg_catalog.now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Eine Anmeldung ist erforderlich.';
  END IF;
  SELECT * INTO filter_row FROM public.water_filters WHERE id = NEW.filter_id;
  IF filter_row.id IS NULL THEN
    RAISE EXCEPTION 'Der Filter wurde nicht gefunden.';
  END IF;
  IF filter_row.active IS NOT TRUE THEN
    RAISE EXCEPTION 'Der Filter ist nicht aktiv.';
  END IF;
  NEW.organization_id := filter_row.organization_id;
  NEW.facility_id := filter_row.facility_id;
  NEW.pool_id := filter_row.pool_id;
  NEW.recorded_by := auth.uid();
  NEW.recorded_at := now_ts;
  NEW.note := btrim(coalesce(NEW.note, ''));
  IF NEW.flushed_at IS NULL THEN
    NEW.flushed_at := now_ts;
  END IF;
  IF NEW.flushed_at > now_ts THEN
    RAISE EXCEPTION 'Ein zukünftiger Spülzeitpunkt ist nicht zulässig.';
  END IF;
  IF NEW.flushed_at < now_ts - interval '24 hours' THEN
    RAISE EXCEPTION 'Eine nachträgliche Spülung ist höchstens 24 Stunden zulässig.';
  END IF;
  IF public.tageswerk_meter_role(NEW.organization_id, NEW.facility_id) IS NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung für diesen Betrieb.';
  END IF;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_protect_water_filter_flush()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  RAISE EXCEPTION 'Dokumentierte Filterspülungen bleiben unverändert.';
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_apply_water_filter_last_flush()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  latest public.water_filter_flushes;
BEGIN
  -- Läuft als Tabelleneigentümer, damit Mitarbeiter die letzte Spülung am Filter
  -- aktualisieren können, ohne Filter-UPDATE-Rechte zu erhalten.
  SELECT *
    INTO latest
  FROM public.water_filter_flushes AS flush_row
  WHERE flush_row.filter_id = NEW.filter_id
  ORDER BY flush_row.flushed_at DESC, flush_row.recorded_at DESC, flush_row.id DESC
  LIMIT 1;

  UPDATE public.water_filters AS filter_row
  SET last_flushed_at = latest.flushed_at,
      last_flushed_by = latest.recorded_by
  WHERE filter_row.id = NEW.filter_id
    AND (
      filter_row.last_flushed_at IS DISTINCT FROM latest.flushed_at
      OR filter_row.last_flushed_by IS DISTINCT FROM latest.recorded_by
    );

  RETURN NULL;
END;
$tageswerk$;

CREATE TRIGGER water_filters_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.water_filters
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();
CREATE TRIGGER water_filters_normalize
  BEFORE INSERT OR UPDATE ON public.water_filters
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_normalize_water_filter();
CREATE TRIGGER water_filters_protect
  BEFORE UPDATE OR DELETE ON public.water_filters
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_protect_water_filter();

CREATE TRIGGER water_filter_flushes_bind_facility
  BEFORE INSERT OR UPDATE OF facility_id ON public.water_filter_flushes
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_bind_operation_facility();
CREATE TRIGGER water_filter_flushes_stamp
  BEFORE INSERT ON public.water_filter_flushes
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_stamp_water_filter_flush();
CREATE TRIGGER water_filter_flushes_protect
  BEFORE UPDATE OR DELETE ON public.water_filter_flushes
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_protect_water_filter_flush();
CREATE TRIGGER water_filter_flushes_apply_last
  AFTER INSERT ON public.water_filter_flushes
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_apply_water_filter_last_flush();

ALTER TABLE public.water_filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_filters FORCE ROW LEVEL SECURITY;
ALTER TABLE public.water_filter_flushes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_filter_flushes FORCE ROW LEVEL SECURITY;

CREATE POLICY water_filters_select ON public.water_filters
  FOR SELECT TO authenticated
  USING (
    public.tageswerk_meter_role(organization_id, facility_id) IN ('technician', 'facility_manager', 'company_admin')
    OR (
      public.tageswerk_meter_role(organization_id, facility_id) = 'employee'
      AND active IS TRUE
    )
  );

CREATE POLICY water_filters_insert ON public.water_filters
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager')
    AND EXISTS (
      SELECT 1
      FROM public.water_pools AS pool
      WHERE pool.id = water_filters.pool_id
        AND pool.facility_id = water_filters.facility_id
        AND pool.organization_id = water_filters.organization_id
    )
  );

CREATE POLICY water_filters_update ON public.water_filters
  FOR UPDATE TO authenticated
  USING (public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager'))
  WITH CHECK (public.tageswerk_meter_role(organization_id, facility_id) IN ('company_admin', 'facility_manager'));

CREATE POLICY water_filter_flushes_select ON public.water_filter_flushes
  FOR SELECT TO authenticated
  USING (
    public.tageswerk_meter_role(organization_id, facility_id) IN ('technician', 'facility_manager', 'company_admin')
  );

CREATE POLICY water_filter_flushes_insert ON public.water_filter_flushes
  FOR INSERT TO authenticated
  WITH CHECK (
    recorded_by = auth.uid()
    AND public.tageswerk_meter_role(organization_id, facility_id) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.water_filters AS filter_row
      WHERE filter_row.id = water_filter_flushes.filter_id
        AND filter_row.facility_id = water_filter_flushes.facility_id
        AND filter_row.organization_id = water_filter_flushes.organization_id
        AND filter_row.pool_id = water_filter_flushes.pool_id
        AND filter_row.active IS TRUE
    )
  );

REVOKE ALL ON TABLE public.water_filters FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.water_filter_flushes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.water_filters TO authenticated;
GRANT SELECT, INSERT ON TABLE public.water_filter_flushes TO authenticated;

REVOKE ALL ON FUNCTION public.tageswerk_normalize_water_filter() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_protect_water_filter() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_stamp_water_filter_flush() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_protect_water_filter_flush() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tageswerk_apply_water_filter_last_flush() FROM PUBLIC, anon, authenticated;

COMMIT;
