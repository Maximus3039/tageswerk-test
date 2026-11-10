-- Tageswerk 3.4, Rolle in der Mitarbeitereinladung
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Die produktive Edge Function invite-staff wird hier nicht gelesen und nicht ersetzt.
-- Ihre vorbereitete Fassung liegt unter supabase/functions/invite-staff und bleibt lokal.
-- Bestehende Einladungen behalten ihren Status. Eine leere Rolle gilt als Mitarbeiter.
-- Die Rollenspalte entsteht nur in dieser Datei. Sie wird gemeinsam mit dem Wächter
-- nur festgeschrieben, wenn accept_staff_invitation die Rolle Techniker schon übernimmt.
-- tageswerk_3_4_technician_role.sql verändert staff_invitations nicht.
-- public.accept_staff_invitation wird nicht ersetzt, solange ihre Live-Fassung
-- die gespeicherte Rolle nicht nachweisbar übernimmt. Ein Lauf endet dann ohne Änderung.
--
-- Erforderliche Annahme, erst nach Vergleich mit der Live-Fassung einsetzen:
-- * keine Rolle als Parameter annehmen
-- * nur status sent und dieselbe E-Mail übernehmen
-- * eine leere Rolle wie employee behandeln
-- * nur employee oder technician in memberships schreiben
-- * Betriebsleitung und Geschäftsführung nicht herabstufen
-- * Mitgliedschaften anderer Betriebe nicht verändern
-- * die Einladung danach auf accepted setzen
-- * ohne passende Einladung success false zurückgeben und nichts ändern

BEGIN;

DO $column$
BEGIN
  IF to_regclass('public.staff_invitations') IS NULL THEN
    RAISE EXCEPTION 'staff_invitations fehlt.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'staff_invitations'
      AND column_name = 'role'
  ) THEN
    ALTER TABLE public.staff_invitations
      ADD COLUMN role text NOT NULL DEFAULT 'employee';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_invitations_role_check'
  ) THEN
    ALTER TABLE public.staff_invitations
      ADD CONSTRAINT staff_invitations_role_check
      CHECK (role IN ('employee', 'technician'));
  END IF;
END;
$column$;

CREATE OR REPLACE FUNCTION public.tageswerk_guard_invitation_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  organization uuid;
  actor_role text;
BEGIN
  IF NEW.role IS NULL THEN
    NEW.role := 'employee';
  END IF;
  IF NEW.role NOT IN ('employee', 'technician') THEN
    RAISE EXCEPTION 'Eine Einladung kann nur Mitarbeiter oder Techniker vorsehen.';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT facility.organization_id INTO organization
  FROM public.facilities AS facility
  WHERE facility.id = NEW.facility_id;
  IF organization IS NULL THEN
    RAISE EXCEPTION 'Der Betrieb wurde nicht gefunden.';
  END IF;
  actor_role := public.tageswerk_meter_role(organization, NEW.facility_id);
  IF actor_role IS DISTINCT FROM 'company_admin' AND actor_role IS DISTINCT FROM 'facility_manager' THEN
    RAISE EXCEPTION 'Die Einladungsrolle kann nicht selbst geändert werden.';
  END IF;
  RETURN NEW;
END;
$tageswerk$;

DROP TRIGGER IF EXISTS staff_invitations_guard_role ON public.staff_invitations;
CREATE TRIGGER staff_invitations_guard_role
  BEFORE INSERT OR UPDATE ON public.staff_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.tageswerk_guard_invitation_role();

DO $accept$
DECLARE
  signature text;
  definition text;
BEGIN
  SELECT procedure.oid::regprocedure::text INTO signature
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'accept_staff_invitation';
  IF signature IS NULL THEN
    RAISE EXCEPTION 'accept_staff_invitation fehlt und wurde nicht neu erfunden.';
  END IF;
  definition := pg_get_functiondef(signature::regprocedure);
  IF position('staff_invitations' IN definition) = 0 THEN
    RAISE EXCEPTION 'accept_staff_invitation liest die Einladung nicht und wurde nicht ersetzt.';
  END IF;
  IF position('technician' IN definition) = 0 THEN
    RAISE EXCEPTION 'accept_staff_invitation übernimmt die gespeicherte Rolle Techniker nicht und wurde nicht ersetzt.';
  END IF;
END;
$accept$;

COMMIT;
