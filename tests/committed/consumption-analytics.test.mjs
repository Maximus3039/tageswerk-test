import assert from 'node:assert/strict';
import test from 'node:test';
import {
 analyticsWindow,
 buildAnalytics,
 formatAnalyticsValue,
 formatDelta,
 percentChange,
 spikeFlags,
 sumPoints
} from '../../js/consumption-analytics.js';
import {thousandths} from '../../js/meters-domain.js';

const now = {y: 2026, m: 11, d: 14};

function row(partial) {
 return {
  facility_id: 'f1',
  parent_meter_id: null,
  counts_in_facility_total: true,
  estimated_value: null,
  ...partial
 };
}

test('Tages-, Monats- und Jahresfenster sind nachvollziehbar', () => {
 const day = analyticsWindow('day', now);
 assert.equal(day.from, '2026-11-14');
 assert.equal(day.compareFrom, '2026-11-13');
 assert.equal(day.grain, 'day');
 const month = analyticsWindow('month', now);
 assert.equal(month.from, '2026-10-16');
 assert.equal(month.to, '2026-11-14');
 assert.equal(month.compareTo, '2026-10-15');
 const year = analyticsWindow('year', now);
 assert.equal(year.from, '2026-01-01');
 assert.equal(year.compareFrom, '2025-01-01');
 assert.equal(year.grain, 'month');
});

test('Gesamtstrom zählt nur Betriebsgesamtzähler, nicht Unterzähler', () => {
 const analytics = buildAnalytics([
  row({medium: 'electricity', meter_id: 'ht', unit: 'kWh', bucket_start: '2026-11-14', measured_value: '100'}),
  row({medium: 'electricity', meter_id: 'nt', unit: 'kWh', bucket_start: '2026-11-14', measured_value: '40'}),
  row({
   medium: 'electricity', meter_id: 'sub', unit: 'kWh', bucket_start: '2026-11-14', measured_value: '999',
   parent_meter_id: 'ht', counts_in_facility_total: false
  })
 ], {medium: 'electricity', range: 'day', now});
 assert.equal(analytics.current.total, thousandths('140'));
 assert.equal(analytics.hiddenSubmeters, true);
 assert.equal(formatAnalyticsValue(analytics.current, 'kWh').includes('140') || analytics.unit === 'kWh', true);
});

test('Haupttarif einzeln auswertbar ohne Nebentarif', () => {
 const analytics = buildAnalytics([
  row({medium: 'electricity', meter_id: 'ht', unit: 'kWh', bucket_start: '2026-11-14', measured_value: '100'}),
  row({medium: 'electricity', meter_id: 'nt', unit: 'kWh', bucket_start: '2026-11-14', measured_value: '40'})
 ], {medium: 'electricity', meterId: 'ht', range: 'day', now});
 assert.equal(analytics.current.total, thousandths('100'));
});

test('Wasser, Fernwärme und Gas bleiben medienspezifisch', () => {
 for (const [medium, value, unit] of [
  ['water', '12.5', 'm3'],
  ['heat', '80', 'kWh'],
  ['gas', '22', 'm3']
 ]) {
  const analytics = buildAnalytics([
   row({medium, meter_id: medium, unit, bucket_start: '2026-11-14', measured_value: value}),
   row({medium: 'electricity', meter_id: 'ht', unit: 'kWh', bucket_start: '2026-11-14', measured_value: '999'})
  ], {medium, range: 'day', now});
  assert.equal(analytics.current.total, thousandths(value));
  assert.equal(analytics.unit, unit);
 }
});

test('Fehlende Messwerte und reine Schätzungen werden gekennzeichnet', () => {
 const analytics = buildAnalytics([
  row({medium: 'electricity', meter_id: 'ht', unit: 'kWh', bucket_start: '2026-11-14', measured_value: null, estimated_value: '8'}),
  row({medium: 'electricity', meter_id: 'ht', unit: 'kWh', bucket_start: '2026-11-13', measured_value: '10', estimated_value: null})
 ], {medium: 'electricity', range: 'month', now});
 assert.equal(analytics.current.kind, 'mixed');
 assert.match(analytics.qualityLabel, /Schätzung/);
 assert.equal(sumPoints([{invalid: true}]).kind, 'invalid');
 assert.equal(formatAnalyticsValue({kind: 'empty'}, 'kWh'), '—');
});

test('Monatsvergleich und Sprünge rechnen ohne Rohstände', () => {
 const rows = [];
 for (let day = 1; day <= 14; day += 1) {
  rows.push(row({
   medium: 'electricity', meter_id: 'ht', unit: 'kWh',
   bucket_start: `2026-11-${String(day).padStart(2, '0')}`,
   measured_value: day === 14 ? '30' : '10'
  }));
 }
 // Vorperiode des Monatsfensters: 2026-09-16 bis 2026-10-15
 for (let day = 16; day <= 30; day += 1) {
  rows.push(row({
   medium: 'electricity', meter_id: 'ht', unit: 'kWh',
   bucket_start: `2026-09-${day}`, measured_value: '5'
  }));
 }
 for (let day = 1; day <= 15; day += 1) {
  rows.push(row({
   medium: 'electricity', meter_id: 'ht', unit: 'kWh',
   bucket_start: `2026-10-${String(day).padStart(2, '0')}`, measured_value: '5'
  }));
 }
 const analytics = buildAnalytics(rows, {medium: 'electricity', range: 'month', now});
 assert.ok(analytics.delta != null);
 assert.equal(formatDelta(analytics.delta).tone, 'delta-up');
 assert.ok(spikeFlags(analytics.points).some(flag => flag.bucket === '2026-11-14'));
 assert.equal(percentChange(110n, 100n), 10);
});

test('Leere Perioden liefern keinen erfundenen Verbrauch', () => {
 const analytics = buildAnalytics([], {medium: 'gas', range: 'year', now});
 assert.equal(analytics.current.kind, 'empty');
 assert.equal(analytics.delta, null);
 assert.equal(formatDelta(null).text, 'kein Vergleich');
});
