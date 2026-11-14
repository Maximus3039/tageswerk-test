import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const files = [
 'operations-ui.js',
 'operations-ui-shared.js',
 'operations-ui-figures.js',
 'operations-ui-sections.js',
 'operations-ui-temperature.js',
 'operations-ui-water.js'
].map(name => ({
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

function rpcCalls(source) {
 return [...source.matchAll(/save[A-Za-z]+\(|loadDayFigureBoard\(|discardWaterRound\(/g)].map(match => match[0]);
}

test('operations-ui behält die öffentliche Fassade', () => {
 const facade = files.find(file => file.name === 'operations-ui.js').source;
 assert.match(facade, /export function mountOperations\(/);
 assert.match(facade, /export function focusNotice\(/);
 assert.match(facade, /export function syncOperationFacility\(/);
 assert.match(facade, /export async function showOperationSection\(/);
 assert.match(facade, /export async function openOperations\(/);
 assert.match(facade, /export function refreshOperationMetrics\(/);
 assert.doesNotMatch(facade, /export function renderWater\(/);
 assert.doesNotMatch(facade, /export function renderDayFigures\(/);
});

test('Fachmodule trennen Berichte, Kennzahlen, Wasser und Temperatur', () => {
 const byName = Object.fromEntries(files.map(file => [file.name, file.source]));
 assert.match(byName['operations-ui-figures.js'], /export function renderDayFigures\(/);
 assert.match(byName['operations-ui-figures.js'], /saveDayFigures\(/);
 assert.match(byName['operations-ui-figures.js'], /loadDayFigureBoard\(/);
 assert.match(byName['operations-ui-figures.js'], /dayFigureAccess\(/);
 assert.match(byName['operations-ui-figures.js'], /employeeFigureWindow\(/);
 assert.match(byName['operations-ui-figures.js'], /Änderungsgrund/);
 assert.match(byName['operations-ui-water.js'], /export function renderWater\(/);
 assert.match(byName['operations-ui-water.js'], /saveWaterRound\(/);
 assert.match(byName['operations-ui-water.js'], /saveWaterCheck\(/);
 assert.match(byName['operations-ui-temperature.js'], /export function renderTemperature\(/);
 assert.match(byName['operations-ui-temperature.js'], /saveTemperatureReading\(/);
 assert.match(byName['operations-ui-sections.js'], /export function renderReports\(/);
 assert.match(byName['operations-ui-sections.js'], /export function renderInspections\(/);
 assert.match(byName['operations-ui-sections.js'], /export function renderMaintenance\(/);
 assert.match(byName['operations-ui-sections.js'], /export function renderProcurement\(/);
 assert.match(byName['operations-ui-sections.js'], /export function renderStock\(/);
});

test('operations-ui-Module haben keine zirkulären Imports', () => {
 const allowed = new Set(files.map(file => file.name));
 const graph = Object.fromEntries(files.map(file => [
  file.name,
  importsOf(file.source).filter(name => allowed.has(name))
 ]));
 assert.deepEqual(graph['operations-ui-shared.js'], []);
 assert.deepEqual(graph['operations-ui-figures.js'], ['operations-ui-shared.js']);
 assert.deepEqual(graph['operations-ui-temperature.js'], ['operations-ui-shared.js']);
 assert.deepEqual(graph['operations-ui-water.js'], ['operations-ui-shared.js']);
 assert.deepEqual(graph['operations-ui-sections.js'].sort(), ['operations-ui-figures.js', 'operations-ui-shared.js'].sort());
 assert.ok(graph['operations-ui.js'].includes('operations-ui-shared.js'));
 assert.ok(graph['operations-ui.js'].includes('operations-ui-sections.js'));
 assert.ok(graph['operations-ui.js'].includes('operations-ui-temperature.js'));
 assert.ok(graph['operations-ui.js'].includes('operations-ui-water.js'));

 function visit(node, stack) {
  if (stack.includes(node)) throw new Error('Zyklus: ' + stack.concat(node).join(' -> '));
  for (const next of graph[node] || []) visit(next, stack.concat(node));
 }
 for (const name of Object.keys(graph)) visit(name, []);
});

test('mountOperations bleibt die einzige Geburtsstätte der Betriebs-Listener', () => {
 const facade = files.find(file => file.name === 'operations-ui.js').source;
 const others = files.filter(file => file.name !== 'operations-ui.js').map(file => file.source).join('\n');
 assert.match(facade, /export function mountOperations\(/);
 assert.match(facade, /opener\.dataset\.bound = '1'/);
 assert.match(facade, /el\('operations-facility'\)\?\.addEventListener/);
 assert.match(facade, /tab\.addEventListener\('click'/);
 assert.doesNotMatch(others, /mountOperations\(/);
 assert.doesNotMatch(others, /opener\.dataset\.bound/);
 assert.doesNotMatch(others, /el\('operations-facility'\)\?\.addEventListener/);
 assert.doesNotMatch(others, /tab\.addEventListener\('click'/);
});

test('Kennzahlen- und Wasser-RPCs bleiben in den Fachmodulen erhalten', () => {
 const figures = files.find(file => file.name === 'operations-ui-figures.js').source;
 const water = files.find(file => file.name === 'operations-ui-water.js').source;
 const sections = files.find(file => file.name === 'operations-ui-sections.js').source;
 const temperature = files.find(file => file.name === 'operations-ui-temperature.js').source;
 assert.ok(rpcCalls(figures).includes('saveDayFigures('));
 assert.ok(rpcCalls(figures).includes('loadDayFigureBoard('));
 assert.ok(rpcCalls(water).includes('saveWaterRound('));
 assert.ok(rpcCalls(water).includes('saveWaterCheck('));
 assert.ok(rpcCalls(water).includes('discardWaterRound('));
 assert.ok(rpcCalls(sections).includes('saveDailyReport('));
 assert.ok(rpcCalls(sections).includes('saveInspectionResult('));
 assert.ok(rpcCalls(sections).includes('saveMaintenanceLog('));
 assert.ok(rpcCalls(sections).includes('saveMaterial('));
 assert.ok(rpcCalls(temperature).includes('saveTemperatureReading('));
});

test('Fachmodule importieren die genutzten Hilfsfunktionen aus shared', () => {
 const byName = Object.fromEntries(files.map(file => [file.name, file.source]));
 assert.match(byName['operations-ui-temperature.js'], /item,/);
 assert.match(byName['operations-ui-temperature.js'], /say,/);
 assert.match(byName['operations-ui-figures.js'], /select,/);
 assert.match(byName['operations-ui-figures.js'], /missingNote,/);
 assert.match(byName['operations-ui-sections.js'], /say,/);
 assert.match(byName['operations-ui-sections.js'], /amountLabel,/);
 assert.doesNotMatch(byName['operations-ui-shared.js'], /function paintOperationMetrics\(/);
 assert.doesNotMatch(byName['operations-ui-shared.js'], /export function refreshOperationMetrics\(/);
});

test('js-Ordner enthält die Betriebs-UI-Module', () => {
 const names = new Set(readdirSync(path.join(root, 'js')));
 for (const name of files.map(file => file.name)) assert.ok(names.has(name), name);
});
