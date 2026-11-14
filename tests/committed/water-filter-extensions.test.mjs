import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
 canCorrectWaterFilterFlush,
 canManageWaterFilters,
 canReadWaterFilterFlushHistory,
 canReadWaterFilterStatusHistory,
 canRecordWaterFilterFlush,
 flushCorrectionMark,
 waterFilterDraftError,
 waterFilterFlushCorrectionArgs,
 waterFilterFlushCorrectionDraftError,
 waterFilterFlushDraftError,
 waterFilterStatusDraftError
} from '../../js/water-filters.js';
import {emptyOperations} from '../../js/operations.js';

const migration = readFileSync(new URL('../../tageswerk_3_5_8_water_filter_extensions.sql', import.meta.url), 'utf8');
const vorpruefung = readFileSync(new URL('../../tageswerk_3_5_8_water_filter_extensions_vorpruefung.sql', import.meta.url), 'utf8');
const pruefung = readFileSync(new URL('../../tageswerk_3_5_8_water_filter_extensions_pruefung.sql', import.meta.url), 'utf8');
const verhalten = readFileSync(new URL('../../tageswerk_3_5_8_water_filter_extensions_verhalten.sql', import.meta.url), 'utf8');
const store = readFileSync(new URL('../../js/operations-store.js', import.meta.url), 'utf8');
const base = readFileSync(new URL('../../tageswerk_3_5_8_water_filter_flushes.sql', import.meta.url), 'utf8');

const facility = {id: 'facility-1', organization_id: 'org-1'};
const employee = [{user_id: 'e1', organization_id: 'org-1', facility_id: 'facility-1', role: 'employee', is_active: true}];
const technician = [{user_id: 't1', organization_id: 'org-1', facility_id: 'facility-1', role: 'technician', is_active: true}];
const manager = [{user_id: 'm1', organization_id: 'org-1', facility_id: 'facility-1', role: 'facility_manager', is_active: true}];
const admin = [{user_id: 'a1', organization_id: 'org-1', facility_id: null, role: 'company_admin', is_active: true}];

test('Phase-B1-Migration bleibt vorbereitet und nicht wiederholbar', () => {
 assert.match(migration, /Nicht ohne ausdrückliche Freigabe ausführen/);
 assert.match(migration, /nicht erneut ausführen/);
 assert.match(migration, /CREATE TABLE public\.water_filter_flush_corrections/);
 assert.match(migration, /CREATE TABLE public\.water_filter_status_events/);
 assert.match(migration, /tageswerk_correct_water_filter_flush/);
 assert.match(migration, /tageswerk_set_water_filter_active/);
 assert.match(migration, /tageswerk_water_filter_flush_effective/);
 assert.match(migration, /original_unchanged/);
 assert.doesNotMatch(migration, /DROP TABLE/);
 assert.doesNotMatch(migration, /GRANT UPDATE ON TABLE public\.water_filter_flushes/);
 assert.doesNotMatch(migration, /GRANT DELETE ON TABLE public\.water_filter_flushes/);
});

test('Korrekturen lassen Originale unverändert und Statuswechsel werden protokolliert', () => {
 assert.match(migration, /previous_filter_id/);
 assert.match(migration, /previous_flushed_at/);
 assert.match(migration, /previous_note/);
 assert.match(migration, /Originaleintrag bleibt unverändert/);
 assert.match(migration, /old_active/);
 assert.match(migration, /new_active/);
 assert.match(migration, /tageswerk_water_filter_caps/);
 assert.match(migration, /tageswerk_water_filter_cap_arm/);
 assert.match(migration, /tageswerk_water_filter_cap_consume/);
 assert.match(migration, /GRANT UPDATE \(name\) ON TABLE public\.water_filters/);
 assert.match(migration, /REVOKE UPDATE ON TABLE public\.water_filters FROM PUBLIC/);
 assert.match(migration, /REVOKE UPDATE ON TABLE public\.water_filters FROM anon/);
 assert.match(migration, /Dokumentierte Filterspülungen bleiben unverändert\. Korrekturen werden gesondert protokolliert/);
 assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.tageswerk_correct_water_filter_flush/);
 assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.tageswerk_set_water_filter_active/);
 assert.match(migration, /REVOKE ALL ON FUNCTION public\.tageswerk_refresh_water_filter_last_flush/);
 assert.doesNotMatch(migration, /set_config\('tageswerk\.water_filter_status_change'/);
 assert.doesNotMatch(migration, /set_config\('tageswerk\.water_filter_last_flush_refresh'/);
 assert.match(pruefung, /Keine GUC-Autorisierung/);
 assert.match(pruefung, /Korrektur belässt Originale/);
 assert.match(pruefung, /Client ohne UPDATE auf active/);
 assert.match(pruefung, /kein tabellenweites UPDATE/);
 assert.match(pruefung, /aclexplode\(cls\.relacl\)/);
 assert.doesNotMatch(pruefung, /has_table_privilege\('authenticated', to_regclass\('public\.water_filters'\), 'UPDATE'\)/);
 assert.match(verhalten, /GUC setzt active nicht frei/);
 assert.match(verhalten, /Keine Lost-Update/);
});

test('Rechte-Diagnose und Hotfix sind vorbereitet', () => {
 const diagnose = readFileSync(new URL('../../tageswerk_3_5_8_water_filter_extensions_rechte_diagnose.sql', import.meta.url), 'utf8');
 const hotfix = readFileSync(new URL('../../tageswerk_3_5_8_water_filter_extensions_rechte_hotfix.sql', import.meta.url), 'utf8');
 assert.match(diagnose, /Lesende Diagnose/);
 assert.match(diagnose, /has_column_privilege/);
 assert.match(diagnose, /aclexplode/);
 assert.match(diagnose, /information_schema/);
 assert.doesNotMatch(diagnose, /\b(INSERT INTO|UPDATE |DELETE FROM|GRANT |REVOKE )\b/i);
 assert.match(hotfix, /Nicht ohne ausdrückliche Freigabe ausführen/);
 assert.match(hotfix, /REVOKE UPDATE ON TABLE public\.water_filters FROM PUBLIC/);
 assert.match(hotfix, /GRANT UPDATE \(name\) ON TABLE public\.water_filters TO authenticated/);
 assert.match(hotfix, /Hotfix unvollständig/);
});

test('last_flushed folgt der gültigen Fassung über Effective-Funktion', () => {
 assert.match(migration, /tageswerk_water_filter_flush_effective\(flush_row\.id\)/);
 assert.match(migration, /effective\.filter_id = p_filter_id/);
 assert.match(migration, /ORDER BY effective\.flushed_at DESC, effective\.recorded_at DESC, effective\.flush_id DESC/);
 assert.match(base, /last_flushed_at/);
 assert.match(base, /last_flushed_by/);
});

test('Prüfskripte decken Vorprüfung, Nachprüfung und Verhalten ab', () => {
 assert.match(vorpruefung, /Ausschließlich lesend/);
 assert.match(vorpruefung, /Erweiterungstabellen noch nicht vorhanden/);
 assert.match(pruefung, /Schreibt nichts/);
 assert.match(pruefung, /EXECUTE-Rechte/);
 assert.match(verhalten, /NICHT in der Produktivdatenbank/);
 assert.match(verhalten, /Mitarbeiter korrigiert nicht/);
 assert.match(verhalten, /Techniker korrigiert nicht/);
 assert.match(verhalten, /Originaleintrag unverändert/);
 assert.match(verhalten, /Mehrfachkorrektur möglich/);
 assert.match(verhalten, /Außerbetriebnahme/);
 assert.match(verhalten, /Statushistorie bleibt erhalten/);
 assert.match(verhalten, /Direkter active-UPDATE gesperrt/);
});

test('Oberflächenrechte trennen Erfassen, Lesen und Korrigieren', () => {
 assert.equal(canRecordWaterFilterFlush(facility, employee), true);
 assert.equal(canReadWaterFilterFlushHistory(facility, employee), false);
 assert.equal(canCorrectWaterFilterFlush(facility, employee), false);
 assert.equal(canManageWaterFilters(facility, employee), false);
 assert.equal(canReadWaterFilterStatusHistory(facility, employee), false);
 assert.equal(canReadWaterFilterFlushHistory(facility, technician), true);
 assert.equal(canCorrectWaterFilterFlush(facility, technician), false);
 assert.equal(canReadWaterFilterStatusHistory(facility, technician), false);
 assert.equal(canCorrectWaterFilterFlush(facility, manager), true);
 assert.equal(canReadWaterFilterStatusHistory(facility, manager), true);
 assert.equal(canCorrectWaterFilterFlush(facility, admin), true);
 assert.equal(canReadWaterFilterStatusHistory(facility, admin), true);
});

test('Entwürfe für Korrektur und Statuswechsel bleiben begrenzt', () => {
 assert.equal(waterFilterDraftError({poolId: 'p1', name: 'Sandfilter'}), '');
 assert.match(waterFilterFlushDraftError({filterId: 'f1', flushedAt: '2099-01-01T00:00:00.000Z'}, '2026-11-14T12:00:00.000Z'), /zukünftig/);
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
 assert.match(waterFilterStatusDraftError({active: false, reason: 'ab'}), /Begründung/);
 assert.equal(waterFilterStatusDraftError({active: false, reason: 'Wartung erforderlich'}), '');
 assert.equal(flushCorrectionMark({isCorrected: true}), 'Korrigiert');
 assert.equal(flushCorrectionMark({correctionCount: 0}), '');
});

test('Bundle und Store sind für Korrektur- und Statushistorie vorbereitet', () => {
 const empty = emptyOperations();
 assert.deepEqual(empty.waterFilters, []);
 assert.deepEqual(empty.waterFilterFlushes, []);
 assert.deepEqual(empty.waterFilterFlushCorrections, []);
 assert.deepEqual(empty.waterFilterStatusEvents, []);
 assert.match(store, /water_filter_status_events/);
 assert.match(store, /tageswerk_correct_water_filter_flush/);
 assert.match(store, /tageswerk_set_water_filter_active/);
 assert.match(store, /previousFilterId/);
 assert.match(store, /isCorrected/);
 assert.match(store, /originalFilterId/);
});
