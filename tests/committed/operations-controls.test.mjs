import assert from 'node:assert/strict';
import test from 'node:test';
import {
 acknowledgeTemperatureAlert,
 createMaterial,
 createTemperaturePoint,
 facilityNotices,
 materialBelowMinimum,
 missingTemperaturePoints,
 procurementFromStock,
 recordMovement,
 recordTemperature,
 roleSessionConfirmation,
 setTemperaturePointActive,
 stockOf,
 temperatureDefectDraft,
 updateTemperaturePoint
} from '../../js/operations-controls.js';
import {emptyOperations, materialStock, operationMetrics} from '../../js/operations.js';
import {
 loadOperations,
 saveMaterial,
 saveMaterialMovement,
 saveProcurementRequest,
 saveTemperatureAcknowledgement,
 saveTemperaturePoint,
 saveTemperaturePointActive,
 saveTemperaturePointChange,
 saveTemperatureReading
} from '../../js/operations-store.js';

const now = '2026-11-09T12:00:00.000Z';
const facility = {id: 'fac-a', organization_id: 'org-a', name: 'Bad'};
const second = {id: 'fac-b', organization_id: 'org-a', name: 'Strand'};
const foreign = {id: 'fac-c', organization_id: 'org-b', name: 'Fremd'};

function membership(role, target = facility, active = true) {
 return {organization_id: target.organization_id, facility_id: role === 'company_admin' ? null : target.id, role, is_active: active};
}

const employee = {userId: 'employee-1', name: 'Mia', memberships: [membership('employee')]};
const manager = {userId: 'manager-1', name: 'Lea', memberships: [membership('facility_manager')]};
const admin = {userId: 'admin-1', name: 'Kim', memberships: [membership('company_admin')]};
const inactive = {userId: 'employee-2', name: 'Inaktiv', memberships: [membership('employee', facility, false)]};
const otherEmployee = {userId: 'employee-9', name: 'Fremd', memberships: [membership('employee', second)]};

test('Die Sitzungsprüfung für Betriebsleitung und Mitarbeiter aus Tageswerk 3.0 bleibt offen', () => {
 assert.equal(roleSessionConfirmation.facilityManager, 'open');
 assert.equal(roleSessionConfirmation.employee, 'open');
 assert.notEqual(roleSessionConfirmation.facilityManager, 'passed');
 assert.notEqual(roleSessionConfirmation.employee, 'passed');
});

test('Temperatur wird gemessen, Grenzen werden erkannt und Warnungen quittiert', () => {
 assert.equal(createTemperaturePoint(emptyOperations(), {facility, name: 'Becken', location: 'Halle', minimum: '24', maximum: '28'}, employee, now).ok, false);
 const point = createTemperaturePoint(emptyOperations(), {facility, name: 'Becken', location: 'Halle', minimum: '24,0', maximum: '28'}, manager, now);
 assert.equal(point.ok, true);
 assert.equal(point.point.createdBy, manager.userId);
 assert.equal(createTemperaturePoint(point.bundle, {facility: foreign, name: 'Fremd', location: 'Weg', minimum: '1', maximum: '2'}, admin, now).ok, false);
 assert.equal(missingTemperaturePoints(point.bundle, facility.id, now).length, 1);
 const normal = recordTemperature(point.bundle, point.point.id, {value: '24', note: ''}, employee, now);
 assert.equal(normal.ok, true);
 assert.equal(normal.reading.recordedBy, employee.userId);
 assert.equal(normal.reading.measuredAt, now);
 assert.equal(normal.alert, null);
 const upper = recordTemperature(normal.bundle, point.point.id, {value: '28'}, employee, now);
 assert.equal(upper.alert, null);
 const above = recordTemperature(normal.bundle, point.point.id, {value: '28.1'}, employee, now);
 assert.equal(above.alert.status, 'open');
 const below = recordTemperature(normal.bundle, point.point.id, {value: '23.9'}, employee, now);
 assert.equal(below.alert.status, 'open');
 assert.equal(missingTemperaturePoints(normal.bundle, facility.id, now).length, 0);
 const lateEvening = recordTemperature(point.bundle, point.point.id, {value: '25'}, otherEmployee, '2026-11-08T23:30:00.000Z');
 assert.equal(lateEvening.ok, false);
 const berlinEvening = recordTemperature(point.bundle, point.point.id, {value: '25'}, employee, '2026-11-08T23:30:00.000Z');
 assert.equal(berlinEvening.ok, true);
 assert.equal(missingTemperaturePoints(berlinEvening.bundle, facility.id, now).length, 0);
 const hot = recordTemperature(normal.bundle, point.point.id, {value: '31', note: 'Nach dem Stoßbetrieb'}, employee, '2026-11-09T16:00:00.000Z');
 assert.equal(hot.ok, true);
 assert.equal(hot.alert.status, 'open');
 assert.equal(hot.alert.valueC, '31');
 assert.equal(acknowledgeTemperatureAlert(hot.bundle, hot.alert.id, 'ok', employee, now).ok, false);
 const signed = acknowledgeTemperatureAlert(hot.bundle, hot.alert.id, 'Wasser abgelassen', employee, '2026-11-09T16:05:00.000Z');
 assert.equal(signed.ok, true);
 assert.equal(signed.alert.acknowledgedBy, employee.userId);
 assert.equal(signed.alert.acknowledgedAt, '2026-11-09T16:05:00.000Z');
 assert.equal(acknowledgeTemperatureAlert(signed.bundle, hot.alert.id, 'Nochmals', manager, now).ok, false);
 assert.equal(recordTemperature(hot.bundle, point.point.id, {value: '30'}, inactive, now).ok, false);
 const draft = temperatureDefectDraft(hot.bundle, hot.alert.id);
 assert.equal(draft.ok, true);
 assert.equal(draft.defect.facility_id, facility.id);
 assert.equal(draft.defect.source, 'temperature');
 assert.equal(temperatureDefectDraft(signed.bundle, hot.alert.id).ok, false);
 const metrics = operationMetrics(hot.bundle, [facility.id], '2026-11-09', now);
 assert.equal(metrics.temperatureOpen, 1);
 assert.equal(metrics.temperatureMissing, 0);
});

test('Bestand wird berechnet und eine zweite Beschaffung vermieden', () => {
 assert.equal(createMaterial(emptyOperations(), {facility, name: 'Filtervlies', location: 'Lager', unit: 'Rolle', minimum: '2,5'}, employee, now).ok, false);
 const material = createMaterial(emptyOperations(), {facility, name: 'Filtervlies', location: 'Lager', unit: 'Rolle', minimum: '2,5'}, manager, now);
 assert.equal(material.ok, true);
 assert.equal('stock' in material.material, false);
 assert.equal(stockOf(material.bundle, material.material.id), 0);
 assert.equal(materialBelowMinimum(material.bundle, material.material), true);
 const received = recordMovement(material.bundle, {materialId: material.material.id, direction: 'in', quantity: '2,5', note: 'Lieferung'}, employee, now);
 assert.equal(received.ok, true);
 assert.equal(materialStock(received.bundle.movements, material.material.id), 2.5);
 assert.equal(materialBelowMinimum(received.bundle, material.material), false);
 assert.equal(procurementFromStock(received.bundle, material.material.id, employee, now).ok, false);
 const used = recordMovement(received.bundle, {materialId: material.material.id, direction: 'out', quantity: '1', note: ''}, employee, '2026-11-09T13:00:00.000Z');
 assert.equal(used.ok, true);
 assert.equal(stockOf(used.bundle, material.material.id), 1.5);
 assert.equal(recordMovement(used.bundle, {materialId: material.material.id, direction: 'out', quantity: '2', note: ''}, employee, now).ok, false);
 assert.equal(recordMovement(used.bundle, {materialId: material.material.id, direction: 'out', quantity: '1', maintenanceLogId: 'fremd-log'}, employee, now).ok, false);
 const maintained = recordMovement({...used.bundle, assets: [{id: 'asset-1', facilityId: facility.id, logs: [{id: 'log-1'}]}]}, {materialId: material.material.id, direction: 'out', quantity: '0,5', note: 'Wartung', maintenanceLogId: 'log-1'}, employee, now);
 assert.equal(maintained.ok, true);
 assert.equal(maintained.movement.maintenanceLogId, 'log-1');
 const order = procurementFromStock(used.bundle, material.material.id, employee, now);
 assert.equal(order.ok, true);
 assert.equal(order.request.materialId, material.material.id);
 assert.equal(order.request.quantity, '1');
 assert.equal(order.request.status, 'submitted');
 assert.equal(procurementFromStock(order.bundle, material.material.id, manager, now).ok, false);
 assert.equal(recordMovement(used.bundle, {materialId: material.material.id, direction: 'in', quantity: '1'}, otherEmployee, now).ok, false);
 const metrics = operationMetrics(used.bundle, [facility.id, second.id], '2026-11-09', now);
 assert.equal(metrics.stockLow, 1);
});

test('Hinweise bleiben im Betrieb und blenden fremde Daten aus', () => {
 const point = createTemperaturePoint(emptyOperations(), {facility, name: 'Becken', location: 'Halle', minimum: '20', maximum: '30'}, manager, now);
 const strandPoint = createTemperaturePoint(point.bundle, {facility: second, name: 'Außenbecken', location: 'Strand', minimum: '18', maximum: '26'}, admin, now);
 const hot = recordTemperature(strandPoint.bundle, strandPoint.point.id, {value: '29'}, admin, now);
 const material = createMaterial(hot.bundle, {facility, name: 'Chlor', location: 'Lager', unit: 'kg', minimum: '1'}, manager, now);
 const bundle = {
  ...hot.bundle,
  materials: material.bundle.materials,
  runs: [{id: 'run-1', facilityId: facility.id, organizationId: facility.organization_id, name: 'Früh', status: 'open', dueAt: '2026-11-08T08:00:00.000Z'}],
  assets: [{id: 'asset-1', facilityId: second.id, organizationId: second.organization_id, name: 'Pumpe', intervalUnit: 'day', intervalCount: 1, anchorAt: '2026-01-01T00:00:00.000Z', logs: []}],
  requests: [{id: 'request-1', facilityId: facility.id, organizationId: facility.organization_id, title: 'Sand', status: 'submitted'}]
 };
 const defects = [
  {id: 'new-1', facility_id: facility.id, organization_id: facility.organization_id, title: 'Heute offen', status: 'open', created_at: now},
  {id: 'old-1', facility_id: facility.id, organization_id: facility.organization_id, title: 'Frist abgelaufen', status: 'in_progress', created_at: '2026-11-01T08:00:00.000Z', resolution_due_at: '2026-11-08T08:00:00.000Z'},
  {id: 'proposed-1', facility_id: facility.id, organization_id: facility.organization_id, title: 'Nur ein Vorschlag', status: 'open', created_at: '2026-11-01T08:00:00.000Z', resolution_proposed_due_at: '2026-11-02T08:00:00.000Z'},
  {id: 'foreign-1', facility_id: foreign.id, organization_id: foreign.organization_id, title: 'Fremder Mangel', status: 'open', created_at: now}
 ];
 const own = facilityNotices(bundle, defects, {facilityIds: [facility.id, second.id, foreign.id], now, actor: employee});
 assert.equal(own.some(item => item.facilityId === foreign.id), false);
 assert.equal(own.some(item => item.kind === 'temperature-warning'), false);
 assert.equal(own.some(item => item.id === 'defect-new:new-1'), true);
 assert.equal(own.some(item => item.id === 'defect-overdue:old-1'), true);
 assert.equal(own.some(item => item.id === 'defect-overdue:proposed-1'), false);
 assert.equal(own.some(item => item.kind === 'inspection-overdue'), true);
 assert.equal(own.some(item => item.kind === 'stock-low'), true);
 assert.equal(own.some(item => item.kind === 'procurement-open'), true);
 const strand = facilityNotices(bundle, defects, {facilityIds: [second.id], now, actor: admin});
 assert.deepEqual(strand.map(item => item.kind).sort(), ['maintenance-overdue', 'temperature-warning']);
 const managerView = facilityNotices(bundle, defects, {facilityIds: [facility.id, second.id], now, actor: manager});
 assert.equal(managerView.some(item => item.facilityId === second.id), false);
 assert.equal(managerView.some(item => item.facilityId === facility.id), true);
});

const context = {facilities: [facility, second], names: {'employee-1': 'Mia', 'manager-1': 'Lea'}};

function controlDb(options = {}) {
 const rows = options.rows || {
  daily_reports: [], daily_report_revisions: [], daily_report_defects: [],
  inspection_templates: [], inspection_points: [], inspection_runs: [], inspection_results: [],
  assets: [], maintenance_logs: [], asset_defects: [], procurement_requests: [],
  temperature_points: [], temperature_readings: [], temperature_alerts: [], materials: [], material_movements: []
 };
 const calls = [];
 return {
  calls,
  rows,
  async select(table) {
   calls.push(['select', table]);
   if ((options.missingControls && ['temperature_points', 'temperature_readings', 'temperature_alerts', 'materials', 'material_movements'].includes(table)) || (options.missingTables || []).includes(table)) {
    return {data: null, error: {code: 'PGRST205', message: 'schema cache'}};
   }
   return {data: (rows[table] || []).map(row => ({...row})), error: null};
  },
  async insert(table, row) {
   calls.push(['insert', table, row]);
   if (options.insertError) return {data: null, error: options.insertError};
   if (options.emptyInsert) return {data: null, error: null};
   if (table === 'material_movements' && row.direction === 'out') {
    const stock = rows.material_movements.reduce((sum, movement) => {
     if (movement.material_id !== row.material_id) return sum;
     return sum + (movement.direction === 'out' ? -Number(movement.quantity) : Number(movement.quantity));
    }, 0);
    if (stock < Number(row.quantity)) return {data: null, error: {code: 'P0001', message: 'Der Bestand reicht für diese Entnahme nicht.'}};
   }
   if (table === 'procurement_requests' && row.material_id && rows.procurement_requests.some(item => item.material_id === row.material_id && item.status === 'submitted')) {
    return {data: null, error: {code: 'P0001', message: 'Für dieses Material liegt bereits eine offene Beschaffung vor.'}};
   }
   const saved = {
    id: `${table}-${rows[table].length + 1}`,
    organization_id: row.facility_id === foreign.id ? foreign.organization_id : facility.organization_id,
    created_by: options.userId,
    recorded_by: options.userId,
    created_at: now,
    measured_at: now,
    recorded_at: now,
    status: 'submitted',
    ...row
   };
   rows[table].push(saved);
   if (table === 'temperature_readings') {
    const point = rows.temperature_points.find(item => item.id === row.point_id);
    const value = Number(row.value_celsius);
    if (point && (value < Number(point.minimum_celsius) || value > Number(point.maximum_celsius))) {
     rows.temperature_alerts.push({
      id: `temperature_alerts-${rows.temperature_alerts.length + 1}`,
      reading_id: saved.id,
      point_id: point.id,
      organization_id: saved.organization_id,
      facility_id: saved.facility_id,
      value_celsius: row.value_celsius,
      minimum_celsius: point.minimum_celsius,
      maximum_celsius: point.maximum_celsius,
      status: 'open',
      remark: ''
     });
    }
   }
   return {data: {...saved}, error: null};
  },
  async update(table, id, patch) {
   calls.push(['update', table, id, patch]);
   if (options.updateError) return {data: null, error: options.updateError};
   const current = rows[table].find(item => item.id === id);
   if (!current || options.emptyUpdate) return {data: null, error: null};
   if (table === 'temperature_alerts' && current.status !== 'open') {
    return {data: null, error: {code: 'P0001', message: 'Diese Warnung wurde bereits quittiert.'}};
   }
   if (table === 'temperature_points') {
    Object.assign(current, patch);
    return {data: {...current}, error: null};
   }
   if (table === 'temperature_alerts') {
    Object.assign(current, patch, {acknowledged_by: options.userId, acknowledged_at: now});
    return {data: {...current}, error: null};
   }
   Object.assign(current, patch, {acknowledged_by: options.userId, acknowledged_at: now});
   return {data: {...current}, error: null};
  },
  async rpc() {
   return {data: null, error: {code: '42883', message: 'function does not exist'}};
  }
 };
}

test('Fehlende Bestätigung und fehlende Rechte speichern Temperatur und Bestand nicht', async () => {
 const db = controlDb({userId: manager.userId});
 const denied = await saveTemperaturePoint(db, emptyOperations(), {facility, name: 'Becken', location: 'Halle', minimum: '24', maximum: '28'}, employee, now, context);
 assert.equal(denied.ok, false);
 assert.equal(db.calls.some(call => call[0] === 'insert'), false);
 const saved = await saveTemperaturePoint(db, emptyOperations(), {facility, name: 'Becken', location: 'Halle', minimum: '24', maximum: '28'}, manager, now, context);
 assert.equal(saved.ok, true);
 assert.equal(saved.point.name, 'Becken');
 const unconfirmed = await saveTemperaturePoint(controlDb({userId: manager.userId, emptyInsert: true}), emptyOperations(), {facility, name: 'Becken', location: 'Halle', minimum: '24', maximum: '28'}, manager, now, context);
 assert.equal(unconfirmed.ok, false);
 assert.equal(unconfirmed.bundle.temperaturePoints.length, 0);
 const missing = await saveMaterial(controlDb({userId: manager.userId, insertError: {code: 'PGRST205', message: 'schema cache'}}), emptyOperations(), {facility, name: 'Chlor', location: 'Lager', unit: 'kg', minimum: '1'}, manager, now, context);
 assert.equal(missing.ok, false);
 assert.match(missing.error, /noch nicht installiert/);
 const employeeDb = controlDb({userId: employee.userId, rows: db.rows});
 const reading = await saveTemperatureReading(employeeDb, saved.bundle, saved.point.id, {value: '31', note: 'Zu warm'}, employee, now, context);
 assert.equal(reading.ok, true);
 assert.equal(reading.alert.status, 'open');
 assert.equal(reading.reading.recordedBy, employee.userId);
 const withoutAlert = controlDb({userId: employee.userId, rows: structuredClone(db.rows)});
 withoutAlert.rows.temperature_points = db.rows.temperature_points.map(row => ({...row}));
 const originalInsert = withoutAlert.insert.bind(withoutAlert);
 withoutAlert.insert = async (table, row) => {
  const result = await originalInsert(table, row);
  if (table === 'temperature_readings') withoutAlert.rows.temperature_alerts.splice(0);
  return result;
 };
 const lostAlert = await saveTemperatureReading(withoutAlert, saved.bundle, saved.point.id, {value: '31'}, employee, now, context);
 assert.equal(lostAlert.ok, false);
 assert.equal(lostAlert.bundle.temperatureReadings.length, saved.bundle.temperatureReadings.length);
 const blockedAck = await saveTemperatureAcknowledgement(employeeDb, reading.bundle, reading.alert.id, 'ok', employee, now, context);
 assert.equal(blockedAck.ok, false);
 assert.equal(employeeDb.calls.some(call => call[0] === 'update'), false);
 const signed = await saveTemperatureAcknowledgement(employeeDb, reading.bundle, reading.alert.id, 'Wasser abgelassen', employee, now, context);
 assert.equal(signed.ok, true);
 assert.equal(signed.alert.acknowledgedBy, employee.userId);
 const emptyAck = await saveTemperatureAcknowledgement(controlDb({userId: employee.userId, emptyUpdate: true, rows: employeeDb.rows}), reading.bundle, reading.alert.id, 'Wasser abgelassen', employee, now, context);
 assert.equal(emptyAck.ok, false);
 assert.equal(emptyAck.bundle.temperatureAlerts[0].status, 'open');
 const raced = await saveTemperatureAcknowledgement(employeeDb, reading.bundle, reading.alert.id, 'Andere Bemerkung', manager, now, context);
 assert.equal(raced.ok, false);
 assert.match(raced.error, /bereits quittiert/);
 const storedAlert = employeeDb.rows.temperature_alerts.find(item => item.id === reading.alert.id);
 assert.equal(storedAlert.status, 'acknowledged');
 assert.equal(storedAlert.remark, 'Wasser abgelassen');
 assert.equal(storedAlert.acknowledged_by, employee.userId);
});

test('Materialbuchung, Beschaffung und fremde Zeilen folgen der Datenbank', async () => {
 const db = controlDb({userId: manager.userId});
 const material = await saveMaterial(db, emptyOperations(), {facility, name: 'Chlor', location: 'Lager', unit: 'kg', minimum: '1'}, manager, now, context);
 assert.equal(material.ok, true);
 const employeeDb = controlDb({userId: employee.userId, rows: db.rows});
 const inward = await saveMaterialMovement(employeeDb, material.bundle, {materialId: material.id, direction: 'in', quantity: '2', note: 'Lieferung'}, employee, now, context);
 assert.equal(inward.ok, true);
 assert.equal(stockOf(inward.bundle, material.id), 2);
 const firstOut = await saveMaterialMovement(employeeDb, inward.bundle, {materialId: material.id, direction: 'out', quantity: '2', note: 'Erste Entnahme'}, employee, now, context);
 assert.equal(firstOut.ok, true);
 const secondOut = await saveMaterialMovement(employeeDb, inward.bundle, {materialId: material.id, direction: 'out', quantity: '2', note: 'Gleichzeitige Entnahme'}, employee, now, context);
 assert.equal(secondOut.ok, false);
 assert.match(secondOut.error, /reicht für diese Entnahme nicht/);
 assert.equal(employeeDb.rows.material_movements.filter(item => item.direction === 'out').length, 1);
 const restocked = await saveMaterialMovement(employeeDb, firstOut.bundle, {materialId: material.id, direction: 'in', quantity: '1', note: 'Nachschub'}, employee, now, context);
 assert.equal(restocked.ok, true);
 assert.equal(stockOf(restocked.bundle, material.id), 1);
 const refused = await saveMaterialMovement(controlDb({userId: employee.userId, insertError: {code: 'P0001', message: 'Der Bestand reicht für diese Entnahme nicht.'}, rows: employeeDb.rows}), restocked.bundle, {materialId: material.id, direction: 'out', quantity: '2', note: ''}, employee, now, context);
 assert.equal(refused.ok, false);
 assert.equal(stockOf(refused.bundle, material.id), 1);
 assert.match(refused.error, /reicht für diese Entnahme nicht/);
 const low = await saveMaterialMovement(employeeDb, restocked.bundle, {materialId: material.id, direction: 'out', quantity: '0,5', note: 'Dosierung'}, employee, now, context);
 assert.equal(low.ok, true);
 const order = await saveProcurementRequest(employeeDb, low.bundle, {facility, title: 'Chlor', quantity: '0.5', unit: 'kg', reason: 'Mindestbestand unterschritten.', urgency: 'high', materialId: material.id}, employee, now, context);
 assert.equal(order.ok, true);
 assert.equal(order.request.materialId, material.id);
 const duplicate = await saveProcurementRequest(employeeDb, order.bundle, {facility, title: 'Chlor', quantity: '1', unit: 'kg', reason: 'Noch einmal', urgency: 'high', materialId: material.id}, employee, now, context);
 assert.equal(duplicate.ok, false);
 const stale = {...order.bundle, requests: []};
 const racedOrder = await saveProcurementRequest(employeeDb, stale, {facility, title: 'Chlor', quantity: '1', unit: 'kg', reason: 'Gleichzeitig gemeldet', urgency: 'high', materialId: material.id}, employee, now, context);
 assert.equal(racedOrder.ok, false);
 assert.match(racedOrder.error, /bereits eine offene Beschaffung/);
 assert.equal(employeeDb.rows.procurement_requests.length, 1);
 const hiddenRows = structuredClone(db.rows);
 hiddenRows.temperature_points.push({id: 'foreign-point', organization_id: foreign.organization_id, facility_id: foreign.id, name: 'Geheim', location: 'Weg', minimum_celsius: '1', maximum_celsius: '2', active: true, created_by: 'other', created_at: now});
 const loaded = await loadOperations(controlDb({rows: hiddenRows}), employee, context);
 assert.equal(loaded.bundle.temperaturePoints.some(point => point.id === 'foreign-point'), false);
 const kept = await loadOperations(controlDb({missingControls: true, rows: {...hiddenRows, daily_reports: [{id: 'report-1', organization_id: facility.organization_id, facility_id: facility.id, report_date: '2026-11-09', incidents: 'Pumpe', handover: '', created_by: employee.userId, created_at: now}]}}), employee, context);
 assert.equal(kept.ok, true);
 assert.equal(kept.installed, true);
 assert.equal(kept.temperatureInstalled, false);
 assert.equal(kept.materialsInstalled, false);
 assert.equal(kept.bundle.reports.length, 1);
 assert.equal(kept.bundle.temperaturePoints.length, 0);
 hiddenRows.temperature_points.push({id: 'own-point', organization_id: facility.organization_id, facility_id: facility.id, name: 'Becken', location: 'Halle', minimum_celsius: '24', maximum_celsius: '28', active: true, created_by: manager.userId, created_at: now});
 const onlyTemperature = await loadOperations(controlDb({missingTables: ['materials', 'material_movements'], rows: hiddenRows}), employee, context);
 assert.equal(onlyTemperature.temperatureInstalled, true);
 assert.equal(onlyTemperature.materialsInstalled, false);
 assert.equal(onlyTemperature.bundle.temperaturePoints.some(point => point.id === 'own-point'), true);
 assert.equal(onlyTemperature.bundle.temperaturePoints.some(point => point.id === 'foreign-point'), false);
 assert.equal(onlyTemperature.bundle.materials.length, 0);
 const onlyMaterials = await loadOperations(controlDb({missingTables: ['temperature_points', 'temperature_readings', 'temperature_alerts'], rows: {...hiddenRows, materials: [{id: 'material-1', organization_id: facility.organization_id, facility_id: facility.id, name: 'Chlor', location: 'Lager', unit: 'kg', minimum_quantity: '1', created_by: manager.userId, created_at: now}]}}), employee, context);
 assert.equal(onlyMaterials.temperatureInstalled, false);
 assert.equal(onlyMaterials.materialsInstalled, true);
 assert.equal(onlyMaterials.bundle.temperaturePoints.length, 0);
 assert.equal(onlyMaterials.bundle.materials.length, 1);
});

test('Messstellen bleiben in der Historie und folgen dem Kontrollintervall', async () => {
 const created = createTemperaturePoint(emptyOperations(), {facility, name: 'Becken', location: 'Halle', minimum: '24', maximum: '28', intervalUnit: 'day', intervalCount: 1}, manager, now);
 const measured = recordTemperature(created.bundle, created.point.id, {value: '31', note: 'Zu warm'}, employee, now);
 const previousAlert = measured.alert.minC;
 const previousValue = measured.reading.valueC;
 const changed = updateTemperaturePoint(measured.bundle, created.point.id, {name: 'Becken neu', location: 'Technik', minimum: '10', maximum: '12', intervalUnit: 'week', intervalCount: 2}, manager);
 assert.equal(changed.ok, true);
 assert.equal(changed.point.minC, '10');
 assert.equal(changed.bundle.temperatureAlerts[0].minC, previousAlert);
 assert.equal(changed.bundle.temperatureReadings[0].valueC, previousValue);
 assert.equal(updateTemperaturePoint(measured.bundle, created.point.id, {name: 'Fremd', location: 'Weg', minimum: '1', maximum: '2'}, employee).ok, false);
 assert.equal(updateTemperaturePoint(measured.bundle, created.point.id, {name: 'Fremd', location: 'Weg', minimum: '1', maximum: '2'}, otherEmployee).ok, false);
 const paused = setTemperaturePointActive(changed.bundle, created.point.id, false, manager);
 assert.equal(missingTemperaturePoints(paused.bundle, facility.id, now).length, 0);
 assert.equal(paused.bundle.temperatureReadings.length, 1);
 const resumed = setTemperaturePointActive(paused.bundle, created.point.id, true, admin);
 assert.equal(missingTemperaturePoints(resumed.bundle, facility.id, now).length, 0);
 const weekly = updateTemperaturePoint(measured.bundle, created.point.id, {name: 'Becken', location: 'Halle', minimum: '24', maximum: '28', intervalUnit: 'week', intervalCount: 1}, manager);
 assert.equal(missingTemperaturePoints(weekly.bundle, facility.id, '2026-11-15T12:00:00.000Z').length, 0);
 assert.equal(missingTemperaturePoints(weekly.bundle, facility.id, '2026-11-16T12:00:01.000Z').length, 1);
 const db = controlDb({userId: manager.userId});
 const saved = await saveTemperaturePoint(db, emptyOperations(), {facility, name: 'Becken', location: 'Halle', minimum: '24', maximum: '28'}, manager, now, context);
 const reading = await saveTemperatureReading(controlDb({userId: employee.userId, rows: db.rows}), saved.bundle, saved.point.id, {value: '31', note: 'Zu warm'}, employee, now, context);
 const originalMin = reading.alert.minC;
 const edited = await saveTemperaturePointChange(db, reading.bundle, saved.point.id, {name: 'Technikbecken', location: 'Keller', minimum: '1', maximum: '3', intervalUnit: 'month', intervalCount: 1}, manager, now, context);
 assert.equal(edited.ok, true);
 assert.equal(edited.point.name, 'Technikbecken');
 assert.equal(edited.point.intervalUnit, 'month');
 assert.equal(edited.bundle.temperatureAlerts.find(item => item.id === reading.alert.id).minC, originalMin);
 assert.equal(edited.bundle.temperatureReadings.find(item => item.id === reading.reading.id).valueC, reading.reading.valueC);
 const employeeDb = controlDb({userId: employee.userId, rows: db.rows});
 const refused = await saveTemperaturePointChange(employeeDb, edited.bundle, saved.point.id, {name: 'Anders', location: 'Weg', minimum: '1', maximum: '2'}, employee, now, context);
 assert.equal(refused.ok, false);
 assert.equal(employeeDb.calls.some(call => call[0] === 'update'), false);
 const inactivePoint = await saveTemperaturePointActive(employeeDb, edited.bundle, saved.point.id, false, employee, now, context);
 assert.equal(inactivePoint.ok, false);
 const deactivated = await saveTemperaturePointActive(db, edited.bundle, saved.point.id, false, manager, now, context);
 assert.equal(deactivated.ok, true);
 assert.equal(deactivated.point.active, false);
 assert.equal(missingTemperaturePoints(deactivated.bundle, facility.id, now).length, 0);
 assert.equal(deactivated.bundle.temperatureReadings.length, 1);
 const reactivated = await saveTemperaturePointActive(db, deactivated.bundle, saved.point.id, true, admin, now, context);
 assert.equal(reactivated.ok, true);
 assert.equal(reactivated.point.active, true);
});
