import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {
 DEFECT_FACILITY_ALL,
 defectFacilityOptions,
 filterDefectsByFacility,
 resolveDefectFacilityFilter,
 scopeDefects,
 sectionCounts
} from '../../js/defects.js';
import {isManager, membershipCoversFacility} from '../../js/permissions.js';
import {state} from '../../js/state.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const orgA = 'org-a';
const orgB = 'org-b';
const facA = {id: 'fac-a', organization_id: orgA, name: 'Strandbad Friedensteich'};
const facB = {id: 'fac-b', organization_id: orgA, name: 'Prignitzer Badewelt'};
const facForeign = {id: 'fac-c', organization_id: orgB, name: 'Fremdbad'};

function defect(partial) {
 return {
  id: partial.id,
  title: partial.title || partial.id,
  status: partial.status || 'open',
  priority: partial.priority || 'normal',
  assigned_to: partial.assigned_to ?? null,
  archived_at: partial.archived_at ?? null,
  created_at: partial.created_at || '2026-11-01T10:00:00.000Z',
  facility_id: partial.facility_id,
  organization_id: partial.organization_id || orgA
 };
}

const catalog = [
 defect({id: 'a-open', facility_id: facA.id, status: 'open'}),
 defect({id: 'b-progress', facility_id: facB.id, status: 'in_progress', assigned_to: 'user-1'}),
 defect({id: 'b-done', facility_id: facB.id, status: 'resolved'}),
 defect({id: 'b-arch', facility_id: facB.id, status: 'resolved', archived_at: '2026-11-02T10:00:00.000Z'}),
 defect({id: 'foreign', facility_id: facForeign.id, status: 'open', organization_id: orgB})
];

test('Betriebsoptionen sortieren alphabetisch und behalten Alle meine Betriebe', () => {
 assert.deepEqual(defectFacilityOptions([facA, facB]).map(item => item.name), [
  'Prignitzer Badewelt',
  'Strandbad Friedensteich'
 ]);
 assert.equal(DEFECT_FACILITY_ALL, 'all');
 assert.equal(resolveDefectFacilityFilter('fac-x', [facA, facB]), DEFECT_FACILITY_ALL);
 assert.equal(resolveDefectFacilityFilter(facB.id, [facA, facB]), facB.id);
});

test('Alle meine Betriebe und Einzelbetrieb filtern nur berechtigte Mängel', () => {
 const allowed = catalog.filter(item => item.facility_id === facA.id || item.facility_id === facB.id);
 assert.deepEqual(filterDefectsByFacility(allowed, DEFECT_FACILITY_ALL).map(item => item.id), ['a-open', 'b-progress', 'b-done', 'b-arch']);
 assert.deepEqual(filterDefectsByFacility(allowed, facB.id).map(item => item.id), ['b-progress', 'b-done', 'b-arch']);
 assert.deepEqual(filterDefectsByFacility(allowed, facA.id).map(item => item.id), ['a-open']);
 assert.equal(filterDefectsByFacility(allowed, facForeign.id).length, 0);
});

test('Nicht berechtigte Betriebe und Unternehmensgrenzen bleiben ausgeschlossen', () => {
 const employee = {user_id: 'user-1', role: 'employee', facility_id: facA.id, organization_id: orgA, is_active: true};
 assert.equal(membershipCoversFacility(facA, employee, true), true);
 assert.equal(membershipCoversFacility(facB, employee, true), false);
 assert.equal(membershipCoversFacility(facForeign, employee, true), false);
 const visible = catalog.filter(item => item.facility_id === facA.id);
 assert.deepEqual(visible.map(item => item.id), ['a-open']);
 assert.equal(visible.some(item => item.facility_id === facForeign.id), false);
});

test('Meine Aufgaben, Status und Archiv folgen dem Betriebsfilter', () => {
 const allowed = catalog.filter(item => item.facility_id === facA.id || item.facility_id === facB.id);
 assert.deepEqual(scopeDefects(allowed, {facilityFilter: DEFECT_FACILITY_ALL, mode: 'mine', userId: 'user-1'}).map(item => item.id), ['b-progress']);
 assert.deepEqual(scopeDefects(allowed, {facilityFilter: facA.id, mode: 'mine', userId: 'user-1'}).map(item => item.id), []);
 assert.deepEqual(scopeDefects(allowed, {facilityFilter: facB.id, mode: 'open', userId: 'user-1'}).map(item => item.id), ['b-progress']);
 assert.deepEqual(sectionCounts(filterDefectsByFacility(allowed, facB.id)), {open: 1, done: 1, archive: 1});
});

test('Mitarbeiter, Betriebsleitung und Geschäftsführung behalten ihre Sichtbarkeitsregeln', () => {
 const previous = state.myMemberships;
 try {
  state.myMemberships = [{user_id: 'user-1', role: 'employee', facility_id: facA.id, organization_id: orgA, is_active: true}];
  assert.equal(isManager(facA), false);
  state.myMemberships = [{user_id: 'user-1', role: 'facility_manager', facility_id: facB.id, organization_id: orgA, is_active: true}];
  assert.equal(isManager(facB), true);
  assert.equal(isManager(facA), false);
  state.myMemberships = [{user_id: 'user-1', role: 'company_admin', facility_id: null, organization_id: orgA, is_active: true}];
  assert.equal(isManager(facA), true);
  assert.equal(isManager(facB), true);
  assert.equal(isManager(facForeign), false);
 } finally {
  state.myMemberships = previous;
 }
});

test('Mangelbearbeitung bleibt am tatsächlichen Betrieb des Mangels', () => {
 const ui = readFileSync(path.join(root, 'js/defects-ui.js'), 'utf8');
 assert.match(ui, /find\(item=>item\.id===defect\.facility_id\)/);
 assert.match(ui, /isManager\(facility\)/);
 assert.match(ui, /member\.facility_id===facility\.id/);
 assert.doesNotMatch(ui, /el\('dashboard-facility'\)\.value.*updateDefectRow/);
 assert.match(ui, /state\.defectFacilityFilter/);
 assert.doesNotMatch(ui, /state\.facilityId/);
});

test('Neuer Mangel nutzt weiter defect-facility und nicht den Listenfilter', () => {
 const ui = readFileSync(path.join(root, 'js/defects-ui.js'), 'utf8');
 const app = readFileSync(path.join(root, 'js/app.js'), 'utf8');
 assert.match(ui, /el\('defect-facility'\)\.value/);
 assert.doesNotMatch(ui, /el\('defect-facility-filter'\)\.value.*insertDefectRow/);
 assert.match(app, /populateDefectFacilityFilter/);
 assert.match(app, /el\('defect-facility'\)/);
});

test('Berechtigungsentzug setzt ungültige Filter zurück und lädt seitenweise', () => {
 assert.equal(resolveDefectFacilityFilter(facB.id, [facA]), DEFECT_FACILITY_ALL);
 const store = readFileSync(path.join(root, 'js/defects-store.js'), 'utf8');
 assert.match(store, /PAGE_SIZE = 500/);
 assert.match(store, /\.range\(from, to\)/);
 assert.match(store, /from\('defects'\)/);
 assert.doesNotMatch(store, /service_role|sb_secret_/);
});

test('Mängel-UI und Store bleiben getrennt und Listener einmalig', () => {
 const ui = readFileSync(path.join(root, 'js/defects-ui.js'), 'utf8');
 const store = readFileSync(path.join(root, 'js/defects-store.js'), 'utf8');
 assert.doesNotMatch(store, /from '\.\/defects-ui\.js'|from "\.\/defects-ui\.js"/);
 assert.doesNotMatch(store, /from '\.\/dashboard\.js'|from "\.\/dashboard\.js"/);
 assert.doesNotMatch(store, /from '\.\/app\.js'|from "\.\/app\.js"/);
 assert.match(ui, /from '\.\/defects-store\.js'/);
 const counts = new Map();
 const pattern = /el\(['"]([^'"]+)['"]\)(?:\?)?\.addEventListener/g;
 let match;
 while ((match = pattern.exec(ui))) counts.set(match[1], (counts.get(match[1]) || 0) + 1);
 assert.equal(counts.get('defect-facility-filter'), 1);
 assert.equal(counts.get('defect-filter'), 1);
 assert.equal(counts.get('defect-form'), 1);
 assert.equal([...counts.values()].some(count => count > 1), false);
 assert.ok(readdirSync(path.join(root, 'js')).includes('defects-store.js'));
 const html = readFileSync(path.join(root, 'index.html'), 'utf8');
 assert.match(html, /id="defect-facility-filter"/);
 assert.match(html, /Alle meine Betriebe/);
});

test('Zustand hält defectFacilityFilter getrennt vom Dashboard-Betrieb', () => {
 const source = readFileSync(path.join(root, 'js/state.js'), 'utf8');
 assert.match(source, /defectFacilityFilter: 'all'/);
 assert.doesNotMatch(source, /facilityId:/);
 const dashboard = readFileSync(path.join(root, 'js/dashboard.js'), 'utf8');
 assert.doesNotMatch(dashboard, /defectFacilityFilter/);
 assert.match(dashboard, /dashboard-facility/);
});
