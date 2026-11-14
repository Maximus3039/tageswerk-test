import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shellFiles = ['app.js', 'dashboard.js', 'defects-ui.js', 'staff-ui.js'].map(name => ({
 name,
 source: readFileSync(path.join(root, 'js', name), 'utf8')
}));

function importsOf(source) {
 const found = [];
 const pattern = /from\s+['"]\.\/([^'"]+)['"]/g;
 let match;
 while ((match = pattern.exec(source))) found.push(match[1]);
 return found;
}

function listenerTargets(source) {
 const found = [];
 const pattern = /el\(['"]([^'"]+)['"]\)(?:\?)?\.addEventListener/g;
 let match;
 while ((match = pattern.exec(source))) found.push(match[1]);
 return found;
}

test('Shell-Module exportieren Orchestrierungs- und UI-Schnittstellen', () => {
 const dashboard = shellFiles.find(file => file.name === 'dashboard.js').source;
 const defects = shellFiles.find(file => file.name === 'defects-ui.js').source;
 const staff = shellFiles.find(file => file.name === 'staff-ui.js').source;
 assert.match(dashboard, /export function setDashboardActions/);
 assert.match(dashboard, /export function touchConsumptionFacility/);
 assert.match(dashboard, /export function populateDashboardFilters/);
 assert.match(dashboard, /export function renderDashboard/);
 assert.match(dashboard, /export function resetConsumptionPanel/);
 assert.match(defects, /export async function loadDefects/);
 assert.match(staff, /export function inviteFacilityOptions/);
 assert.match(staff, /export function staffFacilityOptions/);
 assert.match(staff, /export function setStaffActions/);
});

test('app.js orchestriert Auth, Navigation, Realtime und Betriebswechsel', () => {
 const app = shellFiles.find(file => file.name === 'app.js').source;
 assert.match(app, /async function update\(/);
 assert.match(app, /function navigate\(/);
 assert.match(app, /function startRealtime\(/);
 assert.match(app, /async function loadPermissions\(/);
 assert.match(app, /setStaffActions\(/);
 assert.match(app, /setDashboardActions\(/);
 assert.match(app, /dashboard-facility/);
 assert.doesNotMatch(app, /function renderStaff\(/);
 assert.doesNotMatch(app, /function defectCard\(/);
 assert.doesNotMatch(app, /function renderCriticalAlerts\(/);
});

test('Dashboard, Mängel und Mitarbeiter sind getrennt und ohne Zyklen verdrahtet', () => {
 const graph = Object.fromEntries(shellFiles.map(file => [file.name, importsOf(file.source).filter(name => ['app.js', 'dashboard.js', 'defects-ui.js', 'staff-ui.js'].includes(name))]));
 assert.deepEqual(graph['dashboard.js'], []);
 assert.deepEqual(graph['staff-ui.js'], []);
 assert.deepEqual(graph['defects-ui.js'], ['dashboard.js']);
 assert.ok(graph['app.js'].includes('dashboard.js'));
 assert.ok(graph['app.js'].includes('defects-ui.js'));
 assert.ok(graph['app.js'].includes('staff-ui.js'));

 function visit(node, stack) {
  if (stack.includes(node)) throw new Error('Zyklus: ' + stack.concat(node).join(' -> '));
  for (const next of graph[node] || []) visit(next, stack.concat(node));
 }
 for (const name of Object.keys(graph)) visit(name, []);
});

test('Event-Listener der Shell-IDs bleiben einmalig registriert', () => {
 const counts = new Map();
 for (const file of shellFiles) {
  for (const id of listenerTargets(file.source)) {
   counts.set(id, (counts.get(id) || 0) + 1);
  }
 }
 const duplicates = [...counts.entries()].filter(([, count]) => count > 1);
 assert.deepEqual(duplicates, []);
 for (const id of ['invite-form', 'staff-form', 'defect-form', 'defect-filter', 'defect-facility-filter', 'dashboard-facility', 'form', 'reload']) {
  assert.equal(counts.get(id), 1, id);
 }
});

test('js-Ordner enthält die Shell-Module der Modularisierung', () => {
 const names = new Set(readdirSync(path.join(root, 'js')));
 assert.ok(names.has('app.js'));
 assert.ok(names.has('dashboard.js'));
 assert.ok(names.has('defects-ui.js'));
 assert.ok(names.has('defects-store.js'));
 assert.ok(names.has('staff-ui.js'));
});
