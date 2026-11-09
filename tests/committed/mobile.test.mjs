import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {agendaCounts, captureActions, greeting, homeLines, workAgenda} from '../../js/mobile.js';

const now = '2026-11-09T12:00:00.000Z';
const facility = {id: 'fac-a', organization_id: 'org-a'};
const second = {id: 'fac-b', organization_id: 'org-a'};
const employee = {userId: 'employee-1', memberships: [{organization_id: 'org-a', facility_id: 'fac-a', role: 'employee', is_active: true}]};
const manager = {userId: 'manager-1', memberships: [{organization_id: 'org-a', facility_id: 'fac-a', role: 'facility_manager', is_active: true}]};

function bundle() {
 return {
  runs: [
   {id: 'late', facilityId: 'fac-a', organizationId: 'org-a', name: 'Frühkontrolle', status: 'open', dueAt: '2026-11-08T08:00:00.000Z', assignedTo: 'employee-1'},
   {id: 'today', facilityId: 'fac-a', organizationId: 'org-a', name: 'Spätkontrolle', status: 'open', dueAt: '2026-11-09T18:00:00.000Z', assignedTo: null},
   {id: 'soon', facilityId: 'fac-a', organizationId: 'org-a', name: 'Wochenrunde', status: 'open', dueAt: '2026-11-12T12:00:00.000Z', assignedTo: 'other-1'},
   {id: 'far', facilityId: 'fac-a', organizationId: 'org-a', name: 'Später', status: 'open', dueAt: '2026-12-20T12:00:00.000Z'},
   {id: 'done', facilityId: 'fac-a', organizationId: 'org-a', name: 'Erledigt', status: 'completed', dueAt: '2026-11-08T08:00:00.000Z', assignedTo: 'employee-1'},
   {id: 'other', facilityId: 'fac-b', organizationId: 'org-a', name: 'Strand', status: 'open', dueAt: '2026-11-08T08:00:00.000Z', assignedTo: 'employee-1'}
  ],
  assets: [
   {id: 'pump', facilityId: 'fac-a', organizationId: 'org-a', name: 'Pumpe', intervalUnit: 'month', intervalCount: 1, anchorAt: '2026-01-31T00:00:00.000Z', logs: [], responsibleUserId: null},
   {id: 'filter', facilityId: 'fac-a', organizationId: 'org-a', name: 'Filter', intervalUnit: 'day', intervalCount: 4, anchorAt: '2026-11-08T12:00:00.000Z', logs: [], responsibleUserId: 'employee-1'}
  ],
  temperaturePoints: [
   {id: 'pool', facilityId: 'fac-a', organizationId: 'org-a', name: 'Becken', active: true},
   {id: 'outdoor', facilityId: 'fac-b', organizationId: 'org-a', name: 'Außenbecken', active: true}
  ],
  temperatureReadings: []
 };
}

test('Die Begrüßung folgt der Berliner Uhrzeit', () => {
 assert.equal(greeting(new Date('2026-11-09T07:30:00.000Z')), 'Guten Morgen');
 assert.equal(greeting(new Date('2026-11-09T12:00:00.000Z')), 'Guten Tag');
 assert.equal(greeting(new Date('2026-11-09T19:30:00.000Z')), 'Guten Abend');
 assert.equal(greeting(new Date('2026-11-09T22:30:00.000Z')), 'Gute Nacht');
});

test('Aufgaben bleiben im Betrieb und unterscheiden Person und Dringlichkeit', () => {
 const items = workAgenda(bundle(), {facilityIds: ['fac-a', 'fac-b'], actor: employee, now});
 assert.equal(items.some(item => item.facilityId === 'fac-b'), false);
 assert.equal(items.some(item => item.title === 'Erledigt' || item.title === 'Später'), false);
 const late = items.find(item => item.id === 'inspection:late');
 assert.equal(late.bucket, 'overdue');
 assert.equal(late.personal, true);
 assert.equal(late.scope, 'Dir zugewiesen');
 const today = items.find(item => item.id === 'inspection:today');
 assert.equal(today.bucket, 'today');
 assert.equal(today.personal, false);
 assert.equal(today.scope, 'Für den Betrieb');
 const soon = items.find(item => item.id === 'inspection:soon');
 assert.equal(soon.bucket, 'upcoming');
 assert.equal(soon.forYou, false);
 assert.equal(soon.scope, 'Einer anderen Person zugewiesen');
 const temperature = items.find(item => item.kind === 'temperature');
 assert.equal(temperature.bucket, 'today');
 assert.equal(temperature.personal, false);
 assert.equal(temperature.title, 'Becken');
 const pump = items.find(item => item.id === 'maintenance:pump');
 assert.equal(pump.bucket, 'overdue');
 assert.equal(pump.scope, 'Für den Betrieb');
 const filter = items.find(item => item.id === 'maintenance:filter');
 assert.equal(filter.bucket, 'upcoming');
 assert.equal(filter.personal, true);
 const order = items.map(item => item.bucket);
 assert.deepEqual(order, [...order].sort((left, right) => ({overdue: 0, today: 1, upcoming: 2}[left] - {overdue: 0, today: 1, upcoming: 2}[right])));
 const managerItems = workAgenda(bundle(), {facilityIds: ['fac-b'], actor: manager, now});
 assert.equal(managerItems.length, 0);
});

test('Die Startseite zählt nur eigene und betriebliche Aufgaben', () => {
 const items = workAgenda(bundle(), {facilityIds: ['fac-a'], actor: employee, now});
 const installed = homeLines(agendaCounts(items, 3, true));
 assert.deepEqual(installed, [
  '2 offene Kontrollgänge',
  '1 Temperaturkontrolle ausstehend',
  '1 Wartung fällig',
  '3 neue Hinweise'
 ]);
 assert.match(homeLines(agendaCounts(items, 0, false))[1], /noch nicht in der Datenbank installiert/);
 assert.deepEqual(captureActions.map(action => action.id), ['defect', 'temperature', 'reading', 'daily-report', 'procurement']);
});

test('Die PWA ersetzt einen alten Cache und speichert keine fremden Antworten', () => {
 const source = readFileSync(new URL('../../service-worker.js', import.meta.url), 'utf8');
 const manifest = readFileSync(new URL('../../manifest.webmanifest', import.meta.url), 'utf8');
 assert.match(source, /SHELL_CACHE = 'tageswerk-shell-3\.2'/);
 assert.match(source, /caches\.delete/);
 assert.match(source, /tageswerk-updated/);
 assert.match(source, /request\.method !== 'GET'/);
 assert.match(source, /url\.origin !== self\.location\.origin/);
 assert.match(source, /skipWaiting/);
 assert.match(manifest, /"display": "standalone"/);
 assert.match(manifest, /"start_url": "\.\/"/);
});
