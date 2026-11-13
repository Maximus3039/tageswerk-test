import assert from 'node:assert/strict';
import test from 'node:test';
import {
 addDays,
 chartMeters,
 dateKey,
 latestConsumption,
 measuredSummary,
 meterDraftError,
 nextReadingAt,
 readingDraftError,
 readingInsertPayload,
 readingScheduleStatus,
 thousandths,
 unitsForMedium
} from '../../js/meters-domain.js';
import {fetchFacilityMeters} from '../../js/meters-store.js';
import {
 clearFacilityMeters,
 loadFacilityMeters,
 membershipAllowsMeterAdmin,
 membershipAllowsMeterReading,
 renderFacilityMeters,
 resetMeterEditor,
 syncMeterEditor
} from '../../js/meters.js';

test('Fassade reicht Zähler-Schnittstellen unverändert weiter', () => {
 assert.equal(typeof membershipAllowsMeterAdmin, 'function');
 assert.equal(typeof membershipAllowsMeterReading, 'function');
 assert.equal(typeof fetchFacilityMeters, 'function');
 assert.equal(typeof loadFacilityMeters, 'function');
 assert.equal(typeof renderFacilityMeters, 'function');
 assert.equal(typeof clearFacilityMeters, 'function');
 assert.equal(typeof resetMeterEditor, 'function');
 assert.equal(typeof syncMeterEditor, 'function');
 assert.equal(typeof readingInsertPayload, 'function');
 assert.equal(typeof unitsForMedium, 'function');
});

test('Ablesevalidierung und Payload speichern nur den Stand', () => {
 assert.match(readingDraftError({reading_value: '12,3.4', reading_at: '2026-01-01T08:00'}), /Tausender/);
 assert.equal(readingDraftError({reading_value: '12,5', reading_at: '2026-01-01T08:00'}), '');
 const payload = readingInsertPayload('meter-1', {reading_value: '12,5', reading_at: '2026-01-01T08:00'});
 assert.equal(payload.reading_type, 'regular');
 assert.equal(payload.reading_value, '12.5');
 assert.equal('consumption_value' in payload, false);
});

test('Zählerentwurf prüft Einheit und Intervall', () => {
 assert.match(meterDraftError({label: '', medium: 'electricity', unit: 'kWh', interval_unit: 'month', interval_count: '1'}), /Bezeichnung/);
 assert.equal(meterDraftError({label: 'Haupt', medium: 'electricity', unit: 'kWh', interval_unit: 'month', interval_count: '1'}), '');
 assert.match(meterDraftError({label: 'Haupt', medium: 'electricity', unit: 'm3', interval_unit: 'month', interval_count: '1'}), /Einheit/);
});

test('Fälligkeit und Verbrauchszusammenfassung bleiben berechenbar', () => {
 const due = nextReadingAt('2026-01-15T10:00:00.000Z', 'month', 1);
 assert.equal(due.getFullYear(), 2026);
 assert.equal(due.getMonth(), 1);
 assert.equal(due.getDate(), 15);
 assert.equal(readingScheduleStatus(due, new Date(due.getTime() - 4 * 24 * 60 * 60 * 1000)), 'current');
 assert.equal(readingScheduleStatus(due, new Date(due.getTime() - 1000)), 'soon');
 assert.equal(readingScheduleStatus(due, new Date(due.getTime() + 1)), 'overdue');
 const latest = latestConsumption([
  {meter_id: 'a', reading_at: '2026-01-01T00:00:00.000Z', consumption_value: '1'},
  {meter_id: 'a', reading_at: '2026-02-01T00:00:00.000Z', consumption_value: '2'}
 ]);
 assert.equal(latest.get('a').consumption_value, '2');
 assert.equal(thousandths('1,5'), 1500n);
 assert.equal(measuredSummary([
  {is_main_meter: true, counts_in_facility_total: true, parent_meter_id: null, unit: 'kWh', consumption_value: '1.5'},
  {is_main_meter: true, counts_in_facility_total: true, parent_meter_id: null, unit: 'kWh', consumption_value: '0.5'}
 ]).total, 2000n);
 const chart = chartMeters([
  {meter_id: 'a', meter_label: 'A', unit: 'kWh', consumption_value: '1', period_end: '2026-01-02', reading_id: '2', is_main_meter: true, counts_in_facility_total: true, parent_meter_id: null},
  {meter_id: 'a', meter_label: 'A', unit: 'kWh', consumption_value: '2', period_end: '2026-01-01', reading_id: '1', is_main_meter: true, counts_in_facility_total: true, parent_meter_id: null}
 ]);
 assert.equal(chart[0].meters[0].total, 3000n);
 assert.equal(dateKey(addDays({y: 2026, m: 1, d: 1}, 1)), '2026-01-02');
});
