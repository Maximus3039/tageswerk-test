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
 assert.match(sql, /REVOKE UPDATE \(archived_at, archived_by\) ON public\.defects FROM PUBLIC, anon, authenticated/);
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
});
