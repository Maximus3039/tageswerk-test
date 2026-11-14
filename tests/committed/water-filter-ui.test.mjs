import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
 canCorrectWaterFilterFlush,
 canManageWaterFilters,
 canReadWaterFilterFlushHistory,
 canReadWaterFilterStatusHistory,
 canRecordWaterFilterFlush,
 filterFlushHistoryRows,
 filterStatusHistoryRows,
 filterStatusLabel,
 filterStatusTone,
 filtersForPool,
 flushHistoryPeriodBounds,
 waterFilterFlushDraftError,
 waterFilterStatusDraftError
} from '../../js/water-filters.js';

const ui = readFileSync(new URL('../../js/operations-ui-water.js', import.meta.url), 'utf8');
const shared = readFileSync(new URL('../../js/operations-ui-shared.js', import.meta.url), 'utf8');
const store = readFileSync(new URL('../../js/operations-store.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../css/app.css', import.meta.url), 'utf8');
const domain = readFileSync(new URL('../../js/water-filters.js', import.meta.url), 'utf8');

const facility = {id: 'facility-1', organization_id: 'org-1'};
const employee = [{user_id: 'e1', organization_id: 'org-1', facility_id: 'facility-1', role: 'employee', is_active: true}];
const technician = [{user_id: 't1', organization_id: 'org-1', facility_id: 'facility-1', role: 'technician', is_active: true}];
const manager = [{user_id: 'm1', organization_id: 'org-1', facility_id: 'facility-1', role: 'facility_manager', is_active: true}];
const admin = [{user_id: 'a1', organization_id: 'org-1', facility_id: null, role: 'company_admin', is_active: true}];

test('Filter-UI deckt Übersicht, Erfassung, Historie, Korrektur und Statushistorie ab', () => {
 assert.match(ui, /function renderWaterFilters\(/);
 assert.match(ui, /Filterübersicht/);
 assert.match(ui, /Spülung dokumentieren/);
 assert.match(ui, /Spülhistorie/);
 assert.match(ui, /Spülung korrigieren/);
 assert.match(ui, /Statushistorie/);
 assert.match(ui, /Filter hinzufügen/);
 assert.match(ui, /Außer Betrieb/);
 assert.match(ui, /Wieder in Betrieb/);
 assert.match(ui, /Umbenennen/);
 assert.match(ui, /Begründung Statuswechsel/);
 assert.match(ui, /saveWaterFilterActive\(/);
 assert.match(ui, /saveWaterFilterFlush\(/);
 assert.match(ui, /saveWaterFilterFlushCorrection\(/);
 assert.match(ui, /waterFilterFlushDraftError\(/);
 assert.match(ui, /waterFilterFlushCorrectionDraftError\(/);
 assert.match(ui, /waterFilterStatusDraftError\(/);
 assert.match(ui, /filterFlushHistoryRows\(/);
 assert.match(ui, /filterStatusHistoryRows\(/);
 assert.match(ui, /opsUi\.flushHistoryPoolId/);
 assert.match(ui, /opsUi\.statusHistoryFilterId/);
 assert.match(ui, /is-corrected/);
 assert.match(ui, /Bereits korrigiert/);
 assert.match(ui, /Originaleintrag bleibt unverändert/);
});

test('Rollenabhängige Darstellung und Speicherung bleiben getrennt', () => {
 assert.equal(canRecordWaterFilterFlush(facility, employee), true);
 assert.equal(canReadWaterFilterFlushHistory(facility, employee), false);
 assert.equal(canCorrectWaterFilterFlush(facility, employee), false);
 assert.equal(canManageWaterFilters(facility, employee), false);
 assert.equal(canReadWaterFilterStatusHistory(facility, employee), false);

 assert.equal(canRecordWaterFilterFlush(facility, technician), true);
 assert.equal(canReadWaterFilterFlushHistory(facility, technician), true);
 assert.equal(canCorrectWaterFilterFlush(facility, technician), false);
 assert.equal(canManageWaterFilters(facility, technician), false);
 assert.equal(canReadWaterFilterStatusHistory(facility, technician), false);

 assert.equal(canManageWaterFilters(facility, manager), true);
 assert.equal(canCorrectWaterFilterFlush(facility, manager), true);
 assert.equal(canReadWaterFilterStatusHistory(facility, manager), true);
 assert.equal(canCorrectWaterFilterFlush(facility, admin), true);
 assert.equal(canReadWaterFilterStatusHistory(facility, admin), true);

 assert.match(ui, /const manage = canManageWaterFilters/);
 assert.match(ui, /const record = canRecordWaterFilterFlush/);
 assert.match(ui, /const history = canReadWaterFilterFlushHistory/);
 assert.match(ui, /const correct = canCorrectWaterFilterFlush/);
 assert.match(ui, /const statusHistory = canReadWaterFilterStatusHistory/);
 assert.match(ui, /if \(manage\)/);
 assert.match(ui, /if \(record\)/);
 assert.match(ui, /if \(history\)/);
 assert.match(ui, /if \(correct && opsUi\.selectedFlushId\)/);
 assert.match(ui, /if \(statusHistory\)/);
 assert.match(store, /if \(!canManageWaterFilters/);
 assert.match(store, /if \(!canRecordWaterFilterFlush/);
 assert.match(store, /if \(!canCorrectWaterFilterFlush/);
 assert.match(store, /tageswerk_set_water_filter_active/);
 assert.match(store, /tageswerk_correct_water_filter_flush/);
 assert.doesNotMatch(store, /db\.update\('water_filter_flushes'/);
 assert.doesNotMatch(ui, /db\.update\('water_filter_flushes'/);
 assert.doesNotMatch(domain, /UPDATE water_filter_flushes/i);
});

test('Historienfilter und Statuskennzeichnung arbeiten lokal korrekt', () => {
 const flushes = [
  {id: '1', facilityId: 'facility-1', poolId: 'p1', filterId: 'f1', flushedAt: '2026-11-10T10:00:00.000Z', note: 'a'},
  {id: '2', facilityId: 'facility-1', poolId: 'p2', filterId: 'f2', flushedAt: '2026-11-14T08:00:00.000Z', note: 'b', isCorrected: true},
  {id: '3', facilityId: 'facility-2', poolId: 'p3', filterId: 'f3', flushedAt: '2026-11-14T09:00:00.000Z', note: 'c'}
 ];
 assert.deepEqual(filterFlushHistoryRows(flushes, {
  facilityId: 'facility-1',
  poolId: 'p2',
  from: '2026-11-14',
  to: '2026-11-14'
 }).map(item => item.id), ['2']);
 assert.deepEqual(filterFlushHistoryRows(flushes, {
  facilityId: 'facility-1',
  filterId: 'f1',
  from: '2026-11-01',
  to: '2026-11-30'
 }).map(item => item.id), ['1']);

 const events = [
  {id: 'e1', facilityId: 'facility-1', filterId: 'f1', changedAt: '2026-11-13T12:00:00.000Z', oldActive: true, newActive: false, reason: 'Wartung'},
  {id: 'e2', facilityId: 'facility-1', filterId: 'f2', changedAt: '2026-11-14T12:00:00.000Z', oldActive: false, newActive: true, reason: 'Fertig'},
  {id: 'e3', facilityId: 'facility-2', filterId: 'f9', changedAt: '2026-11-14T13:00:00.000Z', oldActive: true, newActive: false, reason: 'fremd'}
 ];
 assert.deepEqual(filterStatusHistoryRows(events, {facilityId: 'facility-1'}).map(item => item.id), ['e2', 'e1']);
 assert.deepEqual(filterStatusHistoryRows(events, {facilityId: 'facility-1', filterId: 'f1'}).map(item => item.id), ['e1']);

 const active = {name: 'Sand', active: true};
 const inactive = {name: 'Kies', active: false};
 assert.equal(filterStatusLabel(active), 'In Betrieb');
 assert.equal(filterStatusLabel(inactive), 'Außer Betrieb');
 assert.equal(filterStatusTone(active), 'is-active');
 assert.equal(filterStatusTone(inactive), 'is-inactive');
 assert.deepEqual(filtersForPool([
  {id: 'a', poolId: 'p1', name: 'B', active: true},
  {id: 'b', poolId: 'p1', name: 'A', active: false},
  {id: 'c', poolId: 'p2', name: 'C', active: true}
 ], 'p1').map(item => item.id), ['a']);
 assert.deepEqual(filtersForPool([
  {id: 'a', poolId: 'p1', name: 'B', active: true},
  {id: 'b', poolId: 'p1', name: 'A', active: false}
 ], 'p1', {includeInactive: true}).map(item => item.id), ['b', 'a']);

 const bounds = flushHistoryPeriodBounds('7', new Date('2026-11-14T12:00:00.000Z'));
 assert.equal(bounds.to, '2026-11-14');
 assert.equal(bounds.from, '2026-11-08');
 assert.match(waterFilterFlushDraftError({
  filterId: 'f1',
  flushedAt: '2026-11-12T11:00:00.000Z'
 }, new Date('2026-11-14T12:00:00.000Z')), /24 Stunden/);
 assert.match(waterFilterStatusDraftError({active: true, reason: 'ok'}), /Begründung/);
});

test('Doppelklick-Schutz und Fehlerbehandlung bleiben in Speichern und Oberfläche', () => {
 assert.match(shared, /if \(opsUi\.saving\) return null;/);
 assert.match(shared, /opsUi\.saving = true;/);
 assert.match(shared, /if \(node\.disabled \|\| opsUi\.saving\) return;/);
 assert.match(shared, /node\.disabled = true;/);
 assert.match(shared, /Gespeichert/);
 assert.match(ui, /const result = await commit\(\(\) => saveWaterFilterFlush/);
 assert.match(ui, /say\('error', error\)/);
 assert.match(store, /return denied\(bundle, error\)/);
 assert.match(store, /Bitte eine Begründung mit 3 bis 2000 Zeichen angeben/);
 assert.match(store, /Nur Betriebsleitung und Geschäftsführung korrigieren Spülprotokolle/);
});

test('Mobile-First-Styles für Filterspülungen sind vorhanden', () => {
 assert.match(css, /\.water-filter-cards\{/);
 assert.match(css, /\.water-filter-card\.is-inactive/);
 assert.match(css, /\.water-filter-card \.badge\.active/);
 assert.match(css, /\.water-filter-card \.badge\.inactive/);
 assert.match(css, /\.water-filter-capture/);
 assert.match(css, /\.water-filter-status-card/);
 assert.match(css, /@media\(max-width:850px\)[\s\S]*\.water-filter-cards\{grid-template-columns:1fr\}/);
 assert.match(css, /@media\(max-width:850px\)[\s\S]*\.water-filter-capture button/);
 assert.match(css, /min-height:52px/);
});
