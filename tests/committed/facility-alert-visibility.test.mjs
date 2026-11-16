import assert from 'node:assert/strict';
import test from 'node:test';
import {
 acknowledgeTemperatureAlert,
 alertIsHidden,
 createTemperaturePoint,
 createWaterPool,
 facilityNotices,
 hideFacilityAlert,
 hideOldFacilityAlerts,
 recordTemperature,
 recordWaterCheck,
 recordWaterMeasure,
 restoreFacilityAlert,
 updateWaterParameter
} from '../../js/operations-controls.js';
import {emptyOperations, operationMetrics} from '../../js/operations.js';
import {
 loadOperations,
 saveFacilityAlertVisibility,
 saveOldFacilityAlertHides,
 saveTemperatureAcknowledgement
} from '../../js/operations-store.js';

const now = '2026-11-16T12:00:00.000Z';
const facility = {id: 'fac-a', organization_id: 'org-a', name: 'Bad'};
const second = {id: 'fac-b', organization_id: 'org-a', name: 'Strand'};
const foreign = {id: 'fac-c', organization_id: 'org-b', name: 'Fremd'};
const context = {facilities: [facility, second], names: {'employee-1': 'Mia', 'manager-1': 'Lea', 'admin-1': 'Kim'}};

function membership(role, target = facility, active = true) {
 return {organization_id: target.organization_id, facility_id: role === 'company_admin' ? null : target.id, role, is_active: active};
}

const employee = {userId: 'employee-1', name: 'Mia', memberships: [membership('employee')]};
const technician = {userId: 'technician-1', name: 'Timo', memberships: [membership('technician')]};
const manager = {userId: 'manager-1', name: 'Lea', memberships: [membership('facility_manager')]};
const otherManager = {userId: 'manager-2', name: 'Nia', memberships: [membership('facility_manager', second)]};
const admin = {userId: 'admin-1', name: 'Kim', memberships: [membership('company_admin')]};
const foreignAdmin = {userId: 'admin-9', name: 'Ole', memberships: [membership('company_admin', foreign)]};

function hygieneValues(overrides = {}) {
 return {
  free_chlorine: '0.50',
  combined_chlorine: '0.20',
  ph: '7.20',
  temperature: '28.0',
  ...overrides
 };
}

function withLimits(bundle, poolId, actor) {
 const parameter = bundle.waterPoolParameters.find(item => item.poolId === poolId && item.parameterCode === 'ph');
 return updateWaterParameter(bundle, parameter.id, {minValue: '6.80', maxValue: '7.20', required: true, active: true}, actor);
}

function memoryDb(options = {}) {
 const rows = options.rows || {
  daily_reports: [],
  daily_report_revisions: [],
  daily_report_defects: [],
  inspection_templates: [],
  inspection_points: [],
  inspection_runs: [],
  inspection_results: [],
  assets: [],
  maintenance_logs: [],
  asset_defects: [],
  procurement_requests: [],
  temperature_points: [],
  temperature_readings: [],
  temperature_alerts: [],
  facility_alert_visibility: []
 };
 return {
  rows,
  async select(table) {
   if (options.missingHides && table === 'facility_alert_visibility') {
    return {data: null, error: {code: 'PGRST205', message: 'Could not find the table in the schema cache'}};
   }
   return {data: (rows[table] || []).map(row => ({...row})), error: null};
  },
  async insert(table, row) {
   if (!rows[table]) rows[table] = [];
   const saved = {
    id: `${table}-${rows[table].length + 1}`,
    organization_id: row.facility_id === foreign.id ? foreign.organization_id : facility.organization_id,
    acted_by: options.userId,
    acted_at: now,
    created_by: options.userId,
    created_at: now,
    recorded_by: options.userId,
    recorded_at: now,
    status: 'open',
    ...row
   };
   rows[table].push(saved);
   return {data: {...saved}, error: null};
  },
  async update(table, id, patch) {
   const current = rows[table].find(item => item.id === id);
   Object.assign(current, patch, {acknowledged_by: options.userId, acknowledged_at: now});
   return {data: {...current}, error: null};
  },
  async rpc() {
   return {data: null, error: {code: '42883', message: 'function does not exist'}};
  }
 };
}

test('Ausblenden gilt betriebsweit und bleibt den Leitungsrollen vorbehalten', () => {
 const point = createTemperaturePoint(emptyOperations(), {facility, name: 'Vorlauf', location: 'Technik', minimum: '24', maximum: '28'}, manager, now);
 const hot = recordTemperature(point.bundle, point.point.id, {value: '31'}, employee, now);
 assert.equal(hot.alert.status, 'open');
 assert.equal(hideFacilityAlert(hot.bundle, 'temperature', hot.alert.id, employee, now).ok, false);
 assert.equal(hideFacilityAlert(hot.bundle, 'temperature', hot.alert.id, technician, now).ok, false);
 assert.equal(hideFacilityAlert(hot.bundle, 'temperature', hot.alert.id, otherManager, now).ok, false);
 assert.equal(hideFacilityAlert(hot.bundle, 'temperature', hot.alert.id, foreignAdmin, now).ok, false);
 const hidden = hideFacilityAlert(hot.bundle, 'temperature', hot.alert.id, manager, now);
 assert.equal(hidden.ok, true);
 assert.equal(hidden.alert.status, 'open');
 assert.equal(alertIsHidden(hidden.bundle, 'temperature', hot.alert.id), true);
 assert.equal(hidden.event.actedBy, manager.userId);
 const asEmployee = alertIsHidden(hidden.bundle, 'temperature', hot.alert.id);
 assert.equal(asEmployee, true);
 const restored = restoreFacilityAlert(hidden.bundle, 'temperature', hot.alert.id, admin, '2026-11-16T13:00:00.000Z');
 assert.equal(restored.ok, true);
 assert.equal(alertIsHidden(restored.bundle, 'temperature', hot.alert.id), false);
 assert.equal(restored.bundle.temperatureAlerts.find(item => item.id === hot.alert.id).status, 'open');
 assert.equal(restoreFacilityAlert(restored.bundle, 'temperature', hot.alert.id, employee, now).ok, false);
});

test('Neue Grenzwertverletzung bleibt sichtbar, alte Sammelausblendung ändert Messung und Status nicht', () => {
 const point = createTemperaturePoint(emptyOperations(), {facility, name: 'Vorlauf', location: 'Technik', minimum: '24', maximum: '28'}, manager, now);
 const oldHot = recordTemperature(point.bundle, point.point.id, {value: '31'}, employee, '2026-10-01T10:00:00.000Z');
 const recent = recordTemperature(oldHot.bundle, point.point.id, {value: '32'}, employee, now);
 const pool = createWaterPool(recent.bundle, {facility, name: 'Schwimmer', scheduleMode: 'daily'}, manager, now);
 const limited = withLimits(pool.bundle, pool.pool.id, manager);
 const waterOld = recordWaterCheck(limited.bundle, pool.pool.id, {values: hygieneValues({ph: '7.80'})}, employee, '2026-10-02T10:00:00.000Z');
 const bulk = hideOldFacilityAlerts(waterOld.bundle, facility, 30, manager, now);
 assert.equal(bulk.ok, true);
 assert.equal(alertIsHidden(bulk.bundle, 'temperature', oldHot.alert.id), true);
 assert.equal(alertIsHidden(bulk.bundle, 'water', waterOld.alerts[0].id), true);
 assert.equal(alertIsHidden(bulk.bundle, 'temperature', recent.alert.id), false);
 const fresh = recordTemperature(bulk.bundle, point.point.id, {value: '33'}, employee, '2026-11-16T14:00:00.000Z');
 assert.equal(fresh.alert.status, 'open');
 assert.equal(alertIsHidden(fresh.bundle, 'temperature', fresh.alert.id), false);
 const acknowledged = acknowledgeTemperatureAlert(fresh.bundle, oldHot.alert.id, 'Zur Kenntnis genommen', employee, now);
 assert.equal(acknowledged.ok, true);
 assert.equal(acknowledged.alert.status, 'acknowledged');
 assert.equal(alertIsHidden(acknowledged.bundle, 'temperature', oldHot.alert.id), true);
 const measured = recordWaterMeasure(acknowledged.bundle, waterOld.alerts[0].id, 'Frischwasser zugegeben', employee, now);
 assert.equal(measured.ok, true);
 assert.equal(measured.alert.status, 'open');
 const metrics = operationMetrics(fresh.bundle, [facility.id], '2026-11-16', now);
 assert.equal(metrics.temperatureOpen >= 1, true);
 assert.equal(facilityNotices(fresh.bundle, [], {facilityIds: [facility.id], now, actor: employee}).some(item => item.id === `temperature-warning:${oldHot.alert.id}`), false);
 assert.equal(facilityNotices(fresh.bundle, [], {facilityIds: [facility.id], now, actor: employee}).some(item => item.id === `temperature-warning:${recent.alert.id}`), true);
 assert.equal(hideOldFacilityAlerts(waterOld.bundle, facility, 30, employee, now).ok, false);
 assert.equal(hideOldFacilityAlerts(waterOld.bundle, second, 7, otherManager, now).events.length, 0);
});

test('Mandantentrennung: Ausblendung eines Betriebs trifft den anderen nicht', () => {
 const firstPoint = createTemperaturePoint(emptyOperations(), {facility, name: 'Vorlauf', location: 'Technik', minimum: '24', maximum: '28'}, manager, now);
 const first = recordTemperature(firstPoint.bundle, firstPoint.point.id, {value: '31'}, employee, now);
 const secondPoint = createTemperaturePoint(first.bundle, {facility: second, name: 'Pumpe', location: 'Technik', minimum: '24', maximum: '28'}, admin, now);
 const other = recordTemperature(secondPoint.bundle, secondPoint.point.id, {value: '31'}, admin, now);
 const hidden = hideFacilityAlert(other.bundle, 'temperature', first.alert.id, manager, now);
 assert.equal(hidden.ok, true);
 assert.equal(alertIsHidden(hidden.bundle, 'temperature', other.alert.id), false);
 assert.equal(hideFacilityAlert(hidden.bundle, 'temperature', other.alert.id, manager, now).ok, false);
 const foreignPoint = createTemperaturePoint(emptyOperations(), {facility: foreign, name: 'Fremd', location: 'Technik', minimum: '1', maximum: '2'}, foreignAdmin, now);
 const foreignHot = recordTemperature(foreignPoint.bundle, foreignPoint.point.id, {value: '9'}, foreignAdmin, now);
 assert.equal(hideFacilityAlert(foreignHot.bundle, 'temperature', foreignHot.alert.id, admin, now).ok, false);
});

test('Speichern bestätigt Ausblendung ohne Statusänderung und ohne fremde Betriebe', async () => {
 const point = createTemperaturePoint(emptyOperations(), {facility, name: 'Vorlauf', location: 'Technik', minimum: '24', maximum: '28'}, manager, now);
 const hot = recordTemperature(point.bundle, point.point.id, {value: '31'}, employee, '2026-10-01T10:00:00.000Z');
 const options = {
  userId: manager.userId,
  rows: {
   daily_reports: [],
   daily_report_revisions: [],
   daily_report_defects: [],
   inspection_templates: [],
   inspection_points: [],
   inspection_runs: [],
   inspection_results: [],
   assets: [],
   maintenance_logs: [],
   asset_defects: [],
   procurement_requests: [],
   temperature_points: [{
    id: point.point.id,
    organization_id: facility.organization_id,
    facility_id: facility.id,
    name: 'Vorlauf',
    location: 'Technik',
    minimum_celsius: '24',
    maximum_celsius: '28',
    active: true,
    created_by: manager.userId,
    created_at: now
   }],
   temperature_readings: [{
    id: hot.reading.id,
    point_id: point.point.id,
    organization_id: facility.organization_id,
    facility_id: facility.id,
    measured_at: hot.reading.measuredAt,
    value_celsius: '31',
    recorded_by: employee.userId,
    note: ''
   }],
   temperature_alerts: [{
    id: hot.alert.id,
    reading_id: hot.reading.id,
    point_id: point.point.id,
    organization_id: facility.organization_id,
    facility_id: facility.id,
    value_celsius: '31',
    minimum_celsius: '24',
    maximum_celsius: '28',
    status: 'open',
    acknowledged_by: null,
    acknowledged_at: null,
    remark: ''
   }],
   facility_alert_visibility: []
  }
 };
 const db = memoryDb(options);
 const hidden = await saveFacilityAlertVisibility(db, hot.bundle, 'temperature', hot.alert.id, 'hide', manager, now, context);
 assert.equal(hidden.ok, true);
 assert.equal(hidden.alert.status, 'open');
 assert.equal(hidden.alert.hidden, true);
 assert.equal(db.rows.temperature_alerts[0].status, 'open');
 const loaded = await loadOperations(db, employee, context);
 assert.equal(loaded.alertHidesInstalled, true);
 assert.equal(loaded.bundle.temperatureAlerts[0].hidden, true);
 assert.equal(loaded.bundle.temperatureAlerts[0].status, 'open');
 options.userId = employee.userId;
 const ack = await saveTemperatureAcknowledgement(db, hidden.bundle, hot.alert.id, 'Zur Kenntnis genommen', employee, now, context);
 assert.equal(ack.ok, true);
 assert.equal(ack.alert.status, 'acknowledged');
 assert.equal(ack.alert.hidden, true);
 options.userId = manager.userId;
 const restored = await saveFacilityAlertVisibility(db, ack.bundle, 'temperature', hot.alert.id, 'restore', manager, now, context);
 assert.equal(restored.ok, true);
 assert.equal(restored.alert.hidden, false);
 assert.equal(restored.alert.status, 'acknowledged');
 const bulk = await saveOldFacilityAlertHides(memoryDb({userId: manager.userId, rows: structuredClone(db.rows)}), hot.bundle, facility, 30, manager, now, context);
 assert.equal(bulk.ok, true);
 const refused = await saveFacilityAlertVisibility(memoryDb({userId: employee.userId, rows: structuredClone(db.rows)}), hot.bundle, 'temperature', hot.alert.id, 'hide', employee, now, context);
 assert.equal(refused.ok, false);
 const missing = await loadOperations(memoryDb({missingHides: true, rows: structuredClone(db.rows)}), manager, context);
 assert.equal(missing.ok, true);
 assert.equal(missing.alertHidesInstalled, false);
});
