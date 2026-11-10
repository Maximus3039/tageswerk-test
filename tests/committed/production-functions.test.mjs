import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {state} from '../../js/state.js';
import {isManager, mayAppointManager} from '../../js/permissions.js';

const roleSql = readFileSync(new URL('../../tageswerk_3_4_technician_role.sql', import.meta.url), 'utf8');
const invitationSql = readFileSync(new URL('../../tageswerk_3_4_invitation_role.sql', import.meta.url), 'utf8');
const controlSql = readFileSync(new URL('../integration/installationskontrolle.sql', import.meta.url), 'utf8');

const productionManage = `
IF NOT (v_company_admin OR v_manager) THEN RAISE EXCEPTION 'Keine Verwaltungsberechtigung fuer diesen Betrieb'; END IF;
IF p_role NOT IN ('employee','facility_manager') THEN RAISE EXCEPTION 'Ungueltige Rolle'; END IF;
IF p_role='facility_manager' AND NOT v_company_admin THEN RAISE EXCEPTION 'Nur Geschaeftsfuehrung darf Betriebsleitungen ernennen'; END IF;
IF v_target=v_caller THEN RAISE EXCEPTION 'Eigene Berechtigungen hier nicht veraenderbar'; END IF;
RAISE EXCEPTION 'Geschaeftsfuehrungsrechte werden hier nicht veraendert';
IF NOT v_company_admin AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.id=v_existing AND m.role<>'employee') THEN
  RAISE EXCEPTION 'Betriebsleitung darf nur Mitarbeiterzuordnungen bearbeiten';
END IF;
DELETE FROM public.memberships WHERE id=v_existing;
`;

const productionAccept = `
RAISE EXCEPTION 'Bitte zuerst anmelden.';
RAISE EXCEPTION 'Die E-Mail-Adresse ist noch nicht bestätigt.';
WHERE lower(email) = v_email AND status = 'sent' AND role = 'employee'
RETURN jsonb_build_object('success', false, 'message', 'Keine offene Einladung gefunden.');
FROM public.staff_invitations
VALUES (v_user_id, v_invitation.organization_id, v_invitation.facility_id, 'employee');
`;

const productionClaim = `
IF auth.uid() IS NULL THEN RETURN 0; END IF;
FOR r IN SELECT * FROM public.staff_invitations WHERE lower(email)=v_email AND status='sent' FOR UPDATE LOOP
  INSERT INTO public.memberships(user_id,organization_id,facility_id,role)
  VALUES(auth.uid(),r.organization_id,r.facility_id,'employee');
`;

const productionDefect = `
SECURITY DEFINER
RAISE EXCEPTION 'Anmeldung erforderlich';
RAISE EXCEPTION 'Mitarbeiter koennen nur bearbeiten oder Erledigung melden';
RAISE EXCEPTION 'Arbeitsvermerk mit 3 bis 2000 Zeichen erforderlich';
RAISE EXCEPTION 'Mangel nicht gefunden';
IF d.assigned_to IS DISTINCT FROM auth.uid() THEN
 RAISE EXCEPTION 'Dieser Mangel ist dir nicht zugewiesen';
END IF;
WHERE m.user_id=auth.uid() AND m.organization_id=d.organization_id
AND (m.role='company_admin' OR m.facility_id=d.facility_id)
RAISE EXCEPTION 'Keine Betriebsberechtigung';
IF p_status NOT IN ('in_progress','pending_review') THEN
IF d.status IN ('resolved','pending_review') THEN
 RAISE EXCEPTION 'Vorgang ist bereits abgeschlossen oder wartet auf Freigabe';
END IF;
SELECT * INTO d FROM public.defects WHERE id=p_defect_id FOR UPDATE;
UPDATE public.defects SET status=p_status, change_note=btrim(p_note)
`;

function knownManage(body) {
 const text = body.replace(/\s+/g, ' ');
 const has = phrase => text.includes(phrase);
 if (text.includes('technician')) {
  return has("p_role NOT IN ('employee','technician','facility_manager')")
   && has("m.role NOT IN ('employee','technician')")
   && has('Geschaeftsfuehrungsrechte werden hier nicht veraendert')
   && has('Nur Geschaeftsfuehrung darf Betriebsleitungen ernennen')
   && has('Eine deaktivierte Zuordnung wird nur mit derselben Rolle wieder freigegeben.')
   && has('SET is_active = true');
 }
 return has('Keine Verwaltungsberechtigung fuer diesen Betrieb')
  && has('Ungueltige Rolle')
  && has('Nur Geschaeftsfuehrung darf Betriebsleitungen ernennen')
  && has('Geschaeftsfuehrungsrechte werden hier nicht veraendert')
  && has('Betriebsleitung darf nur Mitarbeiterzuordnungen bearbeiten')
  && has('Eigene Berechtigungen hier nicht veraenderbar')
  && (has("p_role NOT IN ('employee','facility_manager')") || has("p_role NOT IN ('employee', 'facility_manager')"))
  && (has('Reaktivierung nur ueber gesonderte Freigabe') || has('DELETE FROM public.memberships'));
}

function knownAccept(body) {
 const text = body.replace(/\s+/g, ' ');
 const has = phrase => text.includes(phrase);
 if (has("v_role := coalesce(v_invitation.role, 'employee')")
  && has("coalesce(role, 'employee') IN ('employee', 'technician')")
  && has('Keine offene Einladung gefunden.')
  && has('Deaktivierte Zuordnung: Bitte Betriebsleitung kontaktieren.')
  && !text.includes('UPDATE public.memberships')) return true;
 if (text.includes('technician')) return false;
 return has('Bitte zuerst anmelden.')
  && has('Die E-Mail-Adresse ist noch nicht bestätigt.')
  && has("status = 'sent'")
  && has("role = 'employee'")
  && has('Keine offene Einladung gefunden.')
  && has('staff_invitations');
}

function knownClaim(body) {
 if (!body) return true;
 const text = body.replace(/\s+/g, ' ');
 const has = phrase => text.includes(phrase);
 if (has("coalesce(r.role, 'employee')")
  && has("IN ('employee', 'technician')")
  && has('Deaktivierte Zuordnung: Bitte Betriebsleitung kontaktieren.')
  && has('IF auth.uid() IS NULL THEN RETURN 0')) return true;
 if (text.includes('technician')) return false;
 return has('IF auth.uid() IS NULL THEN RETURN 0')
  && (has("status='sent'") || has("status = 'sent'"))
  && (has("r.facility_id,'employee'") || has("r.facility_id, 'employee'"));
}

function knownDefect(body) {
 const text = body.replace(/\s+/g, ' ');
 const has = phrase => text.includes(phrase);
 const safe = has('SECURITY DEFINER')
  && has('Anmeldung erforderlich')
  && has('Mitarbeiter koennen nur bearbeiten oder Erledigung melden')
  && has('Arbeitsvermerk mit 3 bis 2000 Zeichen erforderlich')
  && has('Mangel nicht gefunden')
  && has('assigned_to IS DISTINCT FROM auth.uid()')
  && has('Dieser Mangel ist dir nicht zugewiesen')
  && has('Keine Betriebsberechtigung')
  && has('Vorgang ist bereits abgeschlossen oder wartet auf Freigabe')
  && has('FOR UPDATE')
  && (has('m.organization_id=d.organization_id') || has('m.organization_id = d.organization_id'))
  && (has('m.facility_id=d.facility_id') || has('m.facility_id = d.facility_id'))
  && (has("m.role='company_admin'") || has("m.role = 'company_admin'"))
  && (has("p_status NOT IN ('in_progress','pending_review')") || has("p_status NOT IN ('in_progress', 'pending_review')"))
  && (has("d.status IN ('resolved','pending_review')") || has("d.status IN ('resolved', 'pending_review')"))
  && has('UPDATE public.defects SET status=p_status, change_note=')
  && !has('SET assigned_to')
  && !has('SET facility_id')
  && !has('SET organization_id');
 const known = !text.includes("= 'employee'")
  && !text.includes("<> 'employee'")
  && (has("m.role='company_admin' OR m.facility_id=d.facility_id") || has("m.role = 'company_admin' OR m.facility_id = d.facility_id"));
 return safe && known;
}

function productionManageCall({caller, target, memberships, facility, role, remove}) {
 if (!caller) return {error: 'Anmeldung erforderlich'};
 const admin = memberships.some(item => item.user_id === caller && item.organization_id === facility.organization_id && item.role === 'company_admin');
 const manager = memberships.some(item => item.user_id === caller && item.organization_id === facility.organization_id && item.facility_id === facility.id && item.role === 'facility_manager');
 if (!admin && !manager) return {error: 'Keine Verwaltungsberechtigung fuer diesen Betrieb'};
 if (!['employee', 'facility_manager'].includes(role)) return {error: 'Ungueltige Rolle'};
 if (role === 'facility_manager' && !admin) return {error: 'Nur Geschaeftsfuehrung darf Betriebsleitungen ernennen'};
 if (target === caller) return {error: 'Eigene Berechtigungen hier nicht veraenderbar'};
 if (memberships.some(item => item.user_id === target && item.organization_id === facility.organization_id && item.role === 'company_admin')) {
  return {error: 'Geschaeftsfuehrungsrechte werden hier nicht veraendert'};
 }
 const existing = memberships.find(item => item.user_id === target && item.organization_id === facility.organization_id && item.facility_id === facility.id);
 if (existing && !admin && existing.role !== 'employee') return {error: 'Betriebsleitung darf nur Mitarbeiterzuordnungen bearbeiten'};
 if (existing && remove) return {deleted: true};
 if (!existing && remove) return {error: 'Keine Zuordnung vorhanden'};
 return {kept: true, role};
}

test('Die produktiven Fassungen werden erkannt und unsichere Fassungen stoppen', () => {
 assert.equal(knownManage(productionManage), true);
 assert.equal(knownManage(productionManage.replace('DELETE FROM public.memberships', 'UPDATE public.memberships SET role=p_role')), false);
 assert.equal(knownManage(productionManage.replace('Geschaeftsfuehrungsrechte werden hier nicht veraendert', 'offen')), false);
 assert.equal(knownAccept(productionAccept), true);
 assert.equal(knownAccept(productionAccept.replace('Bitte zuerst anmelden.', 'weiter')), false);
 assert.equal(knownAccept(productionAccept.replace("role = 'employee'", "role = 'technician'")), false);
 assert.equal(knownClaim(productionClaim), true);
 assert.equal(knownClaim(null), true);
 assert.equal(knownClaim(productionClaim.replace("r.facility_id,'employee'", 'r.facility_id,r.role')), false);
 assert.equal(knownDefect(productionDefect), true);
 assert.equal(knownDefect(productionDefect.replace('assigned_to IS DISTINCT FROM auth.uid()', 'true')), false);
 assert.equal(knownDefect(productionDefect.replace('UPDATE public.defects SET status=p_status, change_note=btrim(p_note)', 'UPDATE public.defects SET assigned_to=auth.uid(), status=p_status, change_note=btrim(p_note)')), false);

 assert.match(roleSql, /DELETE FROM public\.memberships/);
 assert.match(roleSql, /Reaktivierung nur ueber gesonderte Freigabe/);
 assert.match(roleSql, /Eine deaktivierte Zuordnung wird nur mit derselben Rolle wieder freigegeben/);
 assert.match(roleSql, /Geschaeftsfuehrungsrechte werden hier nicht veraendert/);
 assert.match(invitationSql, /r\.facility_id,''employee''/);
 assert.match(invitationSql, /claim_staff_invitations entspricht nicht der geprüften Fassung und wurde nicht ersetzt/);
 assert.doesNotMatch(invitationSql, /UPDATE public\.memberships SET role/);
 assert.match(controlSql, /DELETE FROM public\.memberships/);
 assert.match(controlSql, /r\.facility_id,''employee''/);
 assert.match(controlSql, /Keine Installation, solange eine Prüfung nicht bereit ist/);
});

test('Mitarbeiterverwaltung, Einladungen und Techniker behalten ihre Grenzen', () => {
 const facility = {id: 'fac-a', organization_id: 'org-a'};
 const memberships = [
  {user_id: 'manager', organization_id: 'org-a', facility_id: 'fac-a', role: 'facility_manager'},
  {user_id: 'admin', organization_id: 'org-a', facility_id: null, role: 'company_admin'},
  {user_id: 'lead', organization_id: 'org-a', facility_id: 'fac-a', role: 'facility_manager'},
  {user_id: 'worker', organization_id: 'org-a', facility_id: 'fac-a', role: 'employee'}
 ];
 assert.equal(productionManageCall({
  caller: 'manager', target: 'lead', memberships, facility, role: 'employee', remove: false
 }).error, 'Betriebsleitung darf nur Mitarbeiterzuordnungen bearbeiten');
 assert.equal(productionManageCall({
  caller: 'manager', target: 'worker', memberships, facility, role: 'facility_manager', remove: false
 }).error, 'Nur Geschaeftsfuehrung darf Betriebsleitungen ernennen');
 assert.equal(productionManageCall({
  caller: 'manager', target: 'admin', memberships, facility, role: 'employee', remove: true
 }).error, 'Geschaeftsfuehrungsrechte werden hier nicht veraendert');
 assert.equal(productionManageCall({
  caller: 'admin', target: 'worker', memberships, facility, role: 'employee', remove: true
 }).deleted, true);
 assert.equal(productionManageCall({
  caller: 'stranger', target: 'worker', memberships, facility, role: 'employee', remove: false
 }).error, 'Keine Verwaltungsberechtigung fuer diesen Betrieb');

 state.myMemberships = [
  {organization_id: 'org-a', facility_id: 'fac-a', role: 'technician', is_active: true}
 ];
 assert.equal(isManager(facility), false);
 assert.equal(mayAppointManager('org-a', state.myMemberships), false);
 assert.equal(mayAppointManager('org-a', [
  {organization_id: 'org-a', facility_id: null, role: 'company_admin', is_active: true}
 ]), true);
});
