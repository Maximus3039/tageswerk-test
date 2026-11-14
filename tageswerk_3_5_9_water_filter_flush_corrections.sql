-- Tageswerk 3.5.9, Korrektur dokumentierter Filterspülungen
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Voraussetzung: tageswerk_3_5_8_water_filter_flushes.sql (bereits installiert).
-- Die Datei ist nicht wiederholbar. Ein zweiter Lauf setzt die Transaktion zurück.
-- Bestehende Spülprotokolle werden nicht gelöscht.
-- Direkte UPDATEs auf Spülprotokolle bleiben für Clients verboten.
-- Korrekturen laufen ausschließlich über public.tageswerk_correct_water_filter_flush.
--
-- Korrigierbar: Filterzuordnung, Spülzeitpunkt, Bemerkung.
-- Jede Korrektur schreibt ein unveränderliches Protokoll mit Alt-/Neuwerten,
-- Korrektor, Zeitpunkt und Begründung.
-- recorded_by / recorded_at der Originalerfassung bleiben erhalten.
-- last_flushed_* am Filter wird nach jeder Korrektur neu aus der Historie berechnet.

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
  IF to_regclass('public.water_filter_flush_corrections') IS NOT NULL THEN
    RAISE EXCEPTION 'Filterspülungs-Korrekturen sind bereits installiert. Diese Datei nicht erneut ausführen.';
  END IF;
  IF to_regprocedure('public.tageswerk_correct_water_filter_flush(uuid,uuid,timestamptz,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'tageswerk_correct_water_filter_flush existiert bereits. Diese Datei nicht erneut ausführen.';
  END IF;
END;
$guard$;

ALTER TABLE public.water_filter_flushes
  ADD COLUMN corrected_at timestamptz,
  ADD COLUMN corrected_by uuid,
  ADD COLUMN correction_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.water_filter_flushes
  ADD CONSTRAINT water_filter_flushes_correction_mark CHECK (
    (corrected_at IS NULL AND corrected_by IS NULL AND correction_count = 0)
    OR (corrected_at IS NOT NULL AND corrected_by IS NOT NULL AND correction_count > 0)
  );

CREATE TABLE public.water_filter_flush_corrections (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  flush_id uuid NOT NULL REFERENCES public.water_filter_flushes (id),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  corrected_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  corrected_by uuid NOT NULL DEFAULT auth.uid(),
  reason text NOT NULL,
  old_filter_id uuid NOT NULL REFERENCES public.water_filters (id),
  new_filter_id uuid NOT NULL REFERENCES public.water_filters (id),
  old_pool_id uuid NOT NULL REFERENCES public.water_pools (id),
  new_pool_id uuid NOT NULL REFERENCES public.water_pools (id),
  old_flushed_at timestamptz NOT NULL,
  new_flushed_at timestamptz NOT NULL,
  old_note text NOT NULL DEFAULT '',
  new_note text NOT NULL DEFAULT '',
  CONSTRAINT water_filter_flush_corrections_reason CHECK (char_length(btrim(reason)) BETWEEN 3 AND 2000),
  CONSTRAINT water_filter_flush_corrections_note_old CHECK (char_length(old_note) <= 2000),
  CONSTRAINT water_filter_flush_corrections_note_new CHECK (char_length(new_note) <= 2000),
  CONSTRAINT water_filter_flush_corrections_changed CHECK (
    old_filter_id IS DISTINCT FROM new_filter_id
    OR old_flushed_at IS DISTINCT FROM new_flushed_at
    OR old_note IS DISTINCT FROM new_note
  )
);

CREATE INDEX water_filter_flush_corrections_flush
  ON public.water_filter_flush_corrections (flush_id, corrected_at DESC, id DESC);

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

-- last_* am Filter darf bei gesteuerter Neuberechnung gesetzt werden.
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
     AND pg_catalog.pg_trigger_depth() <= 1
     AND coalesce(pg_catalog.current_setting('tageswerk.water_filter_last_flush_refresh', true), '')
         IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Die letzte Spülung wird nur durch Spülprotokolle gesetzt.';
  END IF;
  RETURN NEW;
END;
$tageswerk$;

-- Direkte Client-UPDATEs bleiben gesperrt. Korrekturfunktion setzt Session-Kennzeichen.
CREATE OR REPLACE FUNCTION public.tageswerk_protect_water_filter_flush()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Dokumentierte Filterspülungen werden nicht gelöscht.';
  END IF;
  IF coalesce(pg_catalog.current_setting('tageswerk.water_filter_flush_correction', true), '')
     IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Dokumentierte Filterspülungen bleiben unverändert. Korrekturen nur über die vorgesehene Funktion.';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.facility_id IS DISTINCT FROM OLD.facility_id
     OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
     OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at THEN
    RAISE EXCEPTION 'Erfassung, Betrieb und Organisation einer Spülung bleiben unverändert.';
  END IF;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_refresh_water_filter_last_flush(p_filter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
DECLARE
  latest public.water_filter_flushes;
BEGIN
  IF p_filter_id IS NULL THEN
    RAISE EXCEPTION 'Der Filter fehlt.';
  END IF;

  PERFORM pg_catalog.set_config('tageswerk.water_filter_last_flush_refresh', '1', true);

  SELECT *
    INTO latest
  FROM public.water_filter_flushes AS flush_row
  WHERE flush_row.filter_id = p_filter_id
  ORDER BY flush_row.flushed_at DESC, flush_row.recorded_at DESC, flush_row.id DESC
  LIMIT 1;

  IF latest.id IS NULL THEN
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
  old_filter public.water_filters;
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

  SELECT * INTO old_filter FROM public.water_filters WHERE id = flush_row.filter_id;
  IF old_filter.id IS NULL THEN
    RAISE EXCEPTION 'Der bisherige Filter wurde nicht gefunden.';
  END IF;

  SELECT * INTO new_filter FROM public.water_filters WHERE id = p_filter_id FOR UPDATE;
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

  IF flush_row.filter_id IS NOT DISTINCT FROM new_filter.id
     AND flush_row.flushed_at IS NOT DISTINCT FROM p_flushed_at
     AND flush_row.note IS NOT DISTINCT FROM clean_note THEN
    RAISE EXCEPTION 'Es wurde keine Änderung angegeben.';
  END IF;

  PERFORM pg_catalog.set_config('tageswerk.water_filter_flush_correction', '1', true);

  INSERT INTO public.water_filter_flush_corrections (
    flush_id,
    organization_id,
    facility_id,
    corrected_at,
    corrected_by,
    reason,
    old_filter_id,
    new_filter_id,
    old_pool_id,
    new_pool_id,
    old_flushed_at,
    new_flushed_at,
    old_note,
    new_note
  ) VALUES (
    flush_row.id,
    flush_row.organization_id,
    flush_row.facility_id,
    now_ts,
    actor,
    clean_reason,
    flush_row.filter_id,
    new_filter.id,
    flush_row.pool_id,
    new_filter.pool_id,
    flush_row.flushed_at,
    p_flushed_at,
    flush_row.note,
    clean_note
  )
  RETURNING id INTO correction_id;

  UPDATE public.water_filter_flushes
  SET filter_id = new_filter.id,
      pool_id = new_filter.pool_id,
      flushed_at = p_flushed_at,
      note = clean_note,
      corrected_at = now_ts,
      corrected_by = actor,
      correction_count = flush_row.correction_count + 1
  WHERE id = flush_row.id;

  PERFORM public.tageswerk_refresh_water_filter_last_flush(old_filter.id);
  IF new_filter.id IS DISTINCT FROM old_filter.id THEN
    PERFORM public.tageswerk_refresh_water_filter_last_flush(new_filter.id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'flush_id', flush_row.id,
    'correction_id', correction_id,
    'corrected_at', now_ts,
    'correction_count', flush_row.correction_count + 1
  );
END;
$tageswerk$;

ALTER TABLE public.water_filter_flush_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_filter_flush_corrections FORCE ROW LEVEL SECURITY;

CREATE POLICY water_filter_flush_corrections_select ON public.water_filter_flush_corrections
  FOR SELECT TO authenticated
  USING (
    public.tageswerk_meter_role(organization_id, facility_id) IN ('technician', 'facility_manager', 'company_admin')
  );

-- Kein INSERT/UPDATE/DELETE für authenticated. Schreiben nur über SECURITY DEFINER.

REVOKE ALL ON TABLE public.water_filter_flush_corrections FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.water_filter_flush_corrections TO authenticated;

REVOKE ALL ON FUNCTION public.tageswerk_protect_water_filter_flush_correction() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_refresh_water_filter_last_flush(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_apply_water_filter_last_flush() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_protect_water_filter() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tageswerk_protect_water_filter_flush() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.tageswerk_correct_water_filter_flush(uuid, uuid, timestamptz, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tageswerk_correct_water_filter_flush(uuid, uuid, timestamptz, text, text)
  TO authenticated;

COMMIT;
