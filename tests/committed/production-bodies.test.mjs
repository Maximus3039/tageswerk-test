import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const controlSql = readFileSync(new URL('../integration/installationskontrolle.sql', import.meta.url), 'utf8');
const invitationSql = readFileSync(new URL('../../tageswerk_3_4_invitation_role.sql', import.meta.url), 'utf8');
const roleSql = readFileSync(new URL('../../tageswerk_3_4_technician_role.sql', import.meta.url), 'utf8');
const guardSql = readFileSync(new URL('../../tageswerk_3_4_management_guard.sql', import.meta.url), 'utf8');

const productionClaim = `
CREATE OR REPLACE FUNCTION public.claim_staff_invitations()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid;
  v_email text;
  v_count integer := 0;
  r record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RETURN 0; END IF;
  SELECT lower(email) INTO v_email
  FROM auth.users
  WHERE id = v_user_id
    AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RETURN 0; END IF;
  FOR r IN
    SELECT *
    FROM public.staff_invitations
    WHERE lower(email) = v_email
      AND status = 'sent'
    FOR UPDATE
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.memberships m
      WHERE m.user_id = v_user_id
        AND m.organization_id = r.organization_id
        AND (m.facility_id = r.facility_id OR m.role = 'company_admin')
    ) THEN
      INSERT INTO public.memberships (
        user_id,
        organization_id,
        facility_id,
        role
      ) VALUES (
        v_user_id,
        r.organization_id,
        r.facility_id,
        'employee'
      );
    END IF;
    UPDATE public.staff_invitations
    SET status = 'accepted', accepted_by = v_user_id, accepted_at = now(), updated_at = now()
    WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$
`;

const productionDefect = `
CREATE OR REPLACE FUNCTION public.employee_update_assigned_defect(p_defect_id uuid, p_status text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d public.defects%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Anmeldung erforderlich'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('in_progress', 'pending_review') THEN
    RAISE EXCEPTION 'Mitarbeiter koennen nur bearbeiten oder Erledigung melden';
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) < 3 OR length(p_note) > 2000 THEN
    RAISE EXCEPTION 'Arbeitsvermerk mit 3 bis 2000 Zeichen erforderlich';
  END IF;
  SELECT * INTO d FROM public.defects WHERE id = p_defect_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mangel nicht gefunden'; END IF;
  IF d.assigned_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Dieser Mangel ist dir nicht zugewiesen';
  END IF;
  IF NOT private.can_access_facility(d.facility_id) THEN
    RAISE EXCEPTION 'Keine aktive Betriebsberechtigung';
  END IF;
  IF d.status IN ('resolved', 'pending_review') THEN
    RAISE EXCEPTION 'Vorgang ist bereits abgeschlossen oder wartet auf Freigabe';
  END IF;
  UPDATE public.defects
  SET status = p_status,
      change_note = btrim(p_note)
  WHERE id = p_defect_id;
END;
$function$
`;

const productionRequest = `
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
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Anmeldung erforderlich'; END IF;
  SELECT organization_id INTO v_org FROM public.facilities WHERE id = p_facility_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Betrieb nicht gefunden'; END IF;
  IF NOT private.can_manage_facility(p_facility_id) THEN
    RAISE EXCEPTION 'Keine aktive Verwaltungsberechtigung fuer diesen Betrieb';
  END IF;
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Ungueltige E-Mail-Adresse';
  END IF;
  IF length(btrim(p_first_name)) NOT BETWEEN 1 AND 100
     OR length(btrim(p_last_name)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Vor- und Nachname erforderlich';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.memberships m
    JOIN auth.users u ON u.id = m.user_id
    WHERE lower(u.email) = v_email AND m.organization_id = v_org
      AND (m.facility_id = p_facility_id OR m.role = 'company_admin')
  ) THEN
    RAISE EXCEPTION 'Dieser Benutzer ist bereits zugeordnet. Bitte bei Bedarf reaktivieren.';
  END IF;
  IF v_email IS NULL THEN RAISE EXCEPTION 'Fuer diese E-Mail-Adresse wird bereits eine Einladung verarbeitet.'; END IF;
  IF v_email IS NULL THEN RAISE EXCEPTION 'An diese E-Mail-Adresse wurde bereits eine Einladung versendet.'; END IF;
  IF v_email IS NULL THEN RAISE EXCEPTION 'Eine fruehere Einladung ist fehlgeschlagen. Bitte zuerst den Versandstatus pruefen.'; END IF;
  INSERT INTO public.staff_invitations (organization_id, facility_id, email, first_name, last_name, invited_by)
  VALUES (v_org, p_facility_id, v_email, btrim(p_first_name), btrim(p_last_name), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$
`;

const productionRevoke = `
CREATE OR REPLACE FUNCTION public.revoke_staff_invitation(p_invitation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r public.staff_invitations%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.staff_invitations WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND OR r.status NOT IN ('pending', 'sent') THEN
    RAISE EXCEPTION 'Keine offene Einladung gefunden';
  END IF;
  IF NOT private.can_manage_facility(r.facility_id) THEN
    RAISE EXCEPTION 'Keine aktive Verwaltungsberechtigung fuer diesen Betrieb';
  END IF;
  UPDATE public.staff_invitations SET status = 'revoked', updated_at = now() WHERE id = p_invitation_id;
END;
$function$
`;

const productionName = `
CREATE OR REPLACE FUNCTION public.update_employee_name(p_user_id uuid, p_full_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet'; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.memberships manager
    JOIN public.memberships employee ON manager.organization_id = employee.organization_id
    WHERE manager.user_id = auth.uid()
      AND manager.is_active = true
      AND employee.user_id = p_user_id
      AND (
        manager.role = 'company_admin'
        OR (manager.role = 'facility_manager' AND manager.facility_id = employee.facility_id)
      )
  ) THEN
    RAISE EXCEPTION 'Keine Berechtigung zur Namensänderung';
  END IF;
  IF p_full_name IS NULL OR length(btrim(p_full_name)) < 2 OR length(btrim(p_full_name)) > 100 THEN
    RAISE EXCEPTION 'Bitte einen Namen mit 2 bis 100 Zeichen eingeben';
  END IF;
  UPDATE public.profiles
  SET full_name = btrim(p_full_name)
  WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mitarbeiterprofil nicht gefunden'; END IF;
END;
$function$
`;

function flat(body) {
 return body.replace(/\s+/g, ' ');
}

function has(body, phrase) {
 return flat(body).includes(phrase);
}

function knownClaim(body) {
 const text = flat(body);
 return text.includes('v_user_id := auth.uid()')
  && text.includes('IF v_user_id IS NULL THEN RETURN 0')
  && (text.includes("status='sent'") || text.includes("status = 'sent'"))
  && text.includes('INSERT INTO public.memberships')
  && text.includes("'employee'")
  && !text.includes('UPDATE public.memberships');
}

function knownDefect(body) {
 const text = flat(body);
 const status = text.includes("p_status NOT IN ('in_progress','pending_review')")
  || text.includes("p_status NOT IN ('in_progress', 'pending_review')")
  || (text.includes('p_status IS NULL') && (text.includes("p_status IN ('in_progress','pending_review')") || text.includes("p_status IN ('in_progress', 'pending_review')")));
 const update = text.includes('UPDATE public.defects')
  && (text.includes('SET status=p_status') || text.includes('SET status = p_status'))
  && (text.includes('change_note=') || text.includes('change_note ='));
 return text.includes('SECURITY DEFINER')
  && text.includes('Anmeldung erforderlich')
  && text.includes('Mitarbeiter koennen nur bearbeiten oder Erledigung melden')
  && text.includes('Arbeitsvermerk mit 3 bis 2000 Zeichen erforderlich')
  && text.includes('Mangel nicht gefunden')
  && text.includes('assigned_to IS DISTINCT FROM auth.uid()')
  && text.includes('Dieser Mangel ist dir nicht zugewiesen')
  && (text.includes('Keine aktive Betriebsberechtigung') || text.includes('Keine Betriebsberechtigung'))
  && text.includes('Vorgang ist bereits abgeschlossen oder wartet auf Freigabe')
  && text.includes('FOR UPDATE')
  && text.includes('private.can_access_facility(d.facility_id)')
  && status
  && update
  && !text.includes('SET assigned_to')
  && !text.includes('SET facility_id')
  && !text.includes('SET organization_id');
}

function knownRequest(body) {
 const text = flat(body);
 return text.includes('SECURITY DEFINER')
  && text.includes('Anmeldung erforderlich')
  && text.includes('Betrieb nicht gefunden')
  && text.includes('Keine aktive Verwaltungsberechtigung fuer diesen Betrieb')
  && text.includes('Dieser Benutzer ist bereits zugeordnet. Bitte bei Bedarf reaktivieren.')
  && text.includes('private.can_manage_facility(p_facility_id)')
  && text.includes('Ungueltige E-Mail-Adresse')
  && text.includes('Vor- und Nachname erforderlich')
  && text.includes('INSERT INTO public.staff_invitations')
  && !text.includes('UPDATE public.memberships');
}

function knownRevoke(body) {
 const text = flat(body);
 return text.includes('SECURITY DEFINER')
  && text.includes('Keine offene Einladung gefunden')
  && text.includes('Keine aktive Verwaltungsberechtigung fuer diesen Betrieb')
  && text.includes('FOR UPDATE')
  && text.includes("r.status NOT IN ('pending', 'sent')")
  && text.includes('private.can_manage_facility(r.facility_id)')
  && text.includes("status = 'revoked'")
  && !text.includes('UPDATE public.memberships');
}

function knownName(body) {
 const text = flat(body);
 return text.includes('SECURITY DEFINER')
  && text.includes('Nicht angemeldet')
  && text.includes('Keine Berechtigung zur Namensänderung')
  && text.includes('Bitte einen Namen mit 2 bis 100 Zeichen eingeben')
  && text.includes('manager.is_active = true')
  && text.includes('Mitarbeiterprofil nicht gefunden')
  && text.includes('SET full_name = btrim(p_full_name)')
  && text.includes("manager.role = 'company_admin'")
  && text.includes("manager.role = 'facility_manager'")
  && !text.includes('UPDATE public.memberships');
}

test('Die fünf produktiven Funktionsfassungen werden erkannt', () => {
 assert.equal(knownClaim(productionClaim), true);
 assert.equal(knownClaim(productionClaim.replace('v_user_id := auth.uid()', 'v_user_id := null')), false);
 assert.equal(knownClaim(productionClaim.replace('INSERT INTO public.memberships', 'INSERT INTO public.profiles')), false);

 assert.equal(knownDefect(productionDefect), true);
 assert.equal(knownDefect(productionDefect.replace('private.can_access_facility(d.facility_id)', 'true')), false);
 assert.equal(knownDefect(productionDefect.replace('assigned_to IS DISTINCT FROM auth.uid()', 'false')), false);
 assert.equal(knownDefect(productionDefect.replace('FOR UPDATE', 'FOR SHARE')), false);
 assert.equal(knownDefect(productionDefect.replace('Keine aktive Betriebsberechtigung', 'weiter')), false);

 assert.equal(knownRequest(productionRequest), true);
 assert.equal(knownRequest(productionRequest.replace('private.can_manage_facility(p_facility_id)', 'true')), false);
 assert.equal(knownRequest(productionRequest.replace('Keine aktive Verwaltungsberechtigung fuer diesen Betrieb', 'Keine Berechtigung')), false);

 assert.equal(knownRevoke(productionRevoke), true);
 assert.equal(knownRevoke(productionRevoke.replace('private.can_manage_facility(r.facility_id)', 'true')), false);
 assert.equal(knownRevoke(productionRevoke.replace('FOR UPDATE', 'FOR SHARE')), false);
 assert.equal(knownRevoke(productionRevoke.replace("r.status NOT IN ('pending', 'sent')", 'false')), false);

 assert.equal(knownName(productionName), true);
 assert.equal(knownName(productionName.replace('manager.is_active = true', 'manager.user_id = auth.uid()')), false);
 assert.equal(knownName(productionName.replace('SET full_name = btrim(p_full_name)', 'SET full_name = p_full_name')), false);
 assert.equal(knownName(productionName.replace('Bitte einen Namen mit 2 bis 100 Zeichen eingeben', 'Name fehlt')), false);
});

test('Kontrolle und Migrationen akzeptieren dieselben produktiven Formulierungen', () => {
 for (const phrase of [
  'v_user_id := auth.uid()',
  'IF v_user_id IS NULL THEN RETURN 0',
  'Keine aktive Betriebsberechtigung',
  'private.can_access_facility(d.facility_id)',
  'SET status = p_status',
  'Keine aktive Verwaltungsberechtigung fuer diesen Betrieb',
  'Dieser Benutzer ist bereits zugeordnet. Bitte bei Bedarf reaktivieren.',
  'private.can_manage_facility(p_facility_id)',
  "r.status NOT IN (''pending'', ''sent'')",
  'private.can_manage_facility(r.facility_id)',
  'Bitte einen Namen mit 2 bis 100 Zeichen eingeben',
  'SET full_name = btrim(p_full_name)',
  'manager.is_active = true'
 ]) {
  assert.equal(controlSql.includes(phrase), true, phrase);
 }
 assert.match(invitationSql, /v_user_id := auth\.uid\(\)/);
 assert.match(invitationSql, /IF v_user_id IS NULL THEN RETURN 0/);
 assert.match(roleSql, /Keine aktive Betriebsberechtigung/);
 assert.match(roleSql, /private\.can_access_facility\(d\.facility_id\)/);
 assert.match(guardSql, /Keine aktive Verwaltungsberechtigung fuer diesen Betrieb/);
 assert.match(guardSql, /Dieser Benutzer ist bereits zugeordnet\. Bitte bei Bedarf reaktivieren\./);
 assert.match(guardSql, /private\.can_manage_facility\(p_facility_id\)/);
 assert.match(guardSql, /private\.can_manage_facility\(r\.facility_id\)/);
 assert.match(guardSql, /Bitte einen Namen mit 2 bis 100 Zeichen eingeben/);
 assert.match(guardSql, /SET full_name = btrim\(p_full_name\)/);
 assert.equal(has(productionClaim, 'IF auth.uid() IS NULL THEN RETURN 0'), false);
});
