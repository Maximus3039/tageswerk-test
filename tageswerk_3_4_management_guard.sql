-- Tageswerk 3.4, aktive Verwaltungsberechtigung
-- Nicht ohne ausdrückliche Freigabe ausführen.
-- Die fünf vorherigen Dateien sind noch nicht produktiv ausgeführt.
-- Diese Datei folgt auf tageswerk_3_4_invitation_role.sql.
-- Sie ersetzt nur die vier geprüften produktiven Funktionen.
-- Ergänzt wird ausschließlich die aktive Mitgliedschaft des Aufrufers.
-- Eine aktive Geschäftsführung der Organisation bleibt berechtigt.
-- Eine bereits abgesicherte Fassung bleibt stehen.
-- Eine unbekannte Fassung setzt die Transaktion zurück.
-- Es werden keine Betriebsdaten verändert und keine Benutzer angelegt.

BEGIN;

DO $list$
DECLARE
  definition text;
BEGIN
  IF to_regprocedure('public.list_facility_employees()') IS NULL THEN
    RAISE EXCEPTION 'list_facility_employees() fehlt und wurde nicht neu erfunden.';
  END IF;
  definition := regexp_replace(pg_get_functiondef('public.list_facility_employees()'::regprocedure), '[[:space:]]+', ' ', 'g');
  IF position('SECURITY DEFINER' IN definition) = 0
     OR position('auth.uid() IS NOT NULL' IN definition) = 0
     OR position('manager.user_id = auth.uid()' IN definition) = 0
     OR position('manager.organization_id = m.organization_id' IN definition) = 0
     OR position('manager.role = ''company_admin''' IN definition) = 0
     OR position('manager.role = ''facility_manager''' IN definition) = 0
     OR position('manager.facility_id = m.facility_id' IN definition) = 0
     OR position('ORDER BY f.name, p.full_name' IN definition) = 0
     OR position('UPDATE ' IN definition) > 0
     OR position('INSERT ' IN definition) > 0
     OR position('DELETE ' IN definition) > 0 THEN
    RAISE EXCEPTION 'list_facility_employees entspricht nicht der geprüften Fassung und wurde nicht ersetzt.';
  END IF;
  IF position('manager.is_active = true' IN definition) > 0
     OR position('manager.is_active IS TRUE' IN definition) > 0 THEN
    RETURN;
  END IF;
  IF position('is_active' IN definition) > 0 THEN
    RAISE EXCEPTION 'list_facility_employees enthält is_active in einer unbekannten Form und wurde nicht ersetzt.';
  END IF;
  EXECUTE $replace_list$
    CREATE OR REPLACE FUNCTION public.list_facility_employees()
    RETURNS TABLE(user_id uuid, full_name text, email text, role text, facility_id uuid, facility_name text)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path TO ''
    AS $function$
      SELECT
        m.user_id,
        p.full_name,
        u.email::text,
        m.role::text,
        m.facility_id,
        f.name::text
      FROM public.memberships m
      JOIN auth.users u
        ON u.id = m.user_id
      LEFT JOIN public.profiles p
        ON p.id = m.user_id
      LEFT JOIN public.facilities f
        ON f.id = m.facility_id
      WHERE auth.uid() IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.memberships manager
          WHERE manager.user_id = auth.uid()
            AND manager.is_active = true
            AND manager.organization_id = m.organization_id
            AND (
              manager.role = 'company_admin'
              OR (
                manager.role = 'facility_manager'
                AND manager.facility_id = m.facility_id
              )
            )
        )
      ORDER BY f.name, p.full_name;
    $function$
  $replace_list$;
END;
$list$;

DO $request$
DECLARE
  definition text;
BEGIN
  IF to_regprocedure('public.request_staff_invitation(uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'request_staff_invitation(uuid, text, text, text) fehlt und wurde nicht neu erfunden.';
  END IF;
  definition := regexp_replace(pg_get_functiondef('public.request_staff_invitation(uuid,text,text,text)'::regprocedure), '[[:space:]]+', ' ', 'g');
  IF position('SECURITY DEFINER' IN definition) = 0
     OR position('Anmeldung erforderlich' IN definition) = 0
     OR position('Betrieb nicht gefunden' IN definition) = 0
     OR position('Keine Berechtigung fuer diesen Betrieb' IN definition) = 0
     OR position('Ungueltige E-Mail-Adresse' IN definition) = 0
     OR position('Vor- und Nachname erforderlich' IN definition) = 0
     OR position('Dieser Mitarbeiter besitzt bereits Zugang zu diesem Betrieb.' IN definition) = 0
     OR position('Fuer diese E-Mail-Adresse wird bereits eine Einladung verarbeitet.' IN definition) = 0
     OR position('An diese E-Mail-Adresse wurde bereits eine Einladung versendet.' IN definition) = 0
     OR position('Eine fruehere Einladung ist fehlgeschlagen. Bitte zuerst den Versandstatus pruefen.' IN definition) = 0
     OR position('m.role = ''company_admin''' IN definition) = 0
     OR position('m.role = ''facility_manager''' IN definition) = 0
     OR position('m.facility_id = p_facility_id' IN definition) = 0
     OR position('INSERT INTO public.staff_invitations' IN definition) = 0
     OR position('UPDATE public.memberships' IN definition) > 0
     OR position('DELETE ' IN definition) > 0 THEN
    RAISE EXCEPTION 'request_staff_invitation entspricht nicht der geprüften Fassung und wurde nicht ersetzt.';
  END IF;
  IF position('m.user_id = auth.uid() AND m.is_active = true' IN definition) > 0
     OR position('m.user_id = auth.uid() AND m.is_active IS TRUE' IN definition) > 0 THEN
    RETURN;
  END IF;
  IF position('is_active' IN definition) > 0 THEN
    RAISE EXCEPTION 'request_staff_invitation enthält is_active in einer unbekannten Form und wurde nicht ersetzt.';
  END IF;
  EXECUTE $replace_request$
    CREATE OR REPLACE FUNCTION public.request_staff_invitation(p_facility_id uuid, p_email text, p_first_name text, p_last_name text)
    RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO ''
    AS $function$
    DECLARE
      v_org uuid;
      v_id uuid;
      v_email text := lower(btrim(p_email));
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
      IF NOT EXISTS (
        SELECT 1
        FROM public.memberships m
        WHERE m.user_id = auth.uid()
          AND m.is_active = true
          AND m.organization_id = v_org
          AND (
            m.role = 'company_admin'
            OR (
              m.role = 'facility_manager'
              AND m.facility_id = p_facility_id
            )
          )
      ) THEN
        RAISE EXCEPTION 'Keine Berechtigung fuer diesen Betrieb';
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
        FROM public.memberships m
        JOIN auth.users u ON u.id = m.user_id
        WHERE lower(u.email) = v_email
          AND m.organization_id = v_org
          AND (
            m.facility_id = p_facility_id
            OR m.role = 'company_admin'
          )
      ) THEN
        RAISE EXCEPTION 'Dieser Mitarbeiter besitzt bereits Zugang zu diesem Betrieb.';
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
        invited_by
      )
      VALUES (
        v_org,
        p_facility_id,
        v_email,
        btrim(p_first_name),
        btrim(p_last_name),
        auth.uid()
      )
      RETURNING id INTO v_id;
      RETURN v_id;
    END;
    $function$
  $replace_request$;
END;
$request$;

DO $revoke$
DECLARE
  definition text;
BEGIN
  IF to_regprocedure('public.revoke_staff_invitation(uuid)') IS NULL THEN
    RAISE EXCEPTION 'revoke_staff_invitation(uuid) fehlt und wurde nicht neu erfunden.';
  END IF;
  definition := regexp_replace(pg_get_functiondef('public.revoke_staff_invitation(uuid)'::regprocedure), '[[:space:]]+', ' ', 'g');
  IF position('SECURITY DEFINER' IN definition) = 0
     OR position('Keine offene Einladung gefunden' IN definition) = 0
     OR position('Keine Berechtigung' IN definition) = 0
     OR position('FOR UPDATE' IN definition) = 0
     OR (
       position('status NOT IN (''pending'',''sent'')' IN definition) = 0
       AND position('status NOT IN (''pending'', ''sent'')' IN definition) = 0
     )
     OR (
       position('m.role=''company_admin''' IN definition) = 0
       AND position('m.role = ''company_admin''' IN definition) = 0
     )
     OR (
       position('m.role=''facility_manager'' AND m.facility_id=r.facility_id' IN definition) = 0
       AND position('m.role = ''facility_manager'' AND m.facility_id = r.facility_id' IN definition) = 0
     )
     OR (
       position('status=''revoked''' IN definition) = 0
       AND position('status = ''revoked''' IN definition) = 0
     )
     OR position('UPDATE public.memberships' IN definition) > 0
     OR position('DELETE ' IN definition) > 0 THEN
    RAISE EXCEPTION 'revoke_staff_invitation entspricht nicht der geprüften Fassung und wurde nicht ersetzt.';
  END IF;
  IF position('m.user_id=auth.uid() AND m.is_active = true' IN definition) > 0
     OR position('m.user_id = auth.uid() AND m.is_active = true' IN definition) > 0 THEN
    RETURN;
  END IF;
  IF position('is_active' IN definition) > 0 THEN
    RAISE EXCEPTION 'revoke_staff_invitation enthält is_active in einer unbekannten Form und wurde nicht ersetzt.';
  END IF;
  EXECUTE $replace_revoke$
    CREATE OR REPLACE FUNCTION public.revoke_staff_invitation(p_invitation_id uuid)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO ''
    AS $function$
    DECLARE r public.staff_invitations%ROWTYPE;
    BEGIN
      SELECT * INTO r FROM public.staff_invitations WHERE id = p_invitation_id FOR UPDATE;
      IF NOT FOUND OR r.status NOT IN ('pending','sent') THEN
        RAISE EXCEPTION 'Keine offene Einladung gefunden';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.memberships m
        WHERE m.user_id = auth.uid()
          AND m.is_active = true
          AND m.organization_id = r.organization_id
          AND (m.role = 'company_admin' OR (m.role = 'facility_manager' AND m.facility_id = r.facility_id))
      ) THEN
        RAISE EXCEPTION 'Keine Berechtigung';
      END IF;
      UPDATE public.staff_invitations SET status = 'revoked', updated_at = now() WHERE id = p_invitation_id;
    END;
    $function$
  $replace_revoke$;
END;
$revoke$;

DO $rename$
DECLARE
  definition text;
BEGIN
  IF to_regprocedure('public.update_employee_name(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'update_employee_name(uuid, text) fehlt und wurde nicht neu erfunden.';
  END IF;
  definition := regexp_replace(pg_get_functiondef('public.update_employee_name(uuid,text)'::regprocedure), '[[:space:]]+', ' ', 'g');
  IF position('SECURITY DEFINER' IN definition) = 0
     OR position('Nicht angemeldet' IN definition) = 0
     OR position('Keine Berechtigung zur Namensänderung' IN definition) = 0
     OR position('Bitte einen gültigen Namen eingeben' IN definition) = 0
     OR position('Mitarbeiterprofil nicht gefunden' IN definition) = 0
     OR position('manager.role = ''company_admin''' IN definition) = 0
     OR position('manager.role = ''facility_manager''' IN definition) = 0
     OR position('manager.facility_id = employee.facility_id' IN definition) = 0
     OR position('UPDATE public.profiles' IN definition) = 0
     OR position('SET full_name = trim(p_full_name)' IN definition) = 0
     OR position('UPDATE public.memberships' IN definition) > 0
     OR position('DELETE ' IN definition) > 0 THEN
    RAISE EXCEPTION 'update_employee_name entspricht nicht der geprüften Fassung und wurde nicht ersetzt.';
  END IF;
  IF position('manager.is_active = true' IN definition) > 0
     OR position('manager.is_active IS TRUE' IN definition) > 0 THEN
    RETURN;
  END IF;
  IF position('is_active' IN definition) > 0 THEN
    RAISE EXCEPTION 'update_employee_name enthält is_active in einer unbekannten Form und wurde nicht ersetzt.';
  END IF;
  EXECUTE $replace_name$
    CREATE OR REPLACE FUNCTION public.update_employee_name(p_user_id uuid, p_full_name text)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO ''
    AS $function$
    BEGIN
      IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Nicht angemeldet';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM public.memberships manager
        JOIN public.memberships employee
          ON manager.organization_id = employee.organization_id
        WHERE manager.user_id = auth.uid()
          AND manager.is_active = true
          AND employee.user_id = p_user_id
          AND (
            manager.role = 'company_admin'
            OR (
              manager.role = 'facility_manager'
              AND manager.facility_id = employee.facility_id
            )
          )
      ) THEN
        RAISE EXCEPTION 'Keine Berechtigung zur Namensänderung';
      END IF;
      IF p_full_name IS NULL OR length(trim(p_full_name)) < 2 THEN
        RAISE EXCEPTION 'Bitte einen gültigen Namen eingeben';
      END IF;
      UPDATE public.profiles
      SET full_name = trim(p_full_name)
      WHERE id = p_user_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Mitarbeiterprofil nicht gefunden';
      END IF;
    END;
    $function$
  $replace_name$;
END;
$rename$;

COMMIT;
