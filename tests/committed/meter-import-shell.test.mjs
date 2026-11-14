import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {
 preparePreviewCall,
 prepareCommitCall,
 planHistoricalPayload,
 normalizePreviewResult,
 previewErrorMessage,
 commitErrorMessage,
 runHistoricalCommit
} from '../../js/meter-import-store.js';
import {needsReview} from '../../js/meter-import-review.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const files = [
 'meter-import.js',
 'meter-import-store.js',
 'meter-import-profiles.js',
 'meter-import-review.js'
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

test('meter-import.js enthält keine direkten Datenbankzugriffe', () => {
 const ui = files.find(file => file.name === 'meter-import.js').source;
 assert.doesNotMatch(ui, /from\s+['"]\.\/supabase\.js['"]/);
 assert.doesNotMatch(ui, /supabase\./);
 assert.doesNotMatch(ui, /\.rpc\(/);
 assert.doesNotMatch(ui, /\.from\(['"]utility_/);
 assert.match(ui, /previewHistoricalImport\(/);
 assert.match(ui, /commitHistoricalImport\(/);
 assert.match(ui, /fetchImportMappings\(/);
 assert.match(ui, /insertImportMappingRow\(/);
 assert.match(ui, /revokeImportMappingRow\(/);
 assert.match(ui, /loadInactiveStock\(/);
 assert.match(ui, /loadEffectContext\(/);
});

test('meter-import-store.js hält Mapping-, Vorschau- und Commit-Zugriffe', () => {
 const store = files.find(file => file.name === 'meter-import-store.js').source;
 assert.match(store, /from\s+['"]\.\/supabase\.js['"]/);
 assert.match(store, /utility_meter_readings/);
 assert.match(store, /utility_meter_import_mappings/);
 assert.match(store, /utility_meter_consumption/);
 assert.match(store, /tageswerk_preview_historical_import/);
 assert.match(store, /tageswerk_commit_historical_import/);
 assert.match(store, /p_facility_id/);
 assert.match(store, /p_payload/);
 assert.match(store, /p_client_token/);
 assert.match(store, /p_inhalt_sha256/);
 assert.match(store, /p_dateiname/);
 assert.doesNotMatch(store, /from\s+['"]\.\/meter-import\.js['"]/);
});

test('Import-Module haben keine zirkulären Imports', () => {
 const allowed = new Set(files.map(file => file.name));
 const graph = Object.fromEntries(files.map(file => [
  file.name,
  importsOf(file.source).filter(name => allowed.has(name))
 ]));
 assert.deepEqual(graph['meter-import-profiles.js'], []);
 assert.deepEqual(graph['meter-import-review.js'], []);
 assert.deepEqual(graph['meter-import-store.js'], ['meter-import-review.js']);
 assert.ok(graph['meter-import.js'].includes('meter-import-store.js'));
 assert.ok(graph['meter-import.js'].includes('meter-import-profiles.js'));
 assert.ok(graph['meter-import.js'].includes('meter-import-review.js'));
 assert.ok(!graph['meter-import.js'].includes('supabase.js'));

 function visit(node, stack) {
  if (stack.includes(node)) throw new Error('Zyklus: ' + stack.concat(node).join(' -> '));
  for (const next of graph[node] || []) visit(next, stack.concat(node));
 }
 for (const name of Object.keys(graph)) visit(name, []);
});

test('Excel-Einlesen und Mapping bleiben in Profil und UI getrennt', () => {
 const profile = files.find(file => file.name === 'meter-import-profiles.js').source;
 const ui = files.find(file => file.name === 'meter-import.js').source;
 assert.match(profile, /function convertTageszeitZweizeilig\(/);
 assert.match(profile, /export \{[^}]*convertTageszeitZweizeilig/);
 assert.match(ui, /convertTageszeitZweizeilig\(/);
 assert.match(ui, /Zuordnung speichern/);
 assert.match(ui, /planMappingSave\(/);
 assert.match(ui, /mappingCandidates\(/);
 assert.doesNotMatch(profile, /supabase/);
 assert.doesNotMatch(files.find(file => file.name === 'meter-import-review.js').source, /supabase/);
});

test('Vorschau speichert nichts und sperrt fehlerhafte Daten', () => {
 const planOpen = planHistoricalPayload({
  facilityId: 'fac',
  timeEntry: {vormittag: '09:00', abend: '21:00', bestaetigt: true},
  mappings: [{facility_id: 'fac', excel_schluessel: 'z1', meter_id: 'm1', revoked_at: null}],
  mappingState: 'ready',
  meters: [{id: 'm1'}],
  choices: new Map(),
  decisions: new Map(),
  readings: [{
   zeilen_id: '1',
   quelle_blatt: 'Jan 2020',
   quelle_zelle: 'B4',
   zaehler_schluessel: 'z1',
   ablesedatum: '2020-01-01',
   datum_genauigkeit: 'tag',
   ablesezeitraum: 'vormittag',
   ableseuhrzeit: '',
   uhrzeit_status: 'unbekannt',
   zaehlerstand: '100',
   wert_art: 'zaehlerstand',
   pruefstatus: 'pruefung',
   pruefhinweis: 'ruecklaeufig'
  }]
 });
 assert.equal(planOpen.ready, false);
 assert.equal(preparePreviewCall({plan: planOpen, permission: ''}).call, false);

 const planReady = planHistoricalPayload({
  facilityId: 'fac',
  timeEntry: {vormittag: '09:00', abend: '21:00', bestaetigt: true},
  mappings: [{facility_id: 'fac', excel_schluessel: 'z1', meter_id: 'm1', revoked_at: null}],
  mappingState: 'ready',
  meters: [{id: 'm1'}],
  choices: new Map(),
  decisions: new Map(),
  readings: [{
   zeilen_id: '1',
   quelle_blatt: 'Jan 2020',
   quelle_zelle: 'B4',
   zaehler_schluessel: 'z1',
   ablesedatum: '2020-01-01',
   datum_genauigkeit: 'tag',
   ablesezeitraum: 'vormittag',
   ableseuhrzeit: '',
   uhrzeit_status: 'unbekannt',
   zaehlerstand: '100',
   wert_art: 'zaehlerstand',
   pruefstatus: 'pruefung',
   pruefhinweis: 'uhrzeit_unbekannt'
  }]
 });
 assert.equal(planReady.ready, true);
 assert.equal(preparePreviewCall({plan: planReady, permission: ''}).call, true);
 assert.equal(preparePreviewCall({plan: planReady, permission: 'Historische Importe darf die Betriebsleitung oder Geschäftsführung.'}).call, false);

 const preview = normalizePreviewResult({
  uebernehmbar: 1,
  blockiert: 0,
  schreibbar: true,
  zeilen: [],
  verbrauchsauswirkungen: []
 });
 assert.equal(preview.ok, true);
 assert.match(previewErrorMessage({code: '57014'}), /nichts gespeichert/);
 assert.ok(needsReview({wert_art: 'zaehlerstand', pruefstatus: 'pruefung', pruefhinweis: 'ruecklaeufig'}));
 assert.equal(needsReview({wert_art: 'zaehlerstand', pruefstatus: 'pruefung', pruefhinweis: 'uhrzeit_unbekannt'}), false);
});

test('Importbestätigung, Berechtigung und doppelte Übernahme bleiben begrenzt', async () => {
 const token = '11111111-1111-4111-8111-111111111111';
 const hash = 'a'.repeat(64);
 const payload = [{meter_id: 'm1'}];
 const preview = {ok: true, key: 'k1', token, schreibbar: true, blockiert: 0};
 const plan = {ready: true, payload};
 assert.equal(prepareCommitCall({
  permission: '',
  confirmed: false,
  busy: false,
  preview,
  plan,
  planKey: 'k1',
  hash,
  fileName: 'stand.xlsx'
 }).call, false);
 assert.equal(prepareCommitCall({
  permission: 'Historische Importe darf die Betriebsleitung oder Geschäftsführung.',
  confirmed: true,
  busy: false,
  preview,
  plan,
  planKey: 'k1',
  hash,
  fileName: 'stand.xlsx'
 }).call, false);
 const decision = prepareCommitCall({
  permission: '',
  confirmed: true,
  busy: false,
  preview,
  plan,
  planKey: 'k1',
  hash,
  fileName: 'stand.xlsx'
 });
 assert.equal(decision.call, true);

 const calls = [];
 const first = await runHistoricalCommit({
  decision,
  facilityId: 'fac',
  rpc: async (name, args) => {
   calls.push({name, args});
   return {data: {status: 'uebernommen', zeilen: 1, batch_id: token, erneut: false}, error: null};
  }
 });
 assert.equal(first.ok, true);
 assert.equal(first.refresh, true);
 assert.deepEqual(calls.map(call => call.name), ['tageswerk_commit_historical_import']);

 const duplicate = await runHistoricalCommit({
  decision,
  facilityId: 'fac',
  rpc: async () => ({data: {status: 'uebernommen', zeilen: 1, batch_id: token, erneut: true}, error: null})
 });
 assert.equal(duplicate.ok, true);
 assert.equal(duplicate.result.erneut, true);

 const denied = await runHistoricalCommit({
  decision,
  facilityId: 'fac',
  rpc: async () => ({data: null, error: {code: '42501', message: 'permission denied'}})
 });
 assert.equal(denied.ok, false);
 assert.match(denied.message, /Betriebsleitung oder Geschäftsführung/);
 assert.match(commitErrorMessage({code: '57014'}), /nichts gespeichert/);
});

test('js-Ordner enthält die Excel-Import-Module', () => {
 const names = new Set(readdirSync(path.join(root, 'js')));
 for (const name of files.map(file => file.name)) assert.ok(names.has(name), name);
});
