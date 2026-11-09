import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {convertTageszeitZweizeilig, notable} from '../js/meter-import-profiles.js';
import {planHistoricalPayload, normalizePreviewResult, preparePreviewCall, previewErrorMessage, reviseHistoricalTimes} from '../js/meter-import-store.js';
import {mappingCandidates, mappingPermission, planMappingSave, translateImportMedium} from '../js/meter-import.js';
import {state} from '../js/state.js';

const sandbox = {console};
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.runInNewContext(fs.readFileSync(new URL('../vendor/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox, {filename: 'xlsx.full.min.js'});
const XLSX = sandbox.XLSX;

function workbook(sheetName) {
 const rows = [
  ['Prignitzer Badewelt', '', ''],
  ['', 'Strom', 'Strom'],
  ['', 'Testimport', 'Reserve'],
  [1, 100, ''],
  ['', 110, ''],
  [2, 120, ''],
  ['', 130, '']
 ];
 const sheet = XLSX.utils.aoa_to_sheet(rows);
 const book = XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(book, sheet, sheetName);
 return book;
}

function reading(overrides = {}) {
 return {
  zeilen_id: '1',
  quelle_blatt: 'Jan 2020',
  quelle_zelle: 'B4',
  zaehler_schluessel: 'pbw-strom-test',
  ablesedatum: '2020-01-01',
  datum_genauigkeit: 'tag',
  ablesezeitraum: 'vormittag',
  ableseuhrzeit: '',
  uhrzeit_status: 'unbekannt',
  zaehlerstand: '100',
  wert_art: 'zaehlerstand',
  pruefstatus: 'pruefung',
  pruefhinweis: 'uhrzeit_unbekannt',
  ...overrides
 };
}

const readyContext = {
 facilityId: 'fac-a',
 timeEntry: {vormittag: '09:00', abend: '21:00', bestaetigt: true},
 mappings: [{facility_id: 'fac-a', excel_schluessel: 'pbw-strom-test', meter_id: 'meter-1', revoked_at: null}],
 mappingState: 'ready',
 meters: [{id: 'meter-1'}],
 choices: new Map(),
 decisions: new Map()
};

test('Eine unbekannte Uhrzeit allein ist keine Auffälligkeit', () => {
 assert.equal(notable(reading()), false);
 assert.equal(notable(reading({pruefhinweis: 'uhrzeit_unbekannt;ruecklaeufig'})), true);
});

test('Der Excel-Konverter liest lokale Testdaten und erfindet keine Uhrzeit', () => {
 const result = convertTageszeitZweizeilig(workbook('Jan 2020'), 'vorschau.xlsx', XLSX);
 assert.equal(result.summary.readings, 4);
 assert.equal(result.readings.every(row => row.ableseuhrzeit === ''), true);
 assert.equal(result.readings[0].ablesedatum, '2020-01-01');
 assert.equal(result.readings[0].zaehlerstand, '100');
});

test('Ein zweistelliges Blattjahr bleibt bei der bestehenden Lesart', () => {
 const result = convertTageszeitZweizeilig(workbook('Jan 90'), 'vorschau.xlsx', XLSX);
 assert.equal(result.readings[0].ablesedatum, '2090-01-01');
});

test('Offene Prüfentscheidungen sperren die Vorschau und gelten nicht als ausgeschlossen', () => {
 const plan = planHistoricalPayload({
  ...readyContext,
  readings: [reading({pruefhinweis: 'ruecklaeufig'})]
 });
 assert.equal(plan.ready, false);
 assert.equal(plan.payload, null);
 assert.equal(plan.counts.offen, 1);
 assert.equal(plan.counts.ausgeschlossen, 0);
 assert.equal(preparePreviewCall({plan, permission: ''}).call, false);
});

test('Eine bestätigte kleine Datei erzeugt nur die Vorschau-Payload', () => {
 const plan = planHistoricalPayload({...readyContext, readings: [reading()]});
 assert.equal(plan.ready, true);
 assert.equal(plan.payload.length, 1);
 assert.equal(plan.payload[0].uhrzeit_angenommen, true);
 assert.equal(plan.payload[0].uhrzeit_bestaetigt, true);
 assert.equal(plan.payload[0].bestaetigte_uhrzeit, '09:00');
 assert.equal(preparePreviewCall({plan, permission: ''}).call, true);
 assert.equal(preparePreviewCall({plan, permission: 'Historische Importe darf die Betriebsleitung oder Geschäftsführung.'}).call, false);
});

test('Die Vorschauantwort bleibt lesbar und speichert nichts', () => {
 const result = normalizePreviewResult({
  uebernehmbar: 4,
  blockiert: 0,
  schreibbar: true,
  zeilen: [{status: 'blockiert', datensatz_id: 'Jan 2020!B4', gruende: ['Der Stand ist rückläufig.']}],
  verbrauchsauswirkungen: [{reading_id: 'reading-1', bisher: null, danach: 870}]
 });
 assert.equal(result.ok, true);
 assert.equal(result.uebernehmbar, 4);
 assert.equal(result.blockiert, 0);
 assert.equal(result.schreibbar, true);
 assert.equal(result.blocked[0].gruende[0], 'Der Stand ist rückläufig.');
 assert.equal(result.effects[0].bisher, null);
 assert.equal(result.effects[0].danach, 870);
 assert.equal(result.effects[0].differenz, null);
 assert.match(previewErrorMessage({code: '57014'}), /nichts gespeichert/);
});

test('Zuordnungen bleiben an Verbrauchsart, Einheit und Rolle gebunden', () => {
 assert.deepEqual(translateImportMedium('Wasser', 'm³'), {medium: 'water', unit: 'm3'});
 const meters = [
  {id: 'ht', label: 'Zähler HT', medium: 'electricity', unit: 'kWh'},
  {id: 'nt', label: 'Zähler NT', medium: 'electricity', unit: 'kWh'},
  {id: 'water', label: 'Wasser', medium: 'water', unit: 'm3'}
 ];
 const candidates = mappingCandidates({verbrauchsart: 'Strom', einheit: 'kWh', zaehler_bezeichnung: 'Haupt HT'}, meters);
 assert.deepEqual(candidates.map(meter => meter.id), ['ht']);
 const blocked = planMappingSave({
  excel: {zaehler_bezeichnung: 'Haupt HT', verbrauchsart: 'Strom', einheit: 'kWh'},
  selectedMeterId: 'water',
  saved: null,
  confirmChange: false,
  altbestandChecked: false,
  stockCount: 0,
  candidates,
  allMeters: meters,
  localStatus: 'getrennt'
 });
 assert.equal(blocked.ok, false);

 state.currentUser = {id: 'user-1'};
 state.myMemberships = [{organization_id: 'org-a', facility_id: 'fac-a', role: 'employee', is_active: true}];
 assert.match(mappingPermission({id: 'fac-a', organization_id: 'org-a'}), /Betriebsleitung/);
 state.myMemberships = [{organization_id: 'org-a', facility_id: 'fac-a', role: 'facility_manager', is_active: true}];
 assert.equal(mappingPermission({id: 'fac-a', organization_id: 'org-a'}), '');
});

test('Eine geänderte Uhrzeit löscht die Bestätigung', () => {
 const revised = reviseHistoricalTimes({vormittag: '09:00', abend: '21:00', bestaetigt: true}, {abend: '20:30'});
 assert.equal(revised.ok, true);
 assert.equal(revised.entry.bestaetigt, false);
 assert.equal(revised.entry.abend, '20:30');
});
