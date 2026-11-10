-- Nur für eine leere, ausdrücklich bestätigte Supabase-Testdatenbank.
-- tests/integration/run.mjs setzt die dafür nötige Sitzungskennzeichnung.
-- Diese Datei legt die geprüfte Ausgangsfassung an. Sie ist nicht die produktive Migration.

DO $guard$
BEGIN
  IF current_setting('tageswerk.integration_test', true) IS DISTINCT FROM 'bestaetigt' THEN
    RAISE EXCEPTION 'baseline.sql läuft nur über tests/integration/run.mjs.';
  END IF;
  IF to_regclass('public.facilities') IS NOT NULL THEN
    RAISE EXCEPTION 'Die Testdatenbank enthält bereits Betriebe. Es wird nichts angelegt.';
  END IF;
END;
$guard$;

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  name text NOT NULL
);

CREATE TABLE public.facilities (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  name text NOT NULL
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  full_name text
);

CREATE TABLE public.memberships (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  facility_id uuid REFERENCES public.facilities (id),
  role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT memberships_role_check CHECK (
    role IN ('employee', 'facility_manager', 'company_admin')
  )
);

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_select ON public.memberships FOR SELECT TO authenticated
  USING (user_id = auth.uid());
REVOKE ALL ON TABLE public.memberships FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.memberships TO authenticated;

CREATE TABLE public.staff_invitations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  email text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  role text NOT NULL DEFAULT 'employee',
  invited_by uuid,
  invited_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  accepted_by uuid,
  accepted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE public.utility_meters (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.utility_meter_readings (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  meter_id uuid NOT NULL REFERENCES public.utility_meters (id),
  reading_type text NOT NULL,
  reading_value numeric NOT NULL,
  reading_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  recorded_by uuid,
  voided_at timestamptz,
  corrects_reading_id uuid
);

CREATE OR REPLACE FUNCTION public.tageswerk_meter_role(
  p_organization_id uuid,
  p_facility_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
  SELECT m.role
  FROM public.memberships m
  WHERE m.user_id = auth.uid()
    AND m.is_active IS TRUE
    AND m.organization_id = p_organization_id
    AND (
      (m.role = 'company_admin' AND m.facility_id IS NULL)
      OR (m.role = 'facility_manager' AND m.facility_id = p_facility_id)
      OR (m.role = 'employee' AND m.facility_id = p_facility_id)
    )
  ORDER BY CASE m.role
    WHEN 'company_admin' THEN 1
    WHEN 'facility_manager' THEN 2
    ELSE 3
  END
  LIMIT 1;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_facility_organization(p_facility_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $tageswerk$
  SELECT facility.organization_id
  FROM public.facilities AS facility
  WHERE facility.id = p_facility_id
    AND public.tageswerk_meter_role(facility.organization_id, facility.id) IS NOT NULL;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_bind_operation_facility()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  org uuid;
BEGIN
  org := public.tageswerk_facility_organization(NEW.facility_id);
  IF org IS NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung für den Betrieb.';
  END IF;
  NEW.organization_id := org;
  RETURN NEW;
END;
$tageswerk$;

CREATE OR REPLACE FUNCTION public.tageswerk_prepare_reading()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $tageswerk$
DECLARE
  actor_role text;
  meter public.utility_meters%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Eine Anmeldung ist erforderlich.';
  END IF;
  SELECT * INTO meter FROM public.utility_meters WHERE id = CASE WHEN TG_OP = 'UPDATE' THEN OLD.meter_id ELSE NEW.meter_id END;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Zähler wurde nicht gefunden.';
  END IF;
  actor_role := public.tageswerk_meter_role(meter.organization_id, meter.facility_id);
  IF actor_role IS NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung für diesen Zähler.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.meter_id IS DISTINCT FROM OLD.meter_id
       OR NEW.reading_type IS DISTINCT FROM OLD.reading_type
       OR NEW.reading_value IS DISTINCT FROM OLD.reading_value THEN
      RAISE EXCEPTION 'Eine Stornierung ändert nur den Stornierungsvermerk.';
    END IF;
    IF actor_role NOT IN ('company_admin', 'facility_manager') THEN
      RAISE EXCEPTION 'Stornieren darf die Betriebsleitung oder Geschäftsführung.';
    END IF;
    RETURN NEW;
  END IF;
  IF actor_role = 'employee' AND NEW.reading_type <> 'regular' THEN
    RAISE EXCEPTION 'Mitarbeiter erfassen normale Zählerstände.';
  END IF;
  IF NEW.reading_type = 'correction' AND NEW.corrects_reading_id IS NULL THEN
    RAISE EXCEPTION 'Die Korrektur bezieht sich auf eine gültige ursprüngliche Ablesung desselben Zählers.';
  END IF;
  NEW.recorded_by := auth.uid();
  NEW.voided_at := NULL;
  RETURN NEW;
END;
$tageswerk$;

CREATE TRIGGER utility_meter_readings_prepare
  BEFORE INSERT OR UPDATE ON public.utility_meter_readings
  FOR EACH ROW EXECUTE FUNCTION public.tageswerk_prepare_reading();

ALTER TABLE public.utility_meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_meter_readings FORCE ROW LEVEL SECURITY;
CREATE POLICY utility_meter_readings_insert ON public.utility_meter_readings
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.utility_meters AS meter
      WHERE meter.id = utility_meter_readings.meter_id
        AND (
          (
            public.tageswerk_meter_role(meter.organization_id, meter.facility_id) = 'employee'
            AND utility_meter_readings.reading_type = 'regular'
            AND meter.is_active IS TRUE
            AND utility_meter_readings.voided_at IS NULL
          )
          OR public.tageswerk_meter_role(meter.organization_id, meter.facility_id)
             IN ('company_admin', 'facility_manager')
        )
    )
  );
REVOKE ALL ON TABLE public.utility_meter_readings FROM PUBLIC, anon;
GRANT INSERT ON TABLE public.utility_meter_readings TO authenticated;
GRANT SELECT ON TABLE public.utility_meters TO authenticated;

CREATE OR REPLACE FUNCTION public.manage_facility_membership(
  p_email text,
  p_facility_id uuid,
  p_role text,
  p_remove boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_org uuid; v_target uuid; v_caller uuid := auth.uid();
  v_company_admin boolean; v_manager boolean; v_existing uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Anmeldung erforderlich'; END IF;
  SELECT organization_id INTO v_org FROM public.facilities WHERE id = p_facility_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Betrieb nicht gefunden'; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.memberships AS m
    WHERE m.user_id = v_caller AND m.organization_id = v_org AND m.role = 'company_admin' AND m.is_active = true
  ) INTO v_company_admin;
  SELECT EXISTS(
    SELECT 1 FROM public.memberships AS m
    WHERE m.user_id = v_caller AND m.organization_id = v_org AND m.facility_id = p_facility_id
      AND m.role = 'facility_manager' AND m.is_active = true
  ) INTO v_manager;
  IF NOT (v_company_admin OR v_manager) THEN RAISE EXCEPTION 'Keine Verwaltungsberechtigung fuer diesen Betrieb'; END IF;
  IF p_role NOT IN ('employee','facility_manager') THEN RAISE EXCEPTION 'Ungueltige Rolle'; END IF;
  IF p_role = 'facility_manager' AND NOT v_company_admin THEN RAISE EXCEPTION 'Nur Geschaeftsfuehrung darf Betriebsleitungen ernennen'; END IF;
  SELECT users.id INTO v_target FROM auth.users AS users WHERE lower(users.email) = lower(btrim(p_email)) LIMIT 1;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Kein registriertes Tageswerk-Konto mit dieser E-Mail vorhanden'; END IF;
  IF v_target = v_caller THEN RAISE EXCEPTION 'Eigene Berechtigungen hier nicht veraenderbar'; END IF;
  IF EXISTS(
    SELECT 1 FROM public.memberships AS m
    WHERE m.user_id = v_target AND m.organization_id = v_org AND m.role = 'company_admin'
  ) THEN
    RAISE EXCEPTION 'Geschaeftsfuehrungsrechte werden hier nicht veraendert';
  END IF;
  SELECT m.id INTO v_existing FROM public.memberships AS m
  WHERE m.user_id = v_target AND m.organization_id = v_org AND m.facility_id = p_facility_id
  ORDER BY m.id LIMIT 1 FOR UPDATE;
  IF v_existing IS NOT NULL THEN
    IF NOT v_company_admin AND EXISTS(
      SELECT 1 FROM public.memberships AS m WHERE m.id = v_existing AND m.role <> 'employee'
    ) THEN
      RAISE EXCEPTION 'Betriebsleitung darf nur Mitarbeiterzuordnungen bearbeiten';
    END IF;
    IF p_remove THEN
      UPDATE public.memberships SET is_active = false WHERE id = v_existing;
      RETURN 'Zuordnung deaktiviert';
    END IF;
    IF EXISTS(SELECT 1 FROM public.memberships WHERE id = v_existing AND is_active = false) THEN
      RAISE EXCEPTION 'Zuordnung ist deaktiviert. Reaktivierung nur ueber gesonderte Freigabe.';
    END IF;
    UPDATE public.memberships SET role = p_role WHERE id = v_existing;
    RETURN 'Zuordnung aktualisiert';
  END IF;
  IF p_remove THEN RAISE EXCEPTION 'Keine Zuordnung vorhanden'; END IF;
  INSERT INTO public.memberships(user_id, organization_id, facility_id, role)
    VALUES (v_target, v_org, p_facility_id, p_role);
  RETURN 'Mitarbeiter zugeordnet';
END;
$function$;

CREATE OR REPLACE FUNCTION public.accept_staff_invitation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid;
  v_email text;
  v_invitation public.staff_invitations%ROWTYPE;
BEGIN
  v_user_id := (SELECT auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Bitte zuerst anmelden.';
  END IF;
  SELECT lower(trim(users.email)) INTO v_email
  FROM auth.users AS users
  WHERE users.id = v_user_id AND users.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Die E-Mail-Adresse ist noch nicht bestätigt.';
  END IF;
  SELECT * INTO v_invitation
  FROM public.staff_invitations
  WHERE lower(email) = v_email AND status = 'sent' AND role = 'employee'
  ORDER BY invited_at ASC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Keine offene Einladung gefunden.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.memberships AS m
    WHERE m.user_id = v_user_id
      AND m.organization_id = v_invitation.organization_id
      AND (m.facility_id = v_invitation.facility_id OR m.role = 'company_admin')
      AND m.is_active = false
  ) THEN
    RAISE EXCEPTION 'Deaktivierte Zuordnung: Bitte Betriebsleitung kontaktieren.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = v_user_id
      AND organization_id = v_invitation.organization_id
      AND facility_id = v_invitation.facility_id
  ) THEN
    INSERT INTO public.memberships (user_id, organization_id, facility_id, role)
    VALUES (v_user_id, v_invitation.organization_id, v_invitation.facility_id, 'employee');
  END IF;
  INSERT INTO public.profiles (id, full_name)
  VALUES (v_user_id, trim(v_invitation.first_name || ' ' || v_invitation.last_name))
  ON CONFLICT (id) DO NOTHING;
  UPDATE public.staff_invitations
  SET status = 'accepted', accepted_by = v_user_id, accepted_at = now(), updated_at = now()
  WHERE id = v_invitation.id;
  RETURN jsonb_build_object('success', true, 'message', 'Einladung erfolgreich angenommen.', 'facility_id', v_invitation.facility_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_staff_invitations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_email text; v_count integer := 0; r record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RETURN 0; END IF;
  FOR r IN SELECT * FROM public.staff_invitations WHERE lower(email) = v_email AND status='sent' AND role='employee' FOR UPDATE LOOP
    IF EXISTS (
      SELECT 1 FROM public.memberships AS m
      WHERE m.user_id = auth.uid() AND m.organization_id = r.organization_id
        AND (m.facility_id = r.facility_id OR m.role = 'company_admin') AND m.is_active = false
    ) THEN
      RAISE EXCEPTION 'Deaktivierte Zuordnung: Bitte Betriebsleitung kontaktieren.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.memberships AS m
      WHERE m.user_id = auth.uid() AND m.organization_id = r.organization_id AND m.facility_id = r.facility_id
    ) THEN
      INSERT INTO public.memberships(user_id, organization_id, facility_id, role)
      VALUES (auth.uid(), r.organization_id, r.facility_id, 'employee');
    END IF;
    UPDATE public.staff_invitations
    SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now(), updated_at = now()
    WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.tageswerk_meter_role(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tageswerk_facility_organization(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manage_facility_membership(text, uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_staff_invitation() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_staff_invitations() TO authenticated;
