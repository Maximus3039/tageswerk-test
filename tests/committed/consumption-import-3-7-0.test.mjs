import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {prepareCommitCall, preparePreviewCall, planHistoricalPayload} from '../../js/meter-import-store.js';
import {thousandths} from '../../js/meters-domain.js';

const previewSql = readFileSync(new URL('../../tageswerk_3_7_0_test_import_preview.sql', import.meta.url), 'utf8');
const importUi = readFileSync(new URL('../../js/meter-import.js', import.meta.url), 'utf8');

test('TEST-Importvorschau ersetzt prepare_reading nicht und installiert kein Commit', () => {
  assert.match(previewSql, /tageswerk_preview_historical_import/);
  assert.match(previewSql, /SECURITY INVOKER/);
  assert.match(previewSql, /tageswerk_prepare_reading weicht ab/);
  assert.doesNotMatch(previewSql, /CREATE OR REPLACE FUNCTION public\.tageswerk_prepare_reading/);
  assert.doesNotMatch(previewSql, /CREATE OR REPLACE FUNCTION public\.tageswerk_commit_historical_import/);
  assert.match(previewSql, /GRANT SELECT ON TABLE public\.utility_meter_import_batches/);
  assert.doesNotMatch(previewSql, /GRANT INSERT ON TABLE public\.utility_meter_import_readings/);
});

test('Excel- und CSV-Dateien bleiben im Zählerimport zugelassen', () => {
  assert.match(importUi, /\.xlsx,\.csv/);
  assert.match(importUi, /XLSX\.read/);
});

test('Lokale Dubletten und offene Entscheidungen sperren die Vorschau', () => {
  const readings = [
    {quelle_blatt: 'Blatt1', quelle_zelle: 'B2', excel_schluessel: 'A1', ablesedatum: '2026-11-20', ablesezeitraum: 'vormittag', datum_genauigkeit: 'tag', zaehlerstand: '90', pruef_offen: 'nein'},
    {quelle_blatt: 'Blatt1', quelle_zelle: 'B2', excel_schluessel: 'A1', ablesedatum: '2026-11-20', ablesezeitraum: 'abend', datum_genauigkeit: 'tag', zaehlerstand: '91', pruef_offen: 'nein'}
  ];
  const decisions = new Map([
    ['Blatt1!B2', {entscheidung: 'bestaetigt'}]
  ]);
  const plan = planHistoricalPayload({
    readings,
    decisions,
    choices: new Map(),
    facilityId: 'a1000000-0000-4000-8000-000000000011',
    timeEntry: {vormittag: '09:00', abend: '21:00', bestaetigt: true},
    mappings: [{facility_id: 'a1000000-0000-4000-8000-000000000011', excel_schluessel: 'A1', meter_id: 'b1', revoked_at: null}],
    mappingState: 'ready',
    meters: [{id: 'b1'}]
  });
  assert.equal(plan.ready, false);
});

test('Übernahme bleibt ohne Bestätigung und ohne Vorschau gesperrt', () => {
  const blocked = prepareCommitCall({permission: '', confirmed: false, busy: false, preview: {ok: true, key: 'k', schreibbar: true, blockiert: 0, token: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'}, plan: {ready: true, payload: [{}]}, planKey: 'k', hash: 'a'.repeat(64), fileName: 'x.xlsx'});
  assert.equal(blocked.call, false);
  const preview = preparePreviewCall({permission: '', plan: {ready: false, payload: []}});
  assert.equal(preview.call, false);
});

test('Zwei Stände 100,5 und 110,5 ergeben 10 kWh Verbrauch', () => {
  assert.equal(thousandths('110,5') - thousandths('100,5'), 10000n);
});
