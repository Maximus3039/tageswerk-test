import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
 DASHBOARD_DEFECT_LIMIT,
 activeDefects,
 dashboardMineDefects,
 dashboardRecentDefects,
 isActiveDefect,
 myActiveDefects,
 openStatuses,
 sortByPriorityThenAge
} from '../../js/defects.js';

const user = 'user-1';
const other = 'user-2';

function defect(partial) {
 return {
  id: partial.id,
  title: partial.title || partial.id,
  status: partial.status || 'open',
  priority: partial.priority || 'normal',
  assigned_to: partial.assigned_to ?? null,
  archived_at: partial.archived_at ?? null,
  created_at: partial.created_at || '2026-11-01T10:00:00.000Z',
  facility_id: partial.facility_id || 'fac-a'
 };
}

const sample = [
 defect({id: 'open-new', status: 'open', priority: 'low', created_at: '2026-11-10T08:00:00.000Z'}),
 defect({id: 'progress', status: 'in_progress', priority: 'high', created_at: '2026-11-08T08:00:00.000Z'}),
 defect({id: 'review', status: 'pending_review', priority: 'normal', created_at: '2026-11-09T08:00:00.000Z'}),
 defect({id: 'done', status: 'resolved', priority: 'critical', created_at: '2026-11-01T08:00:00.000Z'}),
 defect({id: 'archived', status: 'resolved', priority: 'critical', archived_at: '2026-11-05T08:00:00.000Z', created_at: '2026-10-01T08:00:00.000Z'}),
 defect({id: 'mine-open', status: 'open', priority: 'normal', assigned_to: user, created_at: '2026-11-07T08:00:00.000Z'}),
 defect({id: 'mine-done', status: 'resolved', priority: 'high', assigned_to: user, created_at: '2026-11-06T08:00:00.000Z'}),
 defect({id: 'mine-arch', status: 'resolved', priority: 'critical', assigned_to: user, archived_at: '2026-11-04T08:00:00.000Z', created_at: '2026-10-02T08:00:00.000Z'}),
 defect({id: 'theirs', status: 'in_progress', priority: 'critical', assigned_to: other, created_at: '2026-11-03T08:00:00.000Z'})
];

test('Aktive Statuswerte sind open, in_progress und pending_review', () => {
 assert.deepEqual(openStatuses(), ['open', 'in_progress', 'pending_review']);
 assert.equal(isActiveDefect(defect({status: 'open'})), true);
 assert.equal(isActiveDefect(defect({status: 'in_progress'})), true);
 assert.equal(isActiveDefect(defect({status: 'pending_review'})), true);
 assert.equal(isActiveDefect(defect({status: 'resolved'})), false);
 assert.equal(isActiveDefect(defect({status: 'open', archived_at: '2026-11-01T00:00:00.000Z'})), false);
});

test('Neue, in Bearbeitung und zur Prüfung bleiben sichtbar', () => {
 assert.deepEqual(activeDefects(sample).map(d => d.id).sort(), ['mine-open', 'open-new', 'progress', 'review', 'theirs']);
});

test('Abgeschlossene und archivierte Mängel bleiben unsichtbar', () => {
 const ids = activeDefects(sample).map(d => d.id);
 assert.equal(ids.includes('done'), false);
 assert.equal(ids.includes('archived'), false);
 assert.equal(ids.includes('mine-done'), false);
 assert.equal(ids.includes('mine-arch'), false);
});

test('Meine Aufgaben zeigen nur zugewiesene aktive Vorgänge', () => {
 assert.deepEqual(myActiveDefects(sample, user).map(d => d.id), ['mine-open']);
 assert.deepEqual(dashboardMineDefects(sample, user).map(d => d.id), ['mine-open']);
 assert.deepEqual(dashboardMineDefects(sample, other).map(d => d.id), ['theirs']);
 assert.deepEqual(dashboardMineDefects(sample, null), []);
});

test('Aktuelle Vorgänge sortieren nach Priorität und Alter', () => {
 assert.deepEqual(sortByPriorityThenAge(activeDefects(sample)).map(d => d.id), [
  'theirs',
  'progress',
  'mine-open',
  'review',
  'open-new'
 ]);
 assert.deepEqual(dashboardRecentDefects(sample).map(d => d.id), [
  'theirs',
  'progress',
  'mine-open',
  'review',
  'open-new'
 ]);
});

test('Das Dashboard begrenzt aktuelle Vorgänge auf höchstens zehn', () => {
 assert.equal(DASHBOARD_DEFECT_LIMIT, 10);
 const many = Array.from({length: 15}, (_, index) => defect({
  id: `d-${index}`,
  priority: 'normal',
  created_at: `2026-11-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`
 }));
 const recent = dashboardRecentDefects(many);
 assert.equal(recent.length, 10);
 assert.deepEqual(recent.map(d => d.id), Array.from({length: 10}, (_, index) => `d-${index}`));
});

test('Dashboard und Mängel-UI nutzen die gemeinsame Filterlogik', () => {
 const dashboard = readFileSync(new URL('../../js/dashboard.js', import.meta.url), 'utf8');
 const ui = readFileSync(new URL('../../js/defects-ui.js', import.meta.url), 'utf8');
 assert.match(dashboard, /dashboardRecentDefects/);
 assert.match(dashboard, /dashboardMineDefects/);
 assert.match(dashboard, /isActiveDefect/);
 assert.match(dashboard, /DASHBOARD_DEFECT_LIMIT/);
 assert.doesNotMatch(dashboard, /dash-recent.*sort\(\(a,b\)=>new Date\(b\.created_at\)/);
 assert.match(ui, /myActiveDefects/);
 assert.match(ui, /isActiveDefect\(defect\)/);
 const css = readFileSync(new URL('../../css/app.css', import.meta.url), 'utf8');
 assert.match(css, /\.dashboard-columns \.dash-list\{max-height:none;overflow:visible\}/);
});

test('Bestehende Berechtigungsgrenzen bleiben in der Mängel-Ladung erhalten', () => {
 const ui = readFileSync(new URL('../../js/defects-ui.js', import.meta.url), 'utf8');
 assert.match(ui, /allowedFacilities\.has\(defect\.facility_id\)/);
 assert.match(ui, /isManager\(facility\)/);
 assert.match(ui, /tageswerk_archive_closed_defects/);
 assert.match(ui, /tageswerk_archive_defect/);
 assert.match(ui, /tageswerk_restore_archived_defect/);
});
