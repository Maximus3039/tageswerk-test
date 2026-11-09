import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareCommitCall, normalizeCommitResult, commitErrorMessage, commitRefreshesConsumption, runHistoricalCommit} from '../../js/meter-import-store.js';

const token = '8f1b0a6e-6c2d-4b1a-8d3e-123456789abc';
const batchId = 'a1b2c3d4-e5f6-4711-89ab-abcdefabcdef';
const hash = 'a'.repeat(64);
const preview = {ok: true, key: 'datei', schreibbar: true, blockiert: 0, token};
const plan = {ready: true, payload: [{datensatz_id: 'Jan 2020!B4', excel_schluessel: 'pbw-strom-test'}]};

function readyCall(overrides = {}) {
 return prepareCommitCall({
  permission: '',
  confirmed: true,
  busy: false,
  preview,
  plan,
  planKey: 'datei',
  hash,
  fileName: 'vorschau.xlsx',
  ...overrides
 });
}

test('Eine freigegebene Vorschau darf erst nach Bestätigung übernommen werden', () => {
 const blocked = readyCall({confirmed: false});
 assert.equal(blocked.call, false);
 assert.match(blocked.message, /bestätigt/);
 const ready = readyCall();
 assert.equal(ready.call, true);
 assert.equal(ready.token, token);
 assert.equal(ready.payload, plan.payload);
});

test('Eine veraltete oder nicht freigegebene Vorschau startet keine Übernahme', () => {
 assert.equal(readyCall({preview: {...preview, key: 'alt'}}).call, false);
 assert.match(readyCall({preview: {...preview, key: 'alt'}}).message, /veraltet/);
 assert.equal(readyCall({preview: {...preview, schreibbar: false}}).call, false);
 assert.equal(readyCall({preview: {...preview, blockiert: 2}}).call, false);
 assert.equal(readyCall({busy: true}).call, false);
 assert.match(readyCall({permission: 'Historische Importe darf die Betriebsleitung oder Geschäftsführung.'}).message, /Betriebsleitung/);
});

test('Ein simulierter Import übernimmt die Antwort und aktualisiert die Verbrauchsanzeige', async () => {
 const calls = [];
 const decision = readyCall();
 const outcome = await runHistoricalCommit({
  decision,
  facilityId: 'fac-a',
  rpc(name, args) {
   calls.push({name, args});
   return Promise.resolve({data: {status: 'uebernommen', batch_id: batchId, zeilen: 4, erneut: false}, error: null});
  }
 });
 assert.deepEqual(calls.map(call => call.name), ['tageswerk_commit_historical_import']);
 assert.equal(calls[0].args.p_client_token, token);
 assert.equal(calls[0].args.p_inhalt_sha256, hash);
 assert.equal(calls[0].args.p_payload, plan.payload);
 assert.equal(outcome.ok, true);
 assert.equal(outcome.result.zeilen, 4);
 assert.equal(outcome.result.erneut, false);
 assert.equal(outcome.refresh, true);
 assert.equal(commitRefreshesConsumption(outcome.result), true);
});

test('Eine wiederholte Übernahme derselben Kennung schreibt nicht erneut', async () => {
 const calls = [];
 const decision = readyCall();
 const rpc = (name, args) => {
  calls.push({name, token: args.p_client_token});
  return Promise.resolve({data: {status: 'uebernommen', batch_id: batchId, zeilen: 4, erneut: calls.length > 1}, error: null});
 };
 const first = await runHistoricalCommit({decision, facilityId: 'fac-a', rpc});
 const second = await runHistoricalCommit({decision, facilityId: 'fac-a', rpc});
 assert.equal(first.result.erneut, false);
 assert.equal(second.result.erneut, true);
 assert.deepEqual(calls.map(call => call.token), [token, token]);
 assert.equal(second.refresh, true);
});

test('Blockierte, doppelte und fehlerhafte Übernahmen rufen keine zweite Funktion auf', async () => {
 const calls = [];
 const rpc = (name, args) => {
  calls.push(name);
  if (args.p_dateiname === 'zeit') return Promise.resolve({data: null, error: {code: '57014', message: 'statement timeout'}});
  if (args.p_dateiname === 'netz') return Promise.resolve({data: null, error: {message: 'Failed to fetch'}});
  if (args.p_dateiname === 'doppelt') return Promise.resolve({data: null, error: {message: 'Diese Datei wurde für den Betrieb bereits importiert.'}});
  return Promise.resolve({data: {status: 'offen'}, error: null});
 };
 const denied = await runHistoricalCommit({decision: readyCall({confirmed: false}), facilityId: 'fac-a', rpc});
 assert.equal(denied.called, false);
 assert.equal(calls.length, 0);
 const timeout = await runHistoricalCommit({decision: readyCall(), facilityId: 'fac-a', rpc: (name, args) => rpc(name, {...args, p_dateiname: 'zeit'})});
 assert.match(timeout.message, /nichts gespeichert/);
 assert.equal(timeout.refresh, false);
 const network = await runHistoricalCommit({decision: readyCall(), facilityId: 'fac-a', rpc: (name, args) => rpc(name, {...args, p_dateiname: 'netz'})});
 assert.match(network.message, /Verbrauchsanzeige prüfen/);
 const duplicate = await runHistoricalCommit({decision: readyCall(), facilityId: 'fac-a', rpc: (name, args) => rpc(name, {...args, p_dateiname: 'doppelt'})});
 assert.match(duplicate.message, /bereits importiert/);
 const incomplete = await runHistoricalCommit({decision: readyCall(), facilityId: 'fac-a', rpc});
 assert.equal(incomplete.ok, false);
 assert.deepEqual(calls, [
  'tageswerk_commit_historical_import',
  'tageswerk_commit_historical_import',
  'tageswerk_commit_historical_import',
  'tageswerk_commit_historical_import'
 ]);
 assert.match(commitErrorMessage({code: '42501'}), /Betriebsleitung/);
 assert.equal(normalizeCommitResult({status: 'uebernommen', batch_id: batchId, zeilen: 0, erneut: false}).ok, false);
});
