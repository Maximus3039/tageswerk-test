import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {membershipAllowsMeterAdmin, membershipAllowsMeterReading, readingInsertPayload} from '../../js/meters-domain.js';
import {
 existingReadingDates,
 historicalReadingDraftError,
 historicalReadingPayload,
 mergeMonthlySources,
 monthlyConsumptionDraftError,
 monthlyCorrectionDraftError,
 monthlyCorrectionPayload,
 monthlyInsertPayload,
 monthlyKey,
 historicalMonthAverageLabel,
 historicalYearKpiLabel,
 monthlyStats,
 yearOverYear
} from '../../js/historical-consumption.js';
import {chosenConsumptionFacilityId, consumptionFacilitiesAvailable} from '../../js/dashboard-facility.js';

const sql = readFileSync(new URL('../../tageswerk_3_7_0_manual_monthly_consumption.sql', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../../js/historical-consumption-ui.js', import.meta.url), 'utf8');
const importStore = readFileSync(new URL('../../js/meter-import-store.js', import.meta.url), 'utf8');
const metersUi = readFileSync(new URL('../../js/meters-ui.js', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../../js/dashboard.js', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../../js/mobile-ux.js', import.meta.url), 'utf8');

const jan = {year: 2025, month: 1, unit: 'kWh', total: 12500000n, source: 'monthly', incomplete: false};
const feb = {year: 2025, month: 2, unit: 'kWh', total: 11700000n, source: 'monthly', incomplete: false};
const mar = {year: 2025, month: 3, unit: 'kWh', total: 12900000n, source: 'monthly', incomplete: false};

test('SQL trennt Monatsverbräuche von Ablesungen und bleibt INVOKER', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.utility_monthly_consumption/);
  assert.match(sql, /SECURITY INVOKER/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /company_admin/);
  assert.match(sql, /facility_manager/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.utility_monthly_consumption FROM PUBLIC, anon/);
  assert.doesNotMatch(sql, /GRANT DELETE/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.tageswerk_commit_historical_import/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.tageswerk_prepare_reading/);
  assert.match(sql, /Manuelle Monatsverbräuche werden nicht gelöscht/);
  assert.match(sql, /utility_monthly_consumption_revisions/);
  assert.match(sql, /Bitte einen Korrekturgrund/);
});

test('Oberfläche bietet historische Stände und Monate ohne Excel', () => {
  assert.match(ui, /Historische Werte erfassen/);
  assert.match(ui, /Historischer Zählerstand/);
  assert.match(ui, /Historischer Monatsverbrauch/);
  assert.match(ui, /Korrekturgrund/);
  assert.match(ui, /historicalYearKpiLabel/);
  assert.doesNotMatch(ui, /CREATE OR REPLACE FUNCTION public\.tageswerk_commit_historical_import/);
  assert.doesNotMatch(ui, /meter-import-store/);
  assert.doesNotMatch(ui, /HISTORICAL_COMMIT/);
  assert.match(importStore, /HISTORICAL_COMMIT_ENABLED=false/);
  assert.match(mobile, /Historische Werte erfassen/);
});

test('Historischer Stand speichert den Stand und keinen Verbrauch', () => {
  const now = {y: 2026, m: 11, d: 21};
  assert.match(historicalReadingDraftError({meterId: 'm1', reading_date: '2026-11-22', reading_value: '10'}, {now}), /Vergangenheit/);
  assert.match(historicalReadingDraftError({meterId: 'm1', reading_date: '2026-11-20', reading_value: '10'}, {now, existingDates: ['2026-11-20']}), /bereits eine Ablesung/);
  assert.equal(historicalReadingDraftError({meterId: 'm1', reading_date: '2025-01-15', reading_value: '100,5'}, {now}), '');
  const payload = historicalReadingPayload('m1', {reading_date: '2025-01-15', reading_value: '100,5', note: 'Altbestand'});
  assert.equal(payload.reading_type, 'regular');
  assert.equal(payload.reading_value, '100.5');
  assert.equal(payload.note, 'Altbestand');
  assert.equal('consumption_value' in payload, false);
  assert.equal('consumption_value' in readingInsertPayload('m1', {reading_value: '1', reading_at: '2025-01-15T12:00'}), false);
});

test('Monatsverbrauch bleibt getrennt und ohne Dublette', () => {
  const now = {y: 2026, m: 11, d: 21};
  const draft = {
    facilityId: 'fac',
    medium: 'electricity',
    unit: 'kWh',
    year: '2025',
    month: '1',
    consumption_value: '12500'
  };
  assert.equal(monthlyConsumptionDraftError(draft, {now}), '');
  assert.match(monthlyConsumptionDraftError({...draft, year: '2026', month: '12'}, {now}), /Vergangenheit/);
  const key = monthlyKey({...draft, meterId: ''});
  assert.match(monthlyConsumptionDraftError(draft, {now, existingKeys: [key]}), /bereits ein manueller Verbrauch/);
  const payload = monthlyInsertPayload(draft);
  assert.equal(payload.meter_id, null);
  assert.equal(payload.consumption_value, '12500');
  assert.equal(payload.year, 2025);
  assert.equal(payload.month, 1);
});

test('Auswertung ignoriert fehlende Monate und addiert Quellen nicht', () => {
  const months = mergeMonthlySources({
    year: 2025,
    unit: 'kWh',
    calendarRows: [{bucket_start: '2025-01-01', measured_value: '100', unit: 'kWh'}],
    monthlyRows: [
      {year: 2025, month: 1, unit: 'kWh', consumption_value: '12500', meter_id: null},
      {year: 2025, month: 2, unit: 'kWh', consumption_value: '11700', meter_id: null},
      {year: 2025, month: 3, unit: 'kWh', consumption_value: '12900', meter_id: null}
    ]
  });
  assert.equal(months[0].source, 'readings-partial');
  assert.equal(months[0].incomplete, true);
  assert.equal(months[0].total, 100000n);
  assert.equal(months[1].source, 'monthly');
  assert.equal(months[1].total, 11700000n);
  assert.equal(months[3].source, 'missing');
  assert.equal(months[3].total, null);
  const fullJanuary = Array.from({length: 31}, (_item, index) => ({
    bucket_start: `2025-01-${String(index + 1).padStart(2, '0')}`,
    measured_value: '10',
    unit: 'kWh'
  }));
  const complete = mergeMonthlySources({
    year: 2025,
    unit: 'kWh',
    calendarRows: fullJanuary,
    monthlyRows: [{year: 2025, month: 1, unit: 'kWh', consumption_value: '12500', meter_id: null}]
  });
  assert.equal(complete[0].source, 'readings');
  assert.equal(complete[0].incomplete, false);
  const stats = monthlyStats([jan, feb, mar]);
  assert.equal(stats.covered, 3);
  assert.equal(stats.incomplete, true);
  assert.equal(stats.yearTotal, 37100000n);
  assert.equal(stats.avgMonth, 12366666n);
  assert.equal(historicalYearKpiLabel(stats), 'Verbrauch 3 von 12 Monaten');
  assert.equal(historicalMonthAverageLabel(stats), 'Ø erfasster Monat');
  assert.match(ui, /Ø abgedeckter Tag/);
  assert.doesNotMatch(ui, /addKpi\('Jahresverbrauch'/);
  const yoy = yearOverYear([jan, feb, mar], [
    {year: 2024, month: 1, total: 12000000n},
    {year: 2024, month: 2, total: 11000000n}
  ]);
  assert.equal(yoy.months, 2);
  assert.equal(yoy.incomplete, true);
});

test('Korrektur braucht Grund und ändert nicht still', () => {
  const current = {id: 'row-1', consumption_value: '12500', note: 'TW370-HIST'};
  assert.match(monthlyCorrectionDraftError({consumption_value: '12500', note: 'TW370-HIST', correction_reason: 'x'}, current), /Korrekturgrund/);
  assert.match(monthlyCorrectionDraftError({consumption_value: '12500', note: 'TW370-HIST', correction_reason: 'Testdaten angepasst'}, current), /ändern/);
  assert.equal(monthlyCorrectionDraftError({consumption_value: '12400', note: 'TW370-HIST', correction_reason: 'Testdaten angepasst'}, current), '');
  const payload = monthlyCorrectionPayload({consumption_value: '12.400', note: 'korrigiert', correction_reason: 'Testdaten angepasst'});
  assert.equal(payload.consumption_value, '12.400');
  assert.equal(payload.correction_reason, 'Testdaten angepasst');
});

test('Zählerwechsel und Rücksetzung bleiben eigene Ablesetage', () => {
  const dates = existingReadingDates([
    {meter_id: 'iso', reading_at: '2026-11-21T14:22:00Z', reading_type: 'regular'},
    {meter_id: 'iso', reading_at: '2026-11-21T14:22:00Z', reading_type: 'reset'},
    {meter_id: 'iso', reading_at: '2026-11-21T14:22:00Z', reading_type: 'correction'},
    {meter_id: 'other', reading_at: '2025-01-01T12:00:00Z', reading_type: 'regular'}
  ], 'iso');
  assert.ok(dates.includes('2026-11-21'));
  assert.equal(dates.includes('2025-01-01'), false);
});

test('Betriebsauswahl der Verbrauchskarte folgt den zugeordneten Betrieben', () => {
  const nord = {id: 'a1000000-0000-4000-8000-000000000011', name: 'Alpha Nord'};
  const sued = {id: 'sued', name: 'Sued'};
  assert.equal(consumptionFacilitiesAvailable([]), false);
  assert.equal(consumptionFacilitiesAvailable([nord]), true);
  assert.equal(chosenConsumptionFacilityId([nord], {dashboard: 'all'}), nord.id);
  assert.equal(chosenConsumptionFacilityId([nord, sued], {dashboard: 'sued'}), 'sued');
  assert.equal(chosenConsumptionFacilityId([nord, sued], {previous: 'sued', touched: true, dashboard: nord.id}), 'sued');
  assert.equal(chosenConsumptionFacilityId([nord], {dashboard: 'fremd'}), nord.id);
  assert.match(dashboard, /sel\.replaceChildren\(\.\.\.options\)/);
  assert.match(dashboard, /hideFromAssistive\(empty, available\)/);
  assert.match(dashboard, /empty\.replaceChildren\(\)/);
  assert.match(metersUi, /state\.accessibleFacilities/);
  assert.match(metersUi, /if\(!facility\)return;/);
  const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const emptyMarkup = indexHtml.match(/id="consumption-empty"[^>]*>[\s\S]*?<\/div>/)[0];
  assert.doesNotMatch(emptyMarkup, /Für dein Konto sind keine Betriebe freigegeben/);
  const utils = readFileSync(new URL('../../js/utils.js', import.meta.url), 'utf8');
  assert.match(utils, /export function hideFromAssistive/);
  assert.match(utils, /export function setHidden/);
  assert.match(utils, /export function syncHiddenDialogs/);
  const operationsSpec = readFileSync(new URL('../ui/operations.spec.js', import.meta.url), 'utf8');
  assert.match(operationsSpec, /show\('view-more', true\)/);
  assert.match(operationsSpec, /show\('operations-card', true\)/);
  assert.doesNotMatch(operationsSpec, /querySelector\('#view-more'\)\.classList\.remove\('hidden'\)/);
});

test('Mitarbeiter lesen weiter, Leitung erfasst historisch', () => {
  const facility = {id: 'fac', organization_id: 'org'};
  const manager = [{user_id: 'u1', organization_id: 'org', facility_id: 'fac', role: 'facility_manager', is_active: true}];
  const employee = [{user_id: 'u2', organization_id: 'org', facility_id: 'fac', role: 'employee', is_active: true}];
  assert.equal(membershipAllowsMeterAdmin(facility, manager, 'u1'), true);
  assert.equal(membershipAllowsMeterAdmin(facility, employee, 'u2'), false);
  assert.equal(membershipAllowsMeterReading(facility, employee, 'u2'), true);
});
