-- Tageswerk 3.4, Rolle in der Mitarbeitereinladung
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Die produktive Edge Function invite-staff wird hier nicht gelesen und nicht ersetzt.
-- Ihre vorbereitete Fassung liegt unter supabase/functions/invite-staff und bleibt lokal.
-- Bestehende Einladungen behalten ihren Status. Eine leere Rolle gilt als Mitarbeiter.
-- Die Rollenspalte und ihr Wächter entstehen in dieser Datei.
-- tageswerk_3_4_technician_role.sql verändert staff_invitations nicht und muss
-- vorher gelaufen sein, damit memberships.role den Wert technician erlaubt.
-- public.accept_staff_invitation() wird nur ersetzt, wenn die gelesene Fassung
-- ausschließlich employee annimmt und keine Rolle als Parameter hat.
-- Eine unbekannte Fassung setzt die Transaktion zurück.
-- Die ersetzte Annahme:
-- * nimmt keine Rolle vom Eingeladenen an
-- * übernimmt nur status sent und dieselbe bestätigte E-Mail
-- * behandelt eine leere Rolle als employee
-- * schreibt nur employee oder technician
-- * lässt vorhandene Mitgliedschaften unverändert und reaktiviert sie nicht
-- * verändert Mitgliedschaften anderer Betriebe nicht
-- * setzt die Einladung danach auf accepted
-- * gibt ohne passende Einladung success false zurück und ändert nichts

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
  IF EXISTS (
    SELECT 1
    FROM public.staff_invitations
    WHERE role IS NOT NULL
      AND role NOT IN ('employee', 'technician')
  ) THEN
    RAISE EXCEPTION 'staff_invitations.role enthält eine Rolle außerhalb von Mitarbeiter und Techniker. Es wurde nichts geändert.';
  END IF;
  UPDATE public.staff_invitations
  SET role = 'employee'
  WHERE role IS NULL;
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
  definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'memberships'
      AND constraint_row.contype = 'c'
      AND pg_get_constraintdef(constraint_row.oid) ILIKE '%technician%'
  ) THEN
    RAISE EXCEPTION 'memberships.role erlaubt technician noch nicht. Zuerst tageswerk_3_4_technician_role.sql ausführen. accept_staff_invitation wurde nicht ersetzt.';
  END IF;
  IF to_regprocedure('public.accept_staff_invitation()') IS NULL THEN
    RAISE EXCEPTION 'accept_staff_invitation() fehlt und wurde nicht neu erfunden.';
  END IF;
  definition := regexp_replace(pg_get_functiondef('public.accept_staff_invitation()'::regprocedure), '[[:space:]]+', ' ', 'g');
  IF position('v_role := coalesce(v_invitation.role, ''employee'')' IN definition) > 0
     AND position('coalesce(role, ''employee'') IN (''employee'', ''technician'')' IN definition) > 0
     AND position('Keine offene Einladung gefunden.' IN definition) > 0
     AND position('Deaktivierte Zuordnung: Bitte Betriebsleitung kontaktieren.' IN definition) > 0
     AND position('UPDATE public.memberships' IN definition) = 0 THEN
    NULL;
  ELSIF position('Bitte zuerst anmelden.' IN definition) = 0
     OR position('Die E-Mail-Adresse ist noch nicht bestätigt.' IN definition) = 0
     OR position('status = ''sent''' IN definition) = 0
     OR position('role = ''employee''' IN definition) = 0
     OR position('Keine offene Einladung gefunden.' IN definition) = 0
     OR position('Deaktivierte Zuordnung: Bitte Betriebsleitung kontaktieren.' IN definition) = 0
     OR position('staff_invitations' IN definition) = 0
     OR position('technician' IN definition) > 0 THEN
    RAISE EXCEPTION 'accept_staff_invitation entspricht nicht der geprüften Fassung und wurde nicht ersetzt.';
  ELSE
    EXECUTE $replace_accept$
      CREATE OR REPLACE FUNCTION public.accept_staff_invitation()
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = ''
      AS $function$
      DECLARE
        v_user_id uuid;
        v_email text;
        v_role text;
        v_invitation public.staff_invitations%ROWTYPE;
      BEGIN
        v_user_id := (SELECT auth.uid());
        IF v_user_id IS NULL THEN
          RAISE EXCEPTION 'Bitte zuerst anmelden.';
        END IF;
        SELECT lower(trim(users.email))
        INTO v_email
        FROM auth.users AS users
        WHERE users.id = v_user_id
          AND users.email_confirmed_at IS NOT NULL;
        IF v_email IS NULL THEN
          RAISE EXCEPTION 'Die E-Mail-Adresse ist noch nicht bestätigt.';
        END IF;
        SELECT *
        INTO v_invitation
        FROM public.staff_invitations
        WHERE lower(email) = v_email
          AND status = 'sent'
          AND coalesce(role, 'employee') IN ('employee', 'technician')
        ORDER BY invited_at ASC
        LIMIT 1
        FOR UPDATE;
        IF NOT FOUND THEN
          RETURN jsonb_build_object(
            'success', false,
            'message', 'Keine offene Einladung gefunden.'
          );
        END IF;
        v_role := coalesce(v_invitation.role, 'employee');
        IF v_role NOT IN ('employee', 'technician') THEN
          RAISE EXCEPTION 'Die Einladung enthält eine unzulässige Berechtigung.';
        END IF;
        IF EXISTS (
          SELECT 1
          FROM public.memberships AS membership
          WHERE membership.user_id = v_user_id
            AND membership.organization_id = v_invitation.organization_id
            AND (
              membership.facility_id = v_invitation.facility_id
              OR membership.role = 'company_admin'
            )
            AND membership.is_active = false
        ) THEN
          RAISE EXCEPTION 'Deaktivierte Zuordnung: Bitte Betriebsleitung kontaktieren.';
        END IF;
        IF NOT EXISTS (
          SELECT 1
          FROM public.memberships
          WHERE user_id = v_user_id
            AND organization_id = v_invitation.organization_id
            AND facility_id = v_invitation.facility_id
        ) THEN
          INSERT INTO public.memberships (
            user_id,
            organization_id,
            facility_id,
            role
          )
          VALUES (
            v_user_id,
            v_invitation.organization_id,
            v_invitation.facility_id,
            v_role
          );
        END IF;
        INSERT INTO public.profiles (id, full_name)
        VALUES (
          v_user_id,
          trim(v_invitation.first_name || ' ' || v_invitation.last_name)
        )
        ON CONFLICT (id) DO NOTHING;
        UPDATE public.staff_invitations
        SET status = 'accepted',
            accepted_by = v_user_id,
            accepted_at = now(),
            updated_at = now()
        WHERE id = v_invitation.id;
        RETURN jsonb_build_object(
          'success', true,
          'message', 'Einladung erfolgreich angenommen.',
          'facility_id', v_invitation.facility_id,
          'role', v_role
        );
      END;
      $function$
    $replace_accept$;
  END IF;
END;
$accept$;

DO $claim$
DECLARE
  definition text;
BEGIN
  IF to_regprocedure('public.claim_staff_invitations()') IS NULL THEN
    RAISE NOTICE 'claim_staff_invitations() ist nicht vorhanden und wird nicht angelegt.';
    RETURN;
  END IF;
  definition := regexp_replace(pg_get_functiondef('public.claim_staff_invitations()'::regprocedure), '[[:space:]]+', ' ', 'g');
  IF position('coalesce(r.role, ''employee'')' IN definition) > 0
     AND position('IN (''employee'', ''technician'')' IN definition) > 0 THEN
    RETURN;
  END IF;
  IF position('status=''sent'' AND role=''employee''' IN definition) = 0
     AND position('status = ''sent'' AND role = ''employee''' IN definition) = 0 THEN
    RAISE EXCEPTION 'claim_staff_invitations entspricht nicht der geprüften Fassung und wurde nicht ersetzt.';
  END IF;
  IF position('Deaktivierte Zuordnung: Bitte Betriebsleitung kontaktieren.' IN definition) = 0
     OR position('technician' IN definition) > 0 THEN
    RAISE EXCEPTION 'claim_staff_invitations entspricht nicht der geprüften Fassung und wurde nicht ersetzt.';
  END IF;
  EXECUTE $replace_claim$
    CREATE OR REPLACE FUNCTION public.claim_staff_invitations()
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $function$
    DECLARE
      v_email text;
      v_count integer := 0;
      v_role text;
      r record;
    BEGIN
      IF auth.uid() IS NULL THEN RETURN 0; END IF;
      SELECT lower(users.email) INTO v_email
      FROM auth.users AS users
      WHERE users.id = auth.uid()
        AND users.email_confirmed_at IS NOT NULL;
      IF v_email IS NULL THEN RETURN 0; END IF;
      FOR r IN
        SELECT *
        FROM public.staff_invitations
        WHERE lower(email) = v_email
          AND status = 'sent'
          AND coalesce(role, 'employee') IN ('employee', 'technician')
        FOR UPDATE
      LOOP
        v_role := coalesce(r.role, 'employee');
        IF v_role NOT IN ('employee', 'technician') THEN
          RAISE EXCEPTION 'Die Einladung enthält eine unzulässige Berechtigung.';
        END IF;
        IF EXISTS (
          SELECT 1
          FROM public.memberships AS membership
          WHERE membership.user_id = auth.uid()
            AND membership.organization_id = r.organization_id
            AND (membership.facility_id = r.facility_id OR membership.role = 'company_admin')
            AND membership.is_active = false
        ) THEN
          RAISE EXCEPTION 'Deaktivierte Zuordnung: Bitte Betriebsleitung kontaktieren.';
        END IF;
        IF NOT EXISTS (
          SELECT 1
          FROM public.memberships AS membership
          WHERE membership.user_id = auth.uid()
            AND membership.organization_id = r.organization_id
            AND membership.facility_id = r.facility_id
        ) THEN
          INSERT INTO public.memberships(user_id, organization_id, facility_id, role)
          VALUES (auth.uid(), r.organization_id, r.facility_id, v_role);
        END IF;
        INSERT INTO public.profiles(id, full_name)
        VALUES (auth.uid(), r.first_name || ' ' || r.last_name)
        ON CONFLICT (id) DO UPDATE
          SET full_name = CASE
            WHEN nullif(btrim(public.profiles.full_name), '') IS NULL THEN excluded.full_name
            ELSE public.profiles.full_name
          END;
        UPDATE public.staff_invitations
        SET status = 'accepted',
            accepted_by = auth.uid(),
            accepted_at = now(),
            updated_at = now()
        WHERE id = r.id;
        v_count := v_count + 1;
      END LOOP;
      RETURN v_count;
    END;
    $function$
  $replace_claim$;
END;
$claim$;

COMMIT;
