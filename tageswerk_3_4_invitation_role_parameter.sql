-- Tageswerk 3.4, Rolle in der Einladungsfunktion
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Die installierte Funktion request_staff_invitation(uuid, text, text, text) bleibt bestehen.
-- Diese Datei ergänzt nur die fünfstellige Fassung.
-- Die Datenbank prüft Anmeldung, Betrieb und aktive Verwaltungsberechtigung.
-- Eine fehlende oder leere Rolle wird Mitarbeiter.
-- Zulässig sind nur employee und technician.
-- Bestehende Mitgliedschaften, auch deaktivierte, werden nicht verändert.
-- Es wird kein Benutzer angelegt und keine Mitgliedschaft geschrieben.

BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('private.can_manage_facility(uuid)') IS NULL THEN
    RAISE EXCEPTION 'private.can_manage_facility(uuid) fehlt. Die Rolleneinladung wurde nicht angelegt.';
  END IF;
  IF to_regprocedure('public.request_staff_invitation(uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'request_staff_invitation(uuid, text, text, text) fehlt und wurde nicht neu erfunden.';
  END IF;
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
    RAISE EXCEPTION 'staff_invitations.role fehlt. Zuerst tageswerk_3_4_invitation_role.sql ausführen.';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.request_staff_invitation(
  p_facility_id uuid,
  p_email text,
  p_first_name text,
  p_last_name text,
  p_role text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_org uuid;
  v_id uuid;
  v_email text := lower(btrim(p_email));
  v_role text := coalesce(nullif(btrim(p_role), ''), 'employee');
  v_existing_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Anmeldung erforderlich';
  END IF;
  SELECT organization_id
  INTO v_org
  FROM public.facilities
  WHERE id = p_facility_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Betrieb nicht gefunden';
  END IF;
  IF NOT private.can_manage_facility(p_facility_id) THEN
    RAISE EXCEPTION 'Keine aktive Verwaltungsberechtigung fuer diesen Betrieb';
  END IF;
  IF v_role NOT IN ('employee', 'technician') THEN
    RAISE EXCEPTION 'Eine Einladung kann nur Mitarbeiter oder Techniker vorsehen.';
  END IF;
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Ungueltige E-Mail-Adresse';
  END IF;
  IF length(btrim(p_first_name)) NOT BETWEEN 1 AND 100
     OR length(btrim(p_last_name)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Vor- und Nachname erforderlich';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.memberships AS membership
    JOIN auth.users AS users ON users.id = membership.user_id
    WHERE lower(users.email) = v_email
      AND membership.organization_id = v_org
      AND (
        membership.facility_id = p_facility_id
        OR membership.role = 'company_admin'
      )
  ) THEN
    RAISE EXCEPTION 'Dieser Benutzer ist bereits zugeordnet. Bitte bei Bedarf reaktivieren.';
  END IF;
  SELECT status
  INTO v_existing_status
  FROM public.staff_invitations
  WHERE facility_id = p_facility_id
    AND lower(email) = v_email
    AND status IN ('pending', 'sent', 'failed')
  ORDER BY invited_at DESC
  LIMIT 1;
  IF v_existing_status = 'pending' THEN
    RAISE EXCEPTION 'Fuer diese E-Mail-Adresse wird bereits eine Einladung verarbeitet.';
  ELSIF v_existing_status = 'sent' THEN
    RAISE EXCEPTION 'An diese E-Mail-Adresse wurde bereits eine Einladung versendet.';
  ELSIF v_existing_status = 'failed' THEN
    RAISE EXCEPTION 'Eine fruehere Einladung ist fehlgeschlagen. Bitte zuerst den Versandstatus pruefen.';
  END IF;
  INSERT INTO public.staff_invitations (
    organization_id,
    facility_id,
    email,
    first_name,
    last_name,
    role,
    invited_by
  )
  VALUES (
    v_org,
    p_facility_id,
    v_email,
    btrim(p_first_name),
    btrim(p_last_name),
    v_role,
    auth.uid()
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.request_staff_invitation(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_staff_invitation(uuid, text, text, text, text) TO authenticated;

COMMIT;
