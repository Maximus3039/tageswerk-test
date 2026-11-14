import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
 canCorrectWaterFilterFlush,
 canManageWaterFilters,
 canReadWaterFilterFlushHistory,
 canRecordWaterFilterFlush,
 flushCorrectionMark,
 waterFilterDraftError,
 waterFilterFlushCorrectionArgs,
 waterFilterFlushCorrectionDraftError,
 waterFilterFlushDraftError
} from '../../js/water-filters.js';
import {emptyOperations} from '../../js/operations.js';

const migration = readFileSync(new URL('../../tageswerk_3_5_9_water_filter_flush_corrections.sql', import.meta.url), 'utf8');
const vorpruefung = readFileSync(new URL('../../tageswerk_3_5_9_water_filter_flush_corrections_vorpruefung.sql', import.meta.url), 'utf8');
const pruefung = readFileSync(new URL('../../tageswerk_3_5_9_water_filter_flush_corrections_pruefung.sql', import.meta.url), 'utf8');
const verhalten = readFileSync(new URL('../../tageswerk_3_5_9_water_filter_flush_corrections_verhalten.sql', import.meta.url), 'utf8');
const store = readFileSync(new URL('../../js/operations-store.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../../js/operations-ui-water.js', import.meta.url), 'utf8');

const facility = {id: 'facility-1', organization_id: 'org-1'};
const employee = [{user_id: 'e1', organization_id: 'org-1', facility_id: 'facility-1', role: 'employee', is_active: true}];
const technician = [{user_id: 't1', organization_id: 'org-1', facility_id: 'facility-1', role: 'technician', is_active: true}];
const manager = [{user_id: 'm1', organization_id: 'org-1', facility_id: 'facility-1', role: 'facility_manager', is_active: true}];
const admin = [{user_id: 'a1', organization_id: 'org-1', facility_id: null, role: 'company_admin', is_active: true}];

test('Korrektur-Migration bleibt vorbereitet und nicht wiederholbar', () => {
 assert.match(migration, /Nicht ohne ausdrückliche Freigabe ausführen/);
 assert.match(migration, /nicht erneut ausführen/);
 assert.match(migration, /CREATE TABLE public\.water_filter_flush_corrections/);
 assert.match(migration, /tageswerk_correct_water_filter_flush/);
 assert.match(migration, /tageswerk_refresh_water_filter_last_flush/);
 assert.match(migration, /FOR UPDATE/);
 assert.match(migration, /water_filter_flush_correction/);
 assert.doesNotMatch(migration, /DROP TABLE/);
 assert.doesNotMatch(migration, /GRANT UPDATE ON TABLE public\.water_filter_flushes/);
 assert.doesNotMatch(migration, /GRANT DELETE ON TABLE public\.water_filter_flushes/);
});

test('Korrekturprotokoll und Rollengrenzen sind in der Migration verankert', () => {
 assert.match(migration, /old_filter_id/);
 assert.match(migration, /new_filter_id/);
 assert.match(migration, /old_flushed_at/);
 assert.match(migration, /new_flushed_at/);
 assert.match(migration, /old_note/);
 assert.match(migration, /new_note/);
 assert.match(migration, /reason/);
 assert.match(migration, /facility_manager/);
 assert.match(migration, /company_admin/);
 assert.match(migration, /Dokumentierte Filterspülungen werden nicht gelöscht/);
 assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.tageswerk_correct_water_filter_flush/);
 assert.match(migration, /REVOKE ALL ON FUNCTION public\.tageswerk_refresh_water_filter_last_flush/);
});

test('Prüfskripte decken Vorprüfung, Nachprüfung und Verhalten ab', () => {
 assert.match(vorpruefung, /Ausschließlich lesend/);
 assert.match(vorpruefung, /Korrekturtabelle noch nicht vorhanden/);
 assert.match(pruefung, /Schreibt nichts/);
 assert.match(pruefung, /EXECUTE nur für Korrekturfunktion/);
 assert.match(pruefung, /Keine UPDATE\/DELETE-Rechte/);
 assert.match(verhalten, /NICHT in der Produktivdatenbank/);
 assert.match(verhalten, /Mitarbeiter korrigiert nicht/);
 assert.match(verhalten, /Techniker korrigiert nicht/);
 assert.match(verhalten, /Direkter UPDATE bleibt gesperrt/);
 assert.match(verhalten, /Korrekturprotokoll gespeichert/);
 assert.match(verhalten, /Ziel-Filter neu berechnet/);
});

test('Oberflächenrechte trennen Erfassen, Lesen und Korrigieren', () => {
 assert.equal(canRecordWaterFilterFlush(facility, employee), true);
 assert.equal(canReadWaterFilterFlushHistory(facility, employee), false);
 assert.equal(canCorrectWaterFilterFlush(facility, employee), false);
 assert.equal(canManageWaterFilters(facility, employee), false);

 assert.equal(canRecordWaterFilterFlush(facility, technician), true);
 assert.equal(canReadWaterFilterFlushHistory(facility, technician), true);
 assert.equal(canCorrectWaterFilterFlush(facility, technician), false);
 assert.equal(canManageWaterFilters(facility, technician), false);

 assert.equal(canManageWaterFilters(facility, manager), true);
 assert.equal(canCorrectWaterFilterFlush(facility, manager), true);
 assert.equal(canReadWaterFilterFlushHistory(facility, manager), true);
 assert.equal(canCorrectWaterFilterFlush(facility, admin), true);
});

test('Entwürfe und Korrekturargumente bleiben begrenzt', () => {
 assert.match(waterFilterDraftError({poolId: '', name: 'A'}), /Becken/);
 assert.equal(waterFilterDraftError({poolId: 'p1', name: 'Sandfilter'}), '');
 assert.match(waterFilterFlushDraftError({filterId: 'f1', flushedAt: '2099-01-01T00:00:00.000Z'}, '2026-11-14T12:00:00.000Z'), /zukünftig/);
 assert.match(waterFilterFlushDraftError({filterId: 'f1', flushedAt: '2026-11-12T12:00:00.000Z'}, '2026-11-14T12:00:00.000Z'), /24 Stunden/);
 assert.equal(waterFilterFlushDraftError({filterId: 'f1', flushedAt: '2026-11-14T11:00:00.000Z', note: 'ok'}, '2026-11-14T12:00:00.000Z'), '');
 assert.match(waterFilterFlushCorrectionDraftError({filterId: 'f1', flushedAt: '2026-11-14T11:00:00.000Z', note: 'x', reason: 'ab'}, {filterId: 'f1', flushedAt: '2026-11-14T10:00:00.000Z', note: 'alt'}), /Begründung/);
 assert.match(waterFilterFlushCorrectionDraftError({
  filterId: 'f1', flushedAt: '2026-11-14T10:00:00.000Z', note: 'alt', reason: 'kein Wechsel'
 }, {filterId: 'f1', flushedAt: '2026-11-14T10:00:00.000Z', note: 'alt'}), /keine Änderung/);
 assert.deepEqual(waterFilterFlushCorrectionArgs('flush-1', {
  filterId: 'f2',
  flushedAt: '2026-11-14T09:00:00.000Z',
  note: 'neu',
  reason: 'Falscher Filter'
 }), {
  p_flush_id: 'flush-1',
  p_filter_id: 'f2',
  p_flushed_at: '2026-11-14T09:00:00.000Z',
  p_note: 'neu',
  p_reason: 'Falscher Filter'
 });
 assert.equal(flushCorrectionMark({correctionCount: 1, correctedAt: '2026-11-14T12:00:00.000Z'}), 'Korrigiert');
 assert.equal(flushCorrectionMark({correctionCount: 0}), '');
});

test('Bundle, Store und Wasser-UI sind für Filterspülungen vorbereitet', () => {
 const empty = emptyOperations();
 assert.deepEqual(empty.waterFilters, []);
 assert.deepEqual(empty.waterFilterFlushes, []);
 assert.deepEqual(empty.waterFilterFlushCorrections, []);
 assert.match(store, /waterFiltersInstalled/);
 assert.match(store, /tageswerk_correct_water_filter_flush/);
 assert.match(store, /saveWaterFilterFlushCorrection/);
 assert.match(store, /water_filter_flush_corrections/);
 assert.match(ui, /Filterverwaltung/);
 assert.match(ui, /Spülung erfassen/);
 assert.match(ui, /Spülhistorie/);
 assert.match(ui, /Spülung korrigieren/);
 assert.match(ui, /saveWaterFilterFlushCorrection/);
});
