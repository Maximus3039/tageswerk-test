import assert from 'node:assert/strict';
import test from 'node:test';
import {compareCalendarDay} from '../../js/operations.js';
import {
 allowedFacilityIds,
 facilityTileConfig,
 gridColumns
} from '../../js/dashboard-layouts.js';
import {comparableYearToDate, revenuePerVisitor, summarizeComparableWindow, yearEndForecast} from '../../js/statistics.js';
import {applyDuplicatePolicy, defaultColumnMap, mapImportRows, parseCsvTables, parseGermanDate, parseGermanNumber, parsePdfTables, VISITOR_IMPORT_LIMIT} from '../../js/visitor-import.js';
import {defectStatistics, isOverdueDefect} from '../../js/defects.js';

test('Wochentagsvergleich bleibt 364 Tage', () => {
 assert.equal(compareCalendarDay('2026-11-21'), '2025-11-22');
 const window = comparableYearToDate('2026-11-21');
 assert.equal(window.priorTo, compareCalendarDay('2026-11-21'));
});

test('Prognose nutzt Vorjahres-Wochentage und erfindet keine Werte', () => {
 const records = [];
 for (let day = 1; day <= 20; day += 1) {
  records.push({day: `2025-11-${String(day).padStart(2, '0')}`, visitors: 100 + day});
 }
 const poor = yearEndForecast(records, '2026-11-21', 'visitors');
 assert.equal(poor.state, 'insufficient');
 const dense = [];
 for (let month = 1; month <= 12; month += 1) {
  for (let day = 1; day <= 28; day += 1) {
   const stamp = `2025-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
   dense.push({day: stamp, visitors: 50});
   if (month <= 11) dense.push({day: stamp.replace('2025', '2026'), visitors: 60});
  }
 }
 const forecast = yearEndForecast(dense, '2026-11-21', 'visitors');
 assert.ok(['ok', 'partial'].includes(forecast.state));
 assert.equal(forecast.method, 'weekday-364');
 assert.ok(forecast.actual > 0);
 assert.ok(forecast.rest > 0);
 assert.equal(revenuePerVisitor(10, 1000).cents, 100);
 assert.equal(revenuePerVisitor(0, 1000).state, 'undefined');
});

test('Besucherimport erkennt deutsche Formate und Dubletten', () => {
 assert.equal(parseGermanDate('21.11.2026'), '2026-11-21');
 assert.equal(parseGermanNumber('1.250').value, 1250);
 assert.equal(parseGermanNumber('12.450,75').value, 12450.75);
 const csv = parseCsvTables('Datum;Besucher;Umsatz\n21.11.2026;1.250;12.450,75');
 assert.equal(csv.ok, true);
 const map = defaultColumnMap(csv.sheets[0].headers);
 const mapped = mapImportRows(csv.sheets[0], map, new Set(['2026-11-21']));
 assert.equal(mapped.rows[0].duplicate, true);
 assert.equal(applyDuplicatePolicy(mapped.rows, 'skip')[0].action, 'skip');
 assert.equal(applyDuplicatePolicy(mapped.rows, 'update')[0].action, 'update');
});

test('Vergleichsfenster zählen fehlende Tage nicht als null', () => {
 const rows = [
  {day: '2026-11-01', visitors: 10, priorVisitors: 8},
  {day: '2026-11-03', visitors: 12, priorVisitors: 9}
 ];
 const window = summarizeComparableWindow(rows, '2026-11-01', '2026-11-03', 'visitors', 'priorVisitors');
 assert.equal(window.state, 'incomplete');
 assert.equal(window.current, 22);
 assert.equal(window.missingCurrent, 1);
});

test('Import lehnt überlange Dateien und leere PDFs ab', () => {
 const rows = Array.from({length: VISITOR_IMPORT_LIMIT + 1}, (_item, index) => ({Datum: `01.01.2025`, Besucher: String(index)}));
 const tooBig = mapImportRows({headers: ['Datum', 'Besucher'], rows}, defaultColumnMap(['Datum', 'Besucher']), new Set());
 assert.equal(tooBig.ok, false);
 const pdf = parsePdfTables('');
 assert.equal(pdf.ok, false);
 const digital = parsePdfTables('21.11.2026 1.250 12.450,75');
 assert.equal(digital.ok, true);
});

test('Dashboard-Kacheln filtern auf berechtigte Betriebe', () => {
 const facilities = [{id: 'a'}, {id: 'b'}];
 assert.deepEqual(allowedFacilityIds(['a', 'x'], facilities), ['a']);
 assert.equal(gridColumns(4, 2), 2);
 assert.equal(facilityTileConfig({preset: 'visitors'}, 'a').showDefects, false);
});

test('Mängelstatistik zählt Überfälligkeit ohne Statusänderung', () => {
 const now = Date.parse('2026-11-21T12:00:00Z');
 const rows = [
  {status: 'open', created_at: '2026-11-20T00:00:00Z', resolution_due_at: '2026-11-20T00:00:00Z', title: 'Pumpe'},
  {status: 'resolved', created_at: '2026-10-01T00:00:00Z', resolved_at: '2026-11-01T00:00:00Z', title: 'Pumpe'},
  {status: 'resolved', created_at: '2026-10-01T00:00:00Z', resolved_at: '2026-11-02T00:00:00Z', title: 'Pumpe'}
 ];
 assert.equal(isOverdueDefect(rows[0], now), true);
 const stats = defectStatistics(rows, now);
 assert.equal(stats.open, 1);
 assert.equal(stats.overdue, 1);
 assert.equal(stats.recurring[0].count, 3);
});
