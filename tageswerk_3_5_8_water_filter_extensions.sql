-- Tageswerk 3.5.8 Phase B1, Filterspülungen erweitern
-- Korrekturhistorie (revisionssicher) und dokumentierte Außerbetriebnahme.
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Voraussetzung: tageswerk_3_5_8_water_filter_flushes.sql (bereits installiert).
-- Die ursprüngliche Migration darf nicht erneut ausgeführt werden.
-- Diese Datei ist nicht wiederholbar. Ein zweiter Lauf setzt die Transaktion zurück.
--
-- Architektur Korrektur:
--   Originaleintrag in water_filter_flushes bleibt unverändert.
--   Jede Korrektur ist ein eigener Datensatz in water_filter_flush_corrections.
--   Die fachlich gültige Fassung ist die neueste Korrektur je flush_id,
--   sonst der Originaleintrag.
--
-- Architektur Status:
--   water_filters.active bleibt maßgeblich.
--   Jeder Wechsel wird unveränderlich in water_filter_status_events protokolliert.
--   Direkte active-Änderungen ohne vorgesehene Funktion sind gesperrt.
--
-- last_flushed_* folgt der jeweils gültigen Fassung (Original oder neueste Korrektur).

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.water_filters') IS NULL
     OR to_regclass('public.water_filter_flushes') IS NULL THEN
    RAISE EXCEPTION 'Filterspülungen fehlen. Zuerst tageswerk_3_5_8_water_filter_flushes.sql installieren.';
  END IF;
  IF to_regprocedure('public.tageswerk_meter_role(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'tageswerk_meter_role fehlt.';
  END IF;
  IF to_regclass('public.water_filter_flush_corrections') IS NOT NULL
     OR to_regclass('public.water_filter_status_events') IS NOT NULL
     OR to_regclass('public.tageswerk_water_filter_caps') IS NOT NULL THEN
    RAISE EXCEPTION 'Filter-Erweiterungen sind bereits installiert. Diese Datei nicht erneut ausführen.';
  END IF;
  IF to_regprocedure('public.tageswerk_correct_water_filter_flush(uuid,uuid,timestamptz,text,text)') IS NOT NULL
     OR to_regprocedure('public.tageswerk_set_water_filter_active(uuid,boolean,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Erweiterungsfunktionen existieren bereits. Diese Datei nicht erneut ausführen.';
  END IF;
END;
$guard$;

-- Interne Schreibfreigabe für Status/last_*: nicht per set_config umgehbar.
-- Freigabe gilt nur innerhalb der aktuellen Transaktion (xid8).
-- authenticated hat kein Recht auf diese Tabelle; nur SECURITY-DEFINER-Owner schreibt.
CREATE TABLE public.tageswerk_water_filter_caps (
  xact_id xid8 PRIMARY KEY,
  allow_status boolean NOT NULL DEFAULT false,
  allow_last_flush boolean NOT NULL DEFAULT false,
  set_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

REVOKE ALL ON TABLE public.tageswerk_water_filter_caps FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tageswerk_water_filter_cap_arm(
  p_allow_status boolean,
  p_allow_last_flush boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  current_xact xid8 := pg_catalog.pg_current_xact_id();
BEGIN
  DELETE FROM public.tageswerk_water_filter_caps AS caps
  WHERE pg_catalog.pg_xact_status(caps.xact_id) IS DISTINCT FROM 'in progress';

  INSERT INTO public.tageswerk_water_filter_caps AS caps (
    xact_id,
    allow_status,
    allow_last_flush,
    set_at
  ) VALUES (
    current_xact,
    coalesce(p_allow_status, false),
    coalesce(p_allow_last_flush, false),
    clock_timestamp()
  )
  ON CONFLICT (xact_id) DO UPDATE
  SET allow_status = caps.allow_status OR EXCLUDED.allow_status,
      allow_last_flush = caps.allow_last_flush OR EXCLUDED.allow_last_flush,
      set_at = EXCLUDED.set_at;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_water_filter_cap_consume(p_kind text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  consumed boolean := false;
  current_xact xid8 := pg_catalog.pg_current_xact_id();
BEGIN
  IF p_kind = 'status' THEN
    UPDATE public.tageswerk_water_filter_caps
    SET allow_status = false,
        set_at = clock_timestamp()
    WHERE xact_id = current_xact
      AND allow_status IS TRUE
    RETURNING true INTO consumed;
  ELSIF p_kind = 'last_flush' THEN
    UPDATE public.tageswerk_water_filter_caps
    SET allow_last_flush = false,
        set_at = clock_timestamp()
    WHERE xact_id = current_xact
      AND allow_last_flush IS TRUE
    RETURNING true INTO consumed;
  ELSE
    RAISE EXCEPTION 'Unbekannte Schreibfreigabe.';
  END IF;
  RETURN coalesce(consumed, false);
END;
$tageswerk$;

REVOKE ALL ON FUNCTION public.tageswerk_water_filter_cap_arm(boolean, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_water_filter_cap_consume(text)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Korrekturhistorie: Originale bleiben stehen, Korrekturen sind eigene Zeilen
-- ---------------------------------------------------------------------------

CREATE TABLE public.water_filter_flush_corrections (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  flush_id uuid NOT NULL REFERENCES public.water_filter_flushes (id),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  corrected_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  corrected_by uuid NOT NULL DEFAULT auth.uid(),
  reason text NOT NULL,
  previous_filter_id uuid NOT NULL REFERENCES public.water_filters (id),
  previous_pool_id uuid NOT NULL REFERENCES public.water_pools (id),
  previous_flushed_at timestamptz NOT NULL,
  previous_note text NOT NULL DEFAULT '',
  filter_id uuid NOT NULL REFERENCES public.water_filters (id),
  pool_id uuid NOT NULL REFERENCES public.water_pools (id),
  flushed_at timestamptz NOT NULL,
  note text NOT NULL DEFAULT '',
  CONSTRAINT water_filter_flush_corrections_reason CHECK (char_length(btrim(reason)) BETWEEN 3 AND 2000),
  CONSTRAINT water_filter_flush_corrections_previous_note CHECK (char_length(previous_note) <= 2000),
  CONSTRAINT water_filter_flush_corrections_note CHECK (char_length(note) <= 2000),
  CONSTRAINT water_filter_flush_corrections_changed CHECK (
    previous_filter_id IS DISTINCT FROM filter_id
    OR previous_flushed_at IS DISTINCT FROM flushed_at
    OR previous_note IS DISTINCT FROM note
  )
);

CREATE INDEX water_filter_flush_corrections_flush_latest
  ON public.water_filter_flush_corrections (flush_id, corrected_at DESC, id DESC);

CREATE INDEX water_filter_flush_corrections_filter_flushed
  ON public.water_filter_flush_corrections (filter_id, flushed_at DESC, id DESC);

CREATE INDEX water_filter_flush_corrections_facility
  ON public.water_filter_flush_corrections (facility_id, corrected_at DESC);

CREATE OR REPLACE FUNCTION public.tageswerk_protect_water_filter_flush_correction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  RAISE EXCEPTION 'Korrekturprotokolle der Filterspülungen bleiben unveränderlich.';
END;
$tageswerk$;

CREATE TRIGGER water_filter_flush_corrections_protect
  BEFORE UPDATE OR DELETE ON public.water_filter_flush_corrections
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_protect_water_filter_flush_correction();

-- ---------------------------------------------------------------------------
-- Statushistorie für Außerbetriebnahme / Reaktivierung
-- ---------------------------------------------------------------------------

CREATE TABLE public.water_filter_status_events (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  filter_id uuid NOT NULL REFERENCES public.water_filters (id),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  changed_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  changed_by uuid NOT NULL DEFAULT auth.uid(),
  reason text NOT NULL,
  old_active boolean NOT NULL,
  new_active boolean NOT NULL,
  CONSTRAINT water_filter_status_events_reason CHECK (char_length(btrim(reason)) BETWEEN 3 AND 2000),
  CONSTRAINT water_filter_status_events_changed CHECK (old_active IS DISTINCT FROM new_active)
);

CREATE INDEX water_filter_status_events_filter
  ON public.water_filter_status_events (filter_id, changed_at DESC, id DESC);

CREATE INDEX water_filter_status_events_facility
  ON public.water_filter_status_events (facility_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.tageswerk_protect_water_filter_status_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  RAISE EXCEPTION 'Statusprotokolle der Filter bleiben unveränderlich.';
END;
$tageswerk$;

CREATE TRIGGER water_filter_status_events_protect
  BEFORE UPDATE OR DELETE ON public.water_filter_status_events
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_protect_water_filter_status_event();

-- Originale Spülungen bleiben hart unveränderlich (kein GUC-Bypass).
CREATE OR REPLACE FUNCTION public.tageswerk_protect_water_filter_flush()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Dokumentierte Filterspülungen werden nicht gelöscht.';
  END IF;
  RAISE EXCEPTION 'Dokumentierte Filterspülungen bleiben unverändert. Korrekturen werden gesondert protokolliert.';
END;
$tageswerk$;

-- active nur über Statusfunktion; last_* nur über Neuberechnung/Trigger.
-- SECURITY DEFINER: liest interne Caps; set_config ist keine Autorisierung.
CREATE OR REPLACE FUNCTION public.tageswerk_protect_water_filter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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
  IF NEW.active IS DISTINCT FROM OLD.active
     AND public.tageswerk_water_filter_cap_consume('status') IS NOT TRUE THEN
    RAISE EXCEPTION 'Der Betriebszustand eines Filters wird nur über die vorgesehene Funktion geändert.';
  END IF;
  IF (NEW.last_flushed_at IS DISTINCT FROM OLD.last_flushed_at
      OR NEW.last_flushed_by IS DISTINCT FROM OLD.last_flushed_by)
     AND public.tageswerk_water_filter_cap_consume('last_flush') IS NOT TRUE THEN
    RAISE EXCEPTION 'Die letzte Spülung wird nur durch Spülprotokolle gesetzt.';
  END IF;
  RETURN NEW;
END;
$tageswerk$;

-- Aktuelle fachliche Fassung eines Spülprotokolls.
CREATE OR REPLACE FUNCTION public.tageswerk_water_filter_flush_effective(p_flush_id uuid)
RETURNS TABLE (
  flush_id uuid,
  organization_id uuid,
  facility_id uuid,
  filter_id uuid,
  pool_id uuid,
  flushed_at timestamptz,
  recorded_at timestamptz,
  recorded_by uuid,
  note text,
  correction_id uuid,
  corrected_at timestamptz,
  corrected_by uuid,
  is_corrected boolean
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $tageswerk$
  SELECT
    flush_row.id,
    flush_row.organization_id,
    flush_row.facility_id,
    coalesce(latest.filter_id, flush_row.filter_id),
    coalesce(latest.pool_id, flush_row.pool_id),
    coalesce(latest.flushed_at, flush_row.flushed_at),
    flush_row.recorded_at,
    flush_row.recorded_by,
    coalesce(latest.note, flush_row.note),
    latest.id,
    latest.corrected_at,
    latest.corrected_by,
    latest.id IS NOT NULL
  FROM public.water_filter_flushes AS flush_row
  LEFT JOIN LATERAL (
    SELECT correction.*
    FROM public.water_filter_flush_corrections AS correction
    WHERE correction.flush_id = flush_row.id
    ORDER BY correction.corrected_at DESC, correction.id DESC
    LIMIT 1
  ) AS latest ON true
  WHERE flush_row.id = p_flush_id;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_refresh_water_filter_last_flush(p_filter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  latest record;
BEGIN
  IF p_filter_id IS NULL THEN
    RAISE EXCEPTION 'Der Filter fehlt.';
  END IF;

  -- Filterzeile sperren: parallele Korrekturen/Inserts serialisieren die Neuberechnung.
  PERFORM 1
  FROM public.water_filters
  WHERE id = p_filter_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Der Filter wurde nicht gefunden.';
  END IF;

  SELECT
    effective.flushed_at,
    effective.recorded_by
    INTO latest
  FROM public.water_filter_flushes AS flush_row
  CROSS JOIN LATERAL public.tageswerk_water_filter_flush_effective(flush_row.id) AS effective
  WHERE effective.filter_id = p_filter_id
  ORDER BY effective.flushed_at DESC, effective.recorded_at DESC, effective.flush_id DESC
  LIMIT 1;

  PERFORM public.tageswerk_water_filter_cap_arm(false, true);

  IF latest.flushed_at IS NULL THEN
    UPDATE public.water_filters AS filter_row
    SET last_flushed_at = NULL,
        last_flushed_by = NULL
    WHERE filter_row.id = p_filter_id
      AND (filter_row.last_flushed_at IS NOT NULL OR filter_row.last_flushed_by IS NOT NULL);
  ELSE
    UPDATE public.water_filters AS filter_row
    SET last_flushed_at = latest.flushed_at,
        last_flushed_by = latest.recorded_by
    WHERE filter_row.id = p_filter_id
      AND (
        filter_row.last_flushed_at IS DISTINCT FROM latest.flushed_at
        OR filter_row.last_flushed_by IS DISTINCT FROM latest.recorded_by
      );
  END IF;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_apply_water_filter_last_flush()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
BEGIN
  IF TG_OP IS DISTINCT FROM 'INSERT' OR TG_LEVEL IS DISTINCT FROM 'ROW' OR TG_WHEN IS DISTINCT FROM 'AFTER' THEN
    RAISE EXCEPTION 'Die letzte Spülung wird nur nach einer neuen Spüldokumentation gesetzt.';
  END IF;
  IF NEW.filter_id IS NULL OR NEW.id IS NULL THEN
    RAISE EXCEPTION 'Die Spülung ist unvollständig.';
  END IF;
  PERFORM public.tageswerk_refresh_water_filter_last_flush(NEW.filter_id);
  RETURN NULL;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_correct_water_filter_flush(
  p_flush_id uuid,
  p_filter_id uuid,
  p_flushed_at timestamptz,
  p_note text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  actor uuid := auth.uid();
  now_ts timestamptz := pg_catalog.now();
  flush_row public.water_filter_flushes;
  current_row record;
  new_filter public.water_filters;
  role_name text;
  clean_note text := btrim(coalesce(p_note, ''));
  clean_reason text := btrim(coalesce(p_reason, ''));
  correction_id uuid;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Eine Anmeldung ist erforderlich.';
  END IF;
  IF p_flush_id IS NULL OR p_filter_id IS NULL OR p_flushed_at IS NULL THEN
    RAISE EXCEPTION 'Spülung, Filter und Spülzeitpunkt sind erforderlich.';
  END IF;
  IF char_length(clean_reason) < 3 OR char_length(clean_reason) > 2000 THEN
    RAISE EXCEPTION 'Bitte eine Begründung mit 3 bis 2000 Zeichen angeben.';
  END IF;
  IF char_length(clean_note) > 2000 THEN
    RAISE EXCEPTION 'Die Bemerkung darf höchstens 2000 Zeichen haben.';
  END IF;
  IF p_flushed_at > now_ts THEN
    RAISE EXCEPTION 'Ein zukünftiger Spülzeitpunkt ist nicht zulässig.';
  END IF;

  SELECT *
    INTO flush_row
  FROM public.water_filter_flushes
  WHERE id = p_flush_id
  FOR UPDATE;

  IF flush_row.id IS NULL THEN
    RAISE EXCEPTION 'Die Spülung wurde nicht gefunden.';
  END IF;

  role_name := public.tageswerk_meter_role(flush_row.organization_id, flush_row.facility_id);
  IF role_name IS DISTINCT FROM 'facility_manager'
     AND role_name IS DISTINCT FROM 'company_admin' THEN
    RAISE EXCEPTION 'Nur Betriebsleitung und Geschäftsführung korrigieren Spülprotokolle.';
  END IF;

  SELECT * INTO current_row
  FROM public.tageswerk_water_filter_flush_effective(flush_row.id);

  SELECT * INTO new_filter
  FROM public.water_filters
  WHERE id = p_filter_id
  FOR UPDATE;

  IF new_filter.id IS NULL THEN
    RAISE EXCEPTION 'Der neue Filter wurde nicht gefunden.';
  END IF;
  IF new_filter.active IS NOT TRUE THEN
    RAISE EXCEPTION 'Der Filter ist nicht aktiv.';
  END IF;
  IF new_filter.organization_id IS DISTINCT FROM flush_row.organization_id
     OR new_filter.facility_id IS DISTINCT FROM flush_row.facility_id THEN
    RAISE EXCEPTION 'Die Korrektur bleibt im selben Betrieb und in derselben Organisation.';
  END IF;

  IF current_row.filter_id IS NOT DISTINCT FROM new_filter.id
     AND current_row.flushed_at IS NOT DISTINCT FROM p_flushed_at
     AND current_row.note IS NOT DISTINCT FROM clean_note THEN
    RAISE EXCEPTION 'Es wurde keine Änderung angegeben.';
  END IF;

  -- Bisherigen Filter mit sperren, falls Zuordnung wechselt.
  IF current_row.filter_id IS DISTINCT FROM new_filter.id THEN
    PERFORM 1 FROM public.water_filters WHERE id = current_row.filter_id FOR UPDATE;
  END IF;

  INSERT INTO public.water_filter_flush_corrections (
    flush_id,
    organization_id,
    facility_id,
    corrected_at,
    corrected_by,
    reason,
    previous_filter_id,
    previous_pool_id,
    previous_flushed_at,
    previous_note,
    filter_id,
    pool_id,
    flushed_at,
    note
  ) VALUES (
    flush_row.id,
    flush_row.organization_id,
    flush_row.facility_id,
    now_ts,
    actor,
    clean_reason,
    current_row.filter_id,
    current_row.pool_id,
    current_row.flushed_at,
    current_row.note,
    new_filter.id,
    new_filter.pool_id,
    p_flushed_at,
    clean_note
  )
  RETURNING id INTO correction_id;

  -- Originaleintrag bleibt unverändert.
  PERFORM public.tageswerk_refresh_water_filter_last_flush(current_row.filter_id);
  IF new_filter.id IS DISTINCT FROM current_row.filter_id THEN
    PERFORM public.tageswerk_refresh_water_filter_last_flush(new_filter.id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'flush_id', flush_row.id,
    'correction_id', correction_id,
    'corrected_at', now_ts,
    'original_unchanged', true
  );
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_set_water_filter_active(
  p_filter_id uuid,
  p_active boolean,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  actor uuid := auth.uid();
  now_ts timestamptz := pg_catalog.now();
  filter_row public.water_filters;
  role_name text;
  clean_reason text := btrim(coalesce(p_reason, ''));
  event_id uuid;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Eine Anmeldung ist erforderlich.';
  END IF;
  IF p_filter_id IS NULL OR p_active IS NULL THEN
    RAISE EXCEPTION 'Filter und neuer Status sind erforderlich.';
  END IF;
  IF char_length(clean_reason) < 3 OR char_length(clean_reason) > 2000 THEN
    RAISE EXCEPTION 'Bitte eine Begründung mit 3 bis 2000 Zeichen angeben.';
  END IF;

  SELECT *
    INTO filter_row
  FROM public.water_filters
  WHERE id = p_filter_id
  FOR UPDATE;

  IF filter_row.id IS NULL THEN
    RAISE EXCEPTION 'Der Filter wurde nicht gefunden.';
  END IF;

  role_name := public.tageswerk_meter_role(filter_row.organization_id, filter_row.facility_id);
  IF role_name IS DISTINCT FROM 'facility_manager'
     AND role_name IS DISTINCT FROM 'company_admin' THEN
    RAISE EXCEPTION 'Nur Betriebsleitung und Geschäftsführung ändern den Filterstatus.';
  END IF;

  IF filter_row.active IS NOT DISTINCT FROM p_active THEN
    RAISE EXCEPTION 'Der Filter hat diesen Status bereits.';
  END IF;

  INSERT INTO public.water_filter_status_events (
    filter_id,
    organization_id,
    facility_id,
    changed_at,
    changed_by,
    reason,
    old_active,
    new_active
  ) VALUES (
    filter_row.id,
    filter_row.organization_id,
    filter_row.facility_id,
    now_ts,
    actor,
    clean_reason,
    filter_row.active,
    p_active
  )
  RETURNING id INTO event_id;

  PERFORM public.tageswerk_water_filter_cap_arm(true, false);

  UPDATE public.water_filters
  SET active = p_active
  WHERE id = filter_row.id;

  RETURN jsonb_build_object(
    'ok', true,
    'filter_id', filter_row.id,
    'event_id', event_id,
    'old_active', filter_row.active,
    'new_active', p_active,
    'changed_at', now_ts
  );
END;
$tageswerk$;

ALTER TABLE public.water_filter_flush_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_filter_flush_corrections FORCE ROW LEVEL SECURITY;
ALTER TABLE public.water_filter_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_filter_status_events FORCE ROW LEVEL SECURITY;

CREATE POLICY water_filter_flush_corrections_select ON public.water_filter_flush_corrections
  FOR SELECT TO authenticated
  USING (
    public.tageswerk_meter_role(organization_id, facility_id) IN ('technician', 'facility_manager', 'company_admin')
  );

CREATE POLICY water_filter_status_events_select ON public.water_filter_status_events
  FOR SELECT TO authenticated
  USING (
    public.tageswerk_meter_role(organization_id, facility_id) IN ('facility_manager', 'company_admin')
  );

REVOKE ALL ON TABLE public.water_filter_flush_corrections FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.water_filter_status_events FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.water_filter_flush_corrections TO authenticated;
GRANT SELECT ON TABLE public.water_filter_status_events TO authenticated;

-- Defense in Depth: Clients dürfen Filter umbenennen, aber nicht active/last_* setzen.
REVOKE UPDATE ON TABLE public.water_filters FROM authenticated;
GRANT UPDATE (name) ON TABLE public.water_filters TO authenticated;

REVOKE ALL ON FUNCTION public.tageswerk_protect_water_filter_flush_correction() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_protect_water_filter_status_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_protect_water_filter() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_protect_water_filter_flush() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_water_filter_cap_arm(boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_water_filter_cap_consume(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_refresh_water_filter_last_flush(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_apply_water_filter_last_flush() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tageswerk_water_filter_caps FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.tageswerk_water_filter_flush_effective(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_water_filter_flush_effective(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.tageswerk_correct_water_filter_flush(uuid, uuid, timestamptz, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_correct_water_filter_flush(uuid, uuid, timestamptz, text, text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.tageswerk_set_water_filter_active(uuid, boolean, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_set_water_filter_active(uuid, boolean, text)
  TO authenticated;

COMMIT;
