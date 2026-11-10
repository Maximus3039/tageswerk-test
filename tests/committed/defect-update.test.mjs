import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {state} from '../../js/state.js';
import {isManager} from '../../js/permissions.js';

const organization = 'org-a';
const facility = {id: 'fac-a', organization_id: organization};
const otherFacility = {id: 'fac-b', organization_id: organization};
const foreignFacility = {id: 'fac-c', organization_id: 'org-b'};
const employeeId = 'employee-1';
const technicianId = 'technician-1';

const knownBody = `
CREATE OR REPLACE FUNCTION public.employee_update_assigned_defect(p_defect_id uuid, p_status text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d public.defects%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Anmeldung erforderlich'; END IF;
 IF p_status IS NULL OR p_status NOT IN ('in_progress','pending_review') THEN
  RAISE EXCEPTION 'Mitarbeiter koennen nur bearbeiten oder Erledigung melden';
 END IF;
 IF p_note IS NULL OR length(btrim(p_note)) < 3 OR length(p_note) > 2000 THEN
  RAISE EXCEPTION 'Arbeitsvermerk mit 3 bis 2000 Zeichen erforderlich';
 END IF;
 SELECT * INTO d FROM public.defects WHERE id=p_defect_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Mangel nicht gefunden'; END IF;
 IF d.assigned_to IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'Dieser Mangel ist dir nicht zugewiesen';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.memberships m
  WHERE m.user_id=auth.uid() AND m.is_active = true AND m.organization_id=d.organization_id
  AND (m.role='company_admin' OR m.facility_id=d.facility_id)
 ) THEN RAISE EXCEPTION 'Keine Betriebsberechtigung'; END IF;
 IF d.status IN ('resolved','pending_review') THEN
  RAISE EXCEPTION 'Vorgang ist bereits abgeschlossen oder wartet auf Freigabe';
 END IF;
 UPDATE public.defects SET status=p_status, change_note=btrim(p_note)
 WHERE id=p_defect_id;
END;
$function$;
`;

function defectFunctionStatus(body) {
 const text = body.replace(/\s+/g, ' ');
 const has = phrase => text.includes(phrase);
 const markers = has('SECURITY DEFINER')
  && has('Anmeldung erforderlich')
  && has('Mitarbeiter koennen nur bearbeiten oder Erledigung melden')
  && has('Arbeitsvermerk mit 3 bis 2000 Zeichen erforderlich')
  && has('Mangel nicht gefunden')
  && has('assigned_to IS DISTINCT FROM auth.uid()')
  && has('Dieser Mangel ist dir nicht zugewiesen')
  && has('Keine Betriebsberechtigung')
  && has('Vorgang ist bereits abgeschlossen oder wartet auf Freigabe')
  && has('FOR UPDATE')
  && (has('m.is_active = true') || has('m.is_active IS TRUE'))
  && (has('m.organization_id=d.organization_id') || has('m.organization_id = d.organization_id'))
  && (has('m.facility_id=d.facility_id') || has('m.facility_id = d.facility_id'))
  && (has("m.role='company_admin'") || has("m.role = 'company_admin'"))
  && (has("p_status NOT IN ('in_progress','pending_review')") || has("p_status NOT IN ('in_progress', 'pending_review')"))
  && (has("d.status IN ('resolved','pending_review')") || has("d.status IN ('resolved', 'pending_review')"))
  && has('UPDATE public.defects SET status=p_status, change_note=')
  && !has('SET assigned_to')
  && !has('SET facility_id')
  && !has('SET organization_id');
 if (!markers) return 'stoppen';
 const knownFacility = has("m.role='company_admin' OR m.facility_id=d.facility_id")
  || has("m.role = 'company_admin' OR m.facility_id = d.facility_id");
 if (!text.includes("= 'employee'") && !text.includes("<> 'employee'") && knownFacility) return 'bereit';
 if (text.includes('technician')
  && has('assigned_to IS DISTINCT FROM auth.uid()')
  && (has('m.facility_id=d.facility_id') || has('m.facility_id = d.facility_id'))) return 'bereit';
 if (text.includes("= 'employee'") || text.includes("<> 'employee'")) return 'bereit';
 return 'stoppen';
}

function assignedDefectUpdate({userId, memberships, defect, status, note}) {
 if (!userId) return {ok: false, error: 'Anmeldung erforderlich'};
 if (status !== 'in_progress' && status !== 'pending_review') {
  return {ok: false, error: 'Mitarbeiter koennen nur bearbeiten oder Erledigung melden'};
 }
 if (note == null || note.trim().length < 3 || note.length > 2000) {
  return {ok: false, error: 'Arbeitsvermerk mit 3 bis 2000 Zeichen erforderlich'};
 }
 if (!defect) return {ok: false, error: 'Mangel nicht gefunden'};
 if (defect.assigned_to !== userId) return {ok: false, error: 'Dieser Mangel ist dir nicht zugewiesen'};
 const allowed = (memberships || []).some(membership => membership.user_id === userId
  && membership.is_active === true
  && membership.organization_id === defect.organization_id
  && (membership.role === 'company_admin' || membership.facility_id === defect.facility_id));
 if (!allowed) return {ok: false, error: 'Keine Betriebsberechtigung'};
 if (defect.status === 'resolved' || defect.status === 'pending_review') {
  return {ok: false, error: 'Vorgang ist bereits abgeschlossen oder wartet auf Freigabe'};
 }
 return {
  ok: true,
  defect: {
   ...defect,
   status,
   change_note: note.trim()
  }
 };
}

function membership(userId, role, target = facility, active = true) {
 return {
  user_id: userId,
  organization_id: target.organization_id,
  facility_id: role === 'company_admin' ? null : target.id,
  role,
  is_active: active
 };
}

function openDefect(assignee, target = facility) {
 return {
  id: 'defect-1',
  organization_id: target.organization_id,
  facility_id: target.id,
  assigned_to: assignee,
  status: 'open'
 };
}

test('Die bekannte Mängelfunktion bleibt installierbar und unsichere Fassungen stoppen', () => {
 const sql = readFileSync(new URL('../../tageswerk_3_4_technician_role.sql', import.meta.url), 'utf8');
 const control = readFileSync(new URL('../integration/installationskontrolle.sql', import.meta.url), 'utf8');
 assert.equal(defectFunctionStatus(knownBody), 'bereit');
 assert.equal(defectFunctionStatus(knownBody.replace(/\n/g, '  ')), 'bereit');
 assert.equal(defectFunctionStatus(knownBody.replace('assigned_to IS DISTINCT FROM auth.uid()', 'assigned_to = auth.uid()')), 'stoppen');
 assert.equal(defectFunctionStatus(knownBody.replace('UPDATE public.defects SET status=p_status, change_note=btrim(p_note)', 'UPDATE public.defects SET status=p_status, assigned_to=auth.uid(), change_note=btrim(p_note)')), 'stoppen');
 assert.equal(defectFunctionStatus(knownBody.replace("m.role='company_admin' OR m.facility_id=d.facility_id", "m.role = 'employee'")), 'stoppen');
 assert.equal(defectFunctionStatus(`${knownBody} AND m.role = 'employee'`), 'bereit');
 assert.equal(defectFunctionStatus(knownBody.replace('Keine Betriebsberechtigung', 'technician ohne Betrieb')), 'stoppen');
 assert.match(sql, /Diese Fassung bleibt\r?\n-- unverändert/);
 assert.match(sql, /employee_update_assigned_defect entspricht nicht der geprüften Fassung und wurde nicht ersetzt/);
 assert.match(sql, /employee_update_assigned_defect erkennt Techniker nicht an einer erwarteten Stelle/);
 assert.match(sql, /replace\(updated, '= ''employee''', 'IN \(''employee'', ''technician''\)'\)/);
 assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.employee_update_assigned_defect/);
 assert.match(control, /employee_update_assigned_defect ist die geprüfte Fassung/);
 assert.match(control, /m\.role=''company_admin'' OR m\.facility_id=d\.facility_id/);
 assert.match(control, /THEN 'stoppen'/);
});

test('Mitarbeiter und Techniker bearbeiten nur den zugewiesenen Mangel ihres Betriebs', () => {
 const employee = membership(employeeId, 'employee');
 const technician = membership(technicianId, 'technician');
 const employeeResult = assignedDefectUpdate({
  userId: employeeId,
  memberships: [employee],
  defect: openDefect(employeeId),
  status: 'in_progress',
  note: 'Pumpe geprüft'
 });
 const technicianResult = assignedDefectUpdate({
  userId: technicianId,
  memberships: [technician],
  defect: openDefect(technicianId),
  status: 'pending_review',
  note: 'Filter gespült'
 });
 assert.equal(employeeResult.ok, true);
 assert.equal(employeeResult.defect.status, 'in_progress');
 assert.equal(employeeResult.defect.assigned_to, employeeId);
 assert.equal(employeeResult.defect.facility_id, facility.id);
 assert.equal(technicianResult.ok, true);
 assert.equal(technicianResult.defect.status, 'pending_review');
 assert.equal(technicianResult.defect.change_note, 'Filter gespült');

 state.myMemberships = [technician];
 assert.equal(isManager(facility), false);
 const app = readFileSync(new URL('../../js/app.js', import.meta.url), 'utf8');
 assert.match(app, /!isManager\(facility\) && defect\.assigned_to===state\.currentUser\?\.id/);
 assert.match(app, /rpc\('employee_update_assigned_defect'/);

 assert.equal(assignedDefectUpdate({
  userId: technicianId,
  memberships: [technician],
  defect: openDefect(null),
  status: 'in_progress',
  note: 'Nicht mein Mangel'
 }).ok, false);
 assert.equal(assignedDefectUpdate({
  userId: technicianId,
  memberships: [technician],
  defect: openDefect(employeeId),
  status: 'in_progress',
  note: 'Fremde Zuweisung'
 }).error, 'Dieser Mangel ist dir nicht zugewiesen');
 assert.equal(assignedDefectUpdate({
  userId: technicianId,
  memberships: [technician],
  defect: openDefect(technicianId, otherFacility),
  status: 'in_progress',
  note: 'Anderer Betrieb'
 }).error, 'Keine Betriebsberechtigung');
 assert.equal(assignedDefectUpdate({
  userId: employeeId,
  memberships: [membership(employeeId, 'employee', foreignFacility)],
  defect: openDefect(employeeId),
  status: 'in_progress',
  note: 'Fremde Organisation'
 }).error, 'Keine Betriebsberechtigung');
 assert.equal(assignedDefectUpdate({
  userId: technicianId,
  memberships: [{...technician, is_active: false}],
  defect: openDefect(technicianId),
  status: 'in_progress',
  note: 'Deaktiviert'
 }).error, 'Keine Betriebsberechtigung');
 assert.equal(assignedDefectUpdate({
  userId: technicianId,
  memberships: [technician],
  defect: {...openDefect(technicianId), status: 'pending_review'},
  status: 'in_progress',
  note: 'Schon gemeldet'
 }).error, 'Vorgang ist bereits abgeschlossen oder wartet auf Freigabe');
 assert.equal(assignedDefectUpdate({
  userId: employeeId,
  memberships: [employee],
  defect: {...openDefect(employeeId), status: 'resolved'},
  status: 'in_progress',
  note: 'Schon abgeschlossen'
 }).ok, false);
 assert.equal(assignedDefectUpdate({
  userId: employeeId,
  memberships: [employee],
  defect: openDefect(employeeId),
  status: 'resolved',
  note: 'Direkt abschließen'
 }).error, 'Mitarbeiter koennen nur bearbeiten oder Erledigung melden');
 assert.equal(assignedDefectUpdate({
  userId: null,
  memberships: [employee],
  defect: openDefect(employeeId),
  status: 'in_progress',
  note: 'Ohne Anmeldung'
 }).error, 'Anmeldung erforderlich');
 assert.equal(assignedDefectUpdate({
  userId: employeeId,
  memberships: [employee],
  defect: openDefect(employeeId),
  status: 'in_progress',
  note: 'ok'
 }).error, 'Arbeitsvermerk mit 3 bis 2000 Zeichen erforderlich');
});
