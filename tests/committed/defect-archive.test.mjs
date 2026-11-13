import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {archiveConfirmation, closedInFacility, completionText, defectSection, matchesArchiveQuery, sectionCounts, sortByCompletion} from '../../js/defects.js';
import {isManager} from '../../js/permissions.js';
import {state} from '../../js/state.js';

const organization = 'org-a';
const facilityA = {id: 'fac-a', organization_id: organization, name: 'Prignitzer'};
const facilityB = {id: 'fac-b', organization_id: organization, name: 'Friedensteich'};
const foreign = {id: 'fac-c', organization_id: 'org-b', name: 'Fremd'};

function membership(role, facilityId, organizationId = organization) {
 return {user_id: 'user-1', role, facility_id: facilityId, organization_id: organizationId, is_active: true};
}

function withMemberships(memberships, run) {
 const previous = state.myMemberships;
 state.myMemberships = memberships;
 try {
  return run();
 } finally {
  state.myMemberships = previous;
 }
}

test('Offen, abgeschlossen und Archiv bleiben getrennte Bereiche', () => {
 const defects = [
  {id: '1', status: 'open'},
  {id: '2', status: 'in_progress'},
  {id: '3', status: 'pending_review'},
  {id: '4', status: 'resolved'},
  {id: '5', status: 'resolved', archived_at: '2026-11-01T10:00:00Z'}
 ];
 assert.equal(defectSection(defects[0]), 'open');
 assert.equal(defectSection(defects[1]), 'open');
 assert.equal(defectSection(defects[2]), 'open');
 assert.equal(defectSection(defects[3]), 'done');
 assert.equal(defectSection(defects[4]), 'archive');
 assert.deepEqual(sectionCounts(defects), {open: 3, done: 1, archive: 1});
 assert.equal(defectSection({id: 'old', status: 'resolved', archived_at: null}), 'done');
});

test('Die Archivsuche trifft Titel und Beschreibung und sortiert nach Abschluss', () => {
 const archive = [
  {id: 'early', title: 'Pumpe tropft', description: 'Technikraum', resolved_at: '2026-10-01T08:00:00Z', created_at: '2026-09-01T08:00:00Z'},
  {id: 'late', title: 'Filter', description: 'Die Pumpe wurde geprüft', resolved_at: '2026-11-02T08:00:00Z', created_at: '2026-08-01T08:00:00Z'},
  {id: 'legacy', title: 'Leiter', description: 'alt', created_at: '2026-11-03T08:00:00Z'}
 ];
 assert.deepEqual(archive.filter(defect => matchesArchiveQuery(defect, ' pumpe ')).map(defect => defect.id), ['early', 'late']);
 assert.deepEqual(sortByCompletion(archive).map(defect => defect.id), ['legacy', 'late', 'early']);
 assert.match(completionText(archive[0]), /^Abgeschlossen am /);
 assert.match(completionText(archive[2]), /^Erfasst am /);
});

test('Die Sammelarchivierung bleibt beim ausgewählten Betrieb', () => {
 const defects = [
  {id: 'a', facility_id: 'fac-a', status: 'resolved'},
  {id: 'b', facility_id: 'fac-a', status: 'resolved', archived_at: '2026-11-01T10:00:00Z'},
  {id: 'c', facility_id: 'fac-a', status: 'open'},
  {id: 'd', facility_id: 'fac-b', status: 'resolved'}
 ];
 assert.deepEqual(closedInFacility(defects, 'fac-a').map(defect => defect.id), ['a']);
 assert.equal(closedInFacility(defects, 'fac-b').length, 1);
 assert.equal(archiveConfirmation(2, 'Prignitzer'), 'Alle 2 abgeschlossene Mängel von Prignitzer archivieren?');
 assert.equal(archiveConfirmation(1, 'Friedensteich'), 'Alle 1 abgeschlossenen Mangel von Friedensteich archivieren?');
});

test('Nur Betriebsleitung und Geschäftsführung archivieren, und nur im eigenen Betrieb', () => {
 const cases = [
  [membership('employee', 'fac-a'), facilityA, false],
  [membership('technician', 'fac-a'), facilityA, false],
  [membership('facility_manager', 'fac-a'), facilityA, true],
  [membership('facility_manager', 'fac-a'), facilityB, false],
  [membership('facility_manager', 'fac-b'), facilityA, false],
  [membership('company_admin', null), facilityA, true],
  [membership('company_admin', null), facilityB, true],
  [membership('company_admin', 'fac-a'), facilityA, false],
  [membership('company_admin', null, 'org-b'), foreign, true],
  [membership('company_admin', null), foreign, false]
 ];
 for (const [member, facility, allowed] of cases) {
  assert.equal(withMemberships([member], () => isManager(facility)), allowed, member.role + ' ' + facility.id);
 }
});

test('Die Migration schützt das Archiv und lässt die bisherige Bearbeitung stehen', () => {
 const sql = readFileSync(new URL('../../tageswerk_3_5_1_defect_archive.sql', import.meta.url), 'utf8');
 const check = readFileSync(new URL('../../tageswerk_3_5_1_defect_archive_pruefung.sql', import.meta.url), 'utf8');
 const app = readFileSync(new URL('../../js/app.js', import.meta.url), 'utf8');
 const runner = readFileSync(new URL('../integration/run.mjs', import.meta.url), 'utf8');
 const beforeFunctions = sql.slice(0, sql.indexOf('CREATE OR REPLACE FUNCTION'));
 assert.equal(beforeFunctions.includes('UPDATE public.defects'), false);
 assert.equal(sql.includes('DELETE FROM public.defects'), false);
 assert.equal(sql.includes('employee_update_assigned_defect'), false);
 assert.match(sql, /ADD COLUMN IF NOT EXISTS archived_at timestamptz/);
 assert.match(sql, /ADD COLUMN IF NOT EXISTS archived_by uuid/);
 assert.match(sql, /membership\.role = 'company_admin' AND membership\.facility_id IS NULL/);
 assert.match(sql, /membership\.role = 'facility_manager' AND membership\.facility_id = p_facility_id/);
 assert.match(sql, /defect\.facility_id = p_facility_id/);
 assert.match(sql, /Archivierte Mängel können nicht verändert werden/);
 assert.match(sql, /Archivierte Mängel können nicht gelöscht werden/);
 assert.match(sql, /Archivierung ist nur über die vorgesehene Funktion möglich/);
 assert.match(sql, /Aus Archiv zurückgeholt/);
 assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.tageswerk_defect_archive_guard\(\) TO authenticated/);
 assert.match(sql, /REVOKE ALL ON FUNCTION public\.tageswerk_defect_archive_guard\(\) FROM PUBLIC, anon;/);
 assert.equal(sql.includes('tageswerk_defect_archive_guard() FROM PUBLIC, anon, authenticated'), false);
 assert.match(sql, /Der Abschlusszeitpunkt kann nicht direkt geändert werden/);
 assert.match(sql, /NEW\.change_note IS DISTINCT FROM OLD\.change_note/);
 assert.match(sql, /BEFORE INSERT OR UPDATE OR DELETE/);
 assert.equal(sql.includes('UPDATE public.defects SET resolved_at'), false);
 assert.doesNotMatch(sql, /UPDATE public\.water_checks|UPDATE public\.defect_events SET/);
 assert.match(check, /SELECT pruefung, status, details/);
 assert.doesNotMatch(check, /^\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|GRANT|REVOKE|TRUNCATE)\b/im);
 assert.doesNotMatch(check, /SELECT\s+public\.tageswerk_archive_defect/i);
 assert.doesNotMatch(check, /SELECT\s+public\.tageswerk_archive_closed_defects/i);
 assert.doesNotMatch(check, /SELECT\s+public\.tageswerk_restore_archived_defect/i);
 assert.equal(runner.includes('tageswerk_3_5_1_defect_archive.sql'), false);
 assert.match(app, /employee_update_assigned_defect/);
 assert.match(app, /update\(\{status:statusSelect\.value,assigned_to:assign\.value\|\|null,change_note:note\.value\.trim\(\)\|\|null\}\)/);
 assert.match(app, /Gesehen & archivieren/);
 assert.match(app, /Alle abgeschlossenen Mängel archivieren/);
 assert.match(app, /Aus Archiv zurückholen/);
 assert.equal(app.includes('archived_at:'), false);
 assert.match(check, /has_function_privilege\('authenticated', 'public\.tageswerk_defect_archive_guard\(\)', 'EXECUTE'\)/);
 assert.match(check, /INSERT INTO public\.defect_events/);
 assert.match(check, /Der Abschlusszeitpunkt kann nicht direkt geändert werden/);
 assert.match(check, /defect\.status = ''resolved''/);
 assert.match(check, /NOT has_column_privilege\('authenticated', 'public\.defects', 'archived_at', 'UPDATE'\)/);
 assert.match(check, /Die Wiederherstellung verändert keine Arbeitsvermerke, Fristen oder den Status/);
 assert.equal(check.includes('Die Wiederherstellung verändert keine gespeicherten Angaben.'), false);
 assert.match(check, /regexp_replace\(pg_get_functiondef\(employee\.oid\), '\[\[:space:\]\]\+', ' ', 'g'\)/);
 assert.match(check, /UPDATE public\.defects SET status = p_status, change_note = btrim\(p_note\) WHERE id = p_defect_id/);
 assert.match(check, /NOT has_column_privilege\('service_role', 'public\.defects', 'archived_at', 'UPDATE'\)/);
 assert.match(check, /NOT has_column_privilege\('service_role', 'public\.defects', 'status', 'UPDATE'\)/);
 assert.equal(check.includes('SET status=p_status, change_note='), false);
 assert.match(sql, /ALTER TABLE tageswerk_private\.defect_archive_permit OWNER TO/);
 assert.match(sql, /DELETE FROM tageswerk_private\.defect_archive_permit/);
 assert.match(sql, /has_column_privilege\('authenticated', 'public\.defects', cols\.column_name, 'UPDATE'\)/);
 assert.match(check, /tageswerk_private\.defect_archive_permit/);
 assert.match(check, /permit\.relowner = defects\.relowner/);
 assert.match(check, /Diese Abfrage ruft die Archivfunktionen nicht auf/);
 assert.match(sql, /INSERT INTO public\.defect_events \(defect_id, organization_id, facility_id, action, note, actor_id\)/);
 assert.match(sql, /marked\.organization_id, marked\.facility_id/);
 assert.match(sql, /NEW\.status IS DISTINCT FROM OLD\.status/);
 assert.match(sql, /NEW\.resolution_due_at IS DISTINCT FROM OLD\.resolution_due_at/);
 assert.match(sql, /'defect_events', 'organization_id'/);
 assert.match(sql, /'defect_events', 'facility_id'/);
 assert.equal(sql.includes('CREATE OR REPLACE FUNCTION private.audit_defect_change'), false);
 assert.equal(sql.includes('CREATE OR REPLACE FUNCTION private.require_defect_review_note'), false);
 assert.equal(sql.includes('DROP TRIGGER IF EXISTS audit_defect_change'), false);
 assert.equal(sql.includes('DROP TRIGGER IF EXISTS require_defect_review_note'), false);
 assert.doesNotMatch(check, /pg_get_functiondef\([^)]*audit_defect_change/);
 assert.doesNotMatch(check, /pg_get_functiondef\([^)]*require_defect_review_note/);
 assert.match(check, /Diese Abfrage liest den Funktionstext der beiden vorhandenen Trigger nicht/);
 assert.equal(sql.includes('set_config'), false);
 assert.equal(sql.includes('current_setting'), false);
 assert.equal(sql.includes('tageswerk.defect_archive'), false);
 assert.equal(sql.includes('DROP POLICY'), false);
 assert.equal(sql.includes('CREATE POLICY'), false);
});

function archiveChangeAllowed(attempt) {
 return attempt.permitActor === attempt.actor && attempt.permitOperation === (attempt.archived ? 'restore' : 'archive');
}

test('Eine direkt gesetzte Archiv-Einstellung ermöglicht keine Archivänderung', () => {
 const sql = readFileSync(new URL('../../tageswerk_3_5_1_defect_archive.sql', import.meta.url), 'utf8');
 const guard = sql.slice(sql.indexOf('FUNCTION public.tageswerk_defect_archive_guard'), sql.indexOf('$guard$;'));
 assert.equal(guard.includes('current_setting'), false);
 assert.equal(guard.includes('set_config'), false);
 assert.equal(guard.includes('tageswerk.defect_archive'), false);
 assert.match(guard, /tageswerk_private\.defect_archive_permit/);
 assert.match(guard, /permit\.actor_id = auth\.uid\(\)/);
 assert.equal(archiveChangeAllowed({guc: 'archive', permitActor: null, actor: 'manager', permitOperation: null, archived: false}), false);
 assert.equal(archiveChangeAllowed({guc: 'restore', permitActor: null, actor: 'manager', permitOperation: null, archived: true}), false);
 assert.equal(archiveChangeAllowed({guc: 'archive', permitActor: 'fremd', actor: 'manager', permitOperation: 'archive', archived: false}), false);
 assert.equal(archiveChangeAllowed({guc: 'restore', permitActor: 'manager', actor: 'manager', permitOperation: 'archive', archived: true}), false);
 assert.equal(archiveChangeAllowed({guc: null, permitActor: 'manager', actor: 'manager', permitOperation: 'archive', archived: false}), true);
 assert.equal(archiveChangeAllowed({guc: null, permitActor: 'manager', actor: 'manager', permitOperation: 'restore', archived: true}), true);
});

function resolvedAtAfter(previous, next) {
 if (next.status === 'resolved' && previous.status !== 'resolved') return 'server-now';
 if (next.resolved_at !== previous.resolved_at) throw new Error('zeitpunkt');
 return previous.resolved_at;
}

test('Ein erneuter Abschluss setzt den Zeitpunkt neu, eine normale Änderung nicht', () => {
 const closed = {status: 'resolved', resolved_at: 't1'};
 assert.equal(resolvedAtAfter(closed, {status: 'resolved', resolved_at: 't1'}), 't1');
 assert.throws(() => resolvedAtAfter(closed, {status: 'resolved', resolved_at: 't2'}));
 const reopened = {status: 'in_progress', resolved_at: resolvedAtAfter(closed, {status: 'in_progress', resolved_at: 't1'})};
 assert.equal(reopened.resolved_at, 't1');
 assert.equal(resolvedAtAfter(reopened, {status: 'resolved', resolved_at: 'gefälscht'}), 'server-now');
});

function archiveEvent(defect, actorId) {
 return {
  defect_id: defect.id,
  organization_id: defect.organization_id,
  facility_id: defect.facility_id,
  action: 'Gesehen und archiviert',
  note: 'Gesehen und archiviert.',
  actor_id: actorId
 };
}

function restoreEvent(defect, actorId) {
 return {
  defect_id: defect.id,
  organization_id: defect.organization_id,
  facility_id: defect.facility_id,
  action: 'Aus Archiv zurückgeholt',
  note: 'Aus Archiv zurückgeholt.',
  actor_id: actorId
 };
}

function applyStoredChange(previous, next, flag) {
 if (previous.archived_at) {
  if (flag !== 'restore' || next.archived_at || next.archived_by) throw new Error('geschützt');
  if (next.change_note !== previous.change_note || next.status !== previous.status || next.resolution_due_at !== previous.resolution_due_at || next.resolved_at !== previous.resolved_at || next.title !== previous.title) throw new Error('vermerk');
  return {...previous, archived_at: null, archived_by: null};
 }
 if ((next.archived_at || next.archived_by) && flag !== 'archive') throw new Error('nur funktion');
 if (flag === 'archive') {
  if (previous.status !== 'resolved' || next.status !== 'resolved' || next.change_note !== previous.change_note || next.resolution_due_at !== previous.resolution_due_at || next.resolved_at !== previous.resolved_at) throw new Error('archiv');
  return {...previous, archived_at: 'server', archived_by: 'leitung'};
 }
 if (next.status === 'resolved' && previous.status !== 'resolved') return {...next, resolved_at: 'server'};
 if (next.resolved_at !== previous.resolved_at) throw new Error('zeitpunkt');
 return {...previous, ...next, resolved_at: previous.resolved_at};
}

test('Archivschutz, Verlauf und Abschlusszeitpunkt folgen den Datenbankregeln', () => {
 const historical = {status: 'resolved', resolved_at: null, change_note: 'Pumpe geprüft', resolution_due_at: '2026-11-20T08:00:00.000Z', title: 'Pumpe', archived_at: null, archived_by: null, organization_id: 'org-a', facility_id: 'fac-a', id: 'mangel-1'};
 const noted = applyStoredChange(historical, {...historical, change_note: 'Pumpe geprüft', assigned_to: 'person'}, null);
 assert.equal(noted.resolved_at, null);
 assert.equal(noted.change_note, 'Pumpe geprüft');
 const closed = applyStoredChange({...historical, status: 'in_progress', change_note: null}, {...historical, status: 'resolved', resolved_at: 'gefälscht', change_note: 'erledigt'}, null);
 assert.equal(closed.resolved_at, 'server');
 assert.throws(() => applyStoredChange(historical, {...historical, resolved_at: 'nachgetragen'}, null));
 const archived = applyStoredChange(historical, historical, 'archive');
 assert.equal(archived.change_note, 'Pumpe geprüft');
 assert.equal(archived.resolution_due_at, '2026-11-20T08:00:00.000Z');
 assert.equal(archived.status, 'resolved');
 assert.equal(archived.resolved_at, null);
 assert.deepEqual(archiveEvent(historical, 'user-1'), {
  defect_id: 'mangel-1',
  organization_id: 'org-a',
  facility_id: 'fac-a',
  action: 'Gesehen und archiviert',
  note: 'Gesehen und archiviert.',
  actor_id: 'user-1'
 });
 assert.throws(() => applyStoredChange(archived, {...archived, title: 'geändert'}, null));
 assert.throws(() => applyStoredChange(archived, {...archived, archived_at: null, archived_by: null}, null));
 const restored = applyStoredChange(archived, {...archived, archived_at: null, archived_by: null}, 'restore');
 assert.equal(restored.change_note, 'Pumpe geprüft');
 assert.equal(restored.status, 'resolved');
 assert.equal(restored.resolution_due_at, '2026-11-20T08:00:00.000Z');
 assert.deepEqual(restoreEvent(historical, 'user-1'), {
  defect_id: 'mangel-1',
  organization_id: 'org-a',
  facility_id: 'fac-a',
  action: 'Aus Archiv zurückgeholt',
  note: 'Aus Archiv zurückgeholt.',
  actor_id: 'user-1'
 });
 assert.throws(() => applyStoredChange(historical, {...historical, resolution_due_at: '2026-12-01T08:00:00.000Z', archived_at: 'server', archived_by: 'leitung'}, 'archive'));
 const defects = [
  {id: 'a', facility_id: 'fac-a', organization_id: 'org-a', status: 'resolved'},
  {id: 'b', facility_id: 'fac-a', organization_id: 'org-a', status: 'open'},
  {id: 'c', facility_id: 'fac-b', organization_id: 'org-a', status: 'resolved'},
  {id: 'd', facility_id: 'fac-a', organization_id: 'org-b', status: 'resolved'}
 ];
 assert.deepEqual(defects.filter(defect => defect.facility_id === 'fac-a' && defect.organization_id === 'org-a' && defect.status === 'resolved' && !defect.archived_at).map(defect => defect.id), ['a']);
});

test('Die Bestandsaufnahme liest die Mängelstruktur und schreibt nichts', () => {
 const sql = readFileSync(new URL('../../tageswerk_3_5_1_defect_archive_bestandsaufnahme.sql', import.meta.url), 'utf8');
 const runner = readFileSync(new URL('../integration/run.mjs', import.meta.url), 'utf8');
 assert.match(sql, /information_schema\.columns/);
 assert.match(sql, /pg_policy/);
 assert.match(sql, /employee_update_assigned_defect/);
 assert.match(sql, /has_column_privilege/);
 assert.doesNotMatch(sql, /^\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|GRANT|REVOKE|TRUNCATE|COMMENT|DO)\b/im);
 assert.equal(sql.includes('tageswerk_archive_defect'), false);
 assert.equal(runner.includes('tageswerk_3_5_1_defect_archive_bestandsaufnahme.sql'), false);
 const diagnosis = readFileSync(new URL('../../tageswerk_3_5_1_defect_archive_pruefung_diagnose.sql', import.meta.url), 'utf8');
 assert.match(diagnosis, /Alter Meldungstext der Wiederherstellung/);
 assert.match(diagnosis, /Kompakte UPDATE-Zeile ohne Leerzeichen/);
 assert.doesNotMatch(diagnosis, /^\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|GRANT|REVOKE|TRUNCATE|COMMENT|DO)\b/im);
 assert.equal(runner.includes('tageswerk_3_5_1_defect_archive_pruefung_diagnose.sql'), false);
});
