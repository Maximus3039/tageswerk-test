import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
 acknowledgeTemperatureAlert,
 createMaterial,
 configureTemperatureInput,
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
 updateTemperaturePoint,
 acknowledgeWaterAlert,
 addWaterParameter,
 clearLocalWaterDrafts,
 clearWaterRound,
 createWaterPool,
 emptyWaterRound,
 loadWaterRound,
 moveWaterRound,
 ownOpenWaterDraft,
 roundFromWaterDraft,
 waterDraftSaveDelay,
 waterDraftStatusText,
 recordWaterCheck,
 rememberWaterEntry,
 reviewWaterRound,
 waterRoundDisplayStatus,
 waterRoundTableRows,
 storeWaterRound,
 waterRoundPools,
 waterRoundProgress,
 recordWaterMeasure,
 setWaterPoolActive,
 updateWaterParameter,
 updateWaterPool,
} from '../../js/operations-controls.js';
import {berlinDay, berlinInstant, emptyOperations, materialStock, operationMetrics, waterControlState, waterDayRounds, waterFacilityPlan, waterHistoryCsv, waterHistoryRows, waterMeasurementCsv, waterOverviewRows, waterParameterCatalog, waterRowsForMember} from '../../js/operations.js';
import {waterHistoryRole} from '../../js/permissions.js';
import {
 loadOperations,
 saveMaterial,
 saveMaterialMovement,
 saveProcurementRequest,
 saveTemperatureAcknowledgement,
 saveTemperaturePoint,
 saveTemperaturePointActive,
 saveTemperaturePointChange,
 saveTemperatureReading,
 saveWaterAcknowledgement,
 saveWaterCheck,
 saveWaterRound,
 saveWaterRoundDraft,
 waterRoundFailureMessage,
 discardWaterRound,
 saveWaterFacilitySlots,
 saveWaterMeasure,
 saveWaterParameter,
 saveWaterPool,
 saveWaterPoolActive,
 saveWaterPoolChange
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

test('Negative Temperaturgrenzen und Messwerte bleiben zulässig', () => {
 const field = configureTemperatureInput({spellcheck: true, autocomplete: 'on'});
 assert.equal(field.type, 'text');
 assert.equal(field.inputMode, 'text');
 assert.equal(field.lang, 'de');
 assert.equal(field.min, '-50');
 assert.equal(field.max, '200');
 assert.equal(field.step, '0.1');
 assert.equal(field.spellcheck, false);
 const freezer = createTemperaturePoint(emptyOperations(), {facility, name: 'Tiefkühlraum', location: 'Lager', minimum: '−22', maximum: '-18'}, manager, now);
 assert.equal(freezer.ok, true);
 assert.equal(freezer.point.minC, '-22');
 assert.equal(freezer.point.maxC, '-18');
 const decimal = createTemperaturePoint(emptyOperations(), {facility, name: 'Kühltruhe', location: 'Küche', minimum: '-18,5', maximum: '-5'}, manager, now);
 assert.equal(decimal.ok, true);
 assert.equal(decimal.point.minC, '-18.5');
 assert.equal(decimal.point.maxC, '-5');
 assert.match(createTemperaturePoint(emptyOperations(), {facility, name: 'Vertauscht', location: 'Lager', minimum: '-5', maximum: '-18,5'}, manager, now).error, /Mindestwert/);
 assert.equal(createTemperaturePoint(emptyOperations(), {facility, name: 'Zu tief', location: 'Lager', minimum: '-50,1', maximum: '-18'}, manager, now).ok, false);
 assert.equal(createTemperaturePoint(emptyOperations(), {facility, name: 'Zu hoch', location: 'Lager', minimum: '-18', maximum: '200,1'}, manager, now).ok, false);
 const bounds = createTemperaturePoint(emptyOperations(), {facility, name: 'Gesamtbereich', location: 'Technik', minimum: '-50', maximum: '200'}, manager, now);
 assert.equal(bounds.ok, true);
 assert.equal(bounds.point.minC, '-50');
 assert.equal(bounds.point.maxC, '200');
 assert.equal(recordTemperature(bounds.bundle, bounds.point.id, {value: '-50,0'}, employee, now).ok, true);
 assert.equal(recordTemperature(bounds.bundle, bounds.point.id, {value: '200.0'}, employee, now).alert, null);
 assert.equal(recordTemperature(bounds.bundle, bounds.point.id, {value: '-50,1'}, employee, now).ok, false);
 assert.equal(recordTemperature(bounds.bundle, bounds.point.id, {value: '200,1'}, employee, now).ok, false);
 assert.equal(updateTemperaturePoint(bounds.bundle, bounds.point.id, {name: 'Gesamtbereich', location: 'Technik', minimum: '-60', maximum: '10'}, manager).ok, false);
 assert.equal(updateTemperaturePoint(bounds.bundle, bounds.point.id, {name: 'Gesamtbereich', location: 'Technik', minimum: '0', maximum: '201'}, manager).ok, false);
 const inside = recordTemperature(freezer.bundle, freezer.point.id, {value: '-18,5'}, employee, now);
 assert.equal(inside.ok, true);
 assert.equal(inside.reading.valueC, '-18.5');
 assert.equal(inside.alert, null);
 assert.equal(recordTemperature(freezer.bundle, freezer.point.id, {value: '-22'}, employee, now).alert, null);
 assert.equal(recordTemperature(freezer.bundle, freezer.point.id, {value: '-18'}, employee, now).alert, null);
 const colder = recordTemperature(freezer.bundle, freezer.point.id, {value: '-22.1'}, employee, now);
 assert.equal(colder.alert.status, 'open');
 assert.equal(colder.alert.valueC, '-22.1');
 assert.equal(colder.alert.minC, '-22');
 assert.equal(colder.alert.maxC, '-18');
 const warmer = recordTemperature(freezer.bundle, freezer.point.id, {value: '−17,9'}, employee, now);
 assert.equal(warmer.alert.status, 'open');
 assert.equal(warmer.alert.valueC, '-17.9');
 const ui = readFileSync(new URL('../../js/operations-ui.js', import.meta.url), 'utf8');
 const temperatureUi = ui.slice(ui.indexOf('function renderTemperature'), ui.indexOf('function choice'));
 assert.match(temperatureUi, /configureTemperatureInput\(input\(\)\)/);
 assert.match(temperatureUi, /configureTemperatureInput\(input\(\), String\(point\.minC\)\)/);
 assert.match(temperatureUi, /configureTemperatureInput\(input\(\), String\(point\.maxC\)\)/);
 assert.doesNotMatch(temperatureUi, /inputMode = 'decimal'/);
});

test('Die Wasserübersicht trennt gespeicherte Werte, fehlende Werte und den Rundenstatus', () => {
 const first = createWaterPool(emptyOperations(), {facility, name: 'Kinder', scheduleMode: 'daily', intervalCount: 1}, manager, now);
 const secondPool = createWaterPool(first.bundle, {facility, name: 'Schwimmer', scheduleMode: 'daily', intervalCount: 1}, manager, now);
 const bundle = secondPool.bundle;
 const ph = parameter(bundle, first.pool.id, 'ph');
 ph.minValue = '6.50';
 ph.maxValue = '7.60';
 bundle.waterChecks = [{
  id: 'check-kinder',
  poolId: first.pool.id,
  facilityId: facility.id,
  organizationId: facility.organization_id,
  measuredAt: now,
  readings: [
   {parameterCode: 'ph', value: '8.00', minLimit: '6.50', maxLimit: '7.60'},
   {parameterCode: 'free_chlorine', value: '0.40', minLimit: null, maxLimit: null}
  ]
 }];
 const rows = waterOverviewRows(bundle, facility.id, bundle.waterChecks, now);
 const kinder = rows.find(row => row.poolName === 'Kinder');
 const schwimmer = rows.find(row => row.poolName === 'Schwimmer');
 assert.equal(rows.length, 2);
 assert.equal(kinder.values.ph, '8.00');
 assert.equal(kinder.values.free_chlorine, '0.40');
 assert.equal(kinder.values.temperature, 'fehlt');
 assert.equal(kinder.values.combined_chlorine, 'fehlt');
 assert.equal(kinder.missing.temperature, true);
 assert.match(kinder.status, /Grenzwertabweichung: pH-Wert/);
 assert.equal(schwimmer.values.ph, 'fehlt');
 assert.equal(schwimmer.measuredAt, null);
 assert.equal(schwimmer.measuredLabel, 'keine Messung');
 const hidden = waterRowsForMember(bundle, employee.memberships, now, employee.userId);
 assert.equal(hidden.checks.length, 0);
 assert.equal(waterOverviewRows(bundle, facility.id, hidden.checks, now).find(row => row.poolName === 'Kinder').values.ph, 'fehlt');
 const draft = {...emptyWaterRound(facility.id, 'round-overview'), revision: 1, entries: {[first.pool.id]: {values: {ph: '7.20'}, note: ''}}};
 assert.equal(waterRoundDisplayStatus(bundle, draft, employee, now), 'Entwurf gespeichert');
 assert.equal(waterRoundDisplayStatus(bundle, emptyWaterRound(facility.id, 'round-new'), employee, now), '');
 const pools = waterRoundPools(bundle, facility.id);
 const complete = {...draft, revision: 2, entries: Object.fromEntries(pools.map(pool => [pool.id, {values: hygieneValues(), note: ''}]))};
 assert.equal(waterRoundDisplayStatus(bundle, complete, employee, now), 'Vollständig ausgefüllt');
 assert.equal(waterRoundDisplayStatus(bundle, {...complete, saved: true}, employee, now), 'Endgültig abgeschlossen');
 const table = waterRoundTableRows(bundle, reviewWaterRound(bundle, complete, employee, now));
 assert.equal(table.length, 2);
 assert.deepEqual(table.map(row => row.poolName), ['Kinder', 'Schwimmer']);
 assert.equal(table[0].values.temperature, '28.0');
 assert.equal(table[0].values.ph, '7.20');
 const ui = readFileSync(new URL('../../js/operations-ui.js', import.meta.url), 'utf8');
 const waterUi = ui.slice(ui.indexOf('function renderWater('), ui.indexOf('function renderStock'));
 assert.ok(waterUi.indexOf('⚙ Einstellungen') > waterUi.indexOf('if (isManager(current))'));
 assert.match(ui, /Zurück zur Eingabe/);
 assert.match(ui, /Kontrollrunde speichern/);
 assert.match(ui, /confirm\('Kontrollrunde verwerfen\? Die erfassten Werte werden nicht als Messung gespeichert\.'\)/);
 assert.match(ui, /water-table/);
});

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
  temperature_points: [], temperature_readings: [], temperature_alerts: [], materials: [], material_movements: [],
  water_parameter_definitions: [], water_pools: [], water_pool_parameters: [], water_checks: [], water_alerts: [], water_alert_measures: [], water_round_drafts: []
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
   if (table === 'water_pools') {
    for (const definition of waterParameterCatalog) {
     rows.water_pool_parameters.push({
      id: `water_pool_parameters-${rows.water_pool_parameters.length + 1}`,
      pool_id: saved.id,
      organization_id: saved.organization_id,
      facility_id: saved.facility_id,
      parameter_code: definition.code,
      required: true,
      active: true,
      min_value: null,
      max_value: null
     });
    }
   }
   if (table === 'water_checks') {
    const parameters = rows.water_pool_parameters.filter(item => item.pool_id === row.pool_id && item.active !== false);
    saved.measured_at = now;
    saved.recorded_by = options.userId;
    saved.readings = (row.readings || []).map(item => {
     const parameter = parameters.find(entry => entry.parameter_code === item.parameter_code);
     const definition = waterParameterCatalog.find(entry => entry.code === item.parameter_code);
     return {
      parameter_code: item.parameter_code,
      value: item.value,
      unit: definition?.unit || '',
      min_limit: parameter?.min_value ?? null,
      max_limit: parameter?.max_value ?? null
     };
    });
    for (const reading of saved.readings) {
     const below = reading.min_limit != null && Number(reading.value) < Number(reading.min_limit);
     const above = reading.max_limit != null && Number(reading.value) > Number(reading.max_limit);
     if (!below && !above) continue;
     rows.water_alerts.push({
      id: `water_alerts-${rows.water_alerts.length + 1}`,
      check_id: saved.id,
      pool_id: saved.pool_id,
      organization_id: saved.organization_id,
      facility_id: saved.facility_id,
      parameter_code: reading.parameter_code,
      value_amount: reading.value,
      min_value: reading.min_limit,
      max_value: reading.max_limit,
      unit: reading.unit,
      measured_at: saved.measured_at,
      recorded_by: saved.recorded_by,
      status: 'open',
      acknowledgement_note: ''
     });
    }
   }
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
   if (table === 'temperature_points' || table === 'water_pools' || table === 'water_pool_parameters') {
    Object.assign(current, patch);
    return {data: {...current}, error: null};
   }
   if (table === 'water_alerts') {
    if (current.status !== 'open') return {data: null, error: {code: 'P0001', message: 'Diese Warnung wurde bereits quittiert.'}};
    Object.assign(current, {status: patch.status, acknowledgement_note: patch.acknowledgement_note, acknowledged_by: options.userId, acknowledged_at: now});
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

function hygieneValues(overrides = {}) {
 return {
  free_chlorine: '0.50',
  combined_chlorine: '0.20',
  ph: '7.20',
  temperature: '28.0',
  ...overrides
 };
}

function parameter(bundle, poolId, code) {
 return bundle.waterPoolParameters.find(item => item.poolId === poolId && item.parameterCode === code);
}

test('Wasserhygiene trennt Betriebe, Grenzen, Historie und Quittierung', async () => {
 assert.equal(createWaterPool(emptyOperations(), {facility, name: 'Schwimmer', scheduleMode: 'daily'}, employee, now).ok, false);
 const created = createWaterPool(emptyOperations(), {facility, name: 'Schwimmer', scheduleMode: 'daily', intervalCount: 1}, manager, now);
 assert.equal(created.ok, true);
 assert.deepEqual(waterParameterCatalog.map(item => item.code), ['free_chlorine', 'combined_chlorine', 'ph', 'temperature']);
 assert.deepEqual(created.parameters.map(item => item.parameterCode), ['free_chlorine', 'combined_chlorine', 'ph', 'temperature']);
 assert.equal(created.parameters.every(item => item.required === true && item.active === true && item.minValue == null && item.maxValue == null), true);
 const migration = readFileSync(new URL('../../tageswerk_3_3_water_hygiene.sql', import.meta.url), 'utf8');
 assert.match(migration, /'free_chlorine', 'Freies Chlor'/);
 assert.match(migration, /'combined_chlorine', 'Gebundenes Chlor'/);
 assert.match(migration, /'ph', 'pH-Wert'/);
 assert.match(migration, /'temperature', 'Wassertemperatur'/);
 assert.doesNotMatch(migration, /redox/);
 assert.equal(createWaterPool(created.bundle, {facility: second, name: 'Strand', scheduleMode: 'daily'}, manager, now).ok, false);
 const strand = createWaterPool(created.bundle, {facility: second, name: 'Strand', scheduleMode: 'weekly', intervalCount: 1}, admin, now);
 assert.equal(strand.ok, true);
 assert.equal(createWaterPool(strand.bundle, {facility: foreign, name: 'Fremd', scheduleMode: 'daily'}, admin, now).ok, false);
 const ownLimit = updateWaterParameter(strand.bundle, parameter(strand.bundle, created.pool.id, 'ph').id, {minValue: '6.80', maxValue: '7.60', required: true, active: true}, manager);
 const strandLimit = updateWaterParameter(ownLimit.bundle, parameter(ownLimit.bundle, strand.pool.id, 'ph').id, {minValue: '7.00', maxValue: '7.40', required: true, active: true}, admin);
 assert.equal(updateWaterParameter(strandLimit.bundle, parameter(strandLimit.bundle, created.pool.id, 'ph').id, {minValue: '1', maxValue: '2'}, employee).ok, false);
 assert.equal(updateWaterParameter(strandLimit.bundle, parameter(strandLimit.bundle, created.pool.id, 'ph').id, {minValue: '1', maxValue: '2'}, otherEmployee).ok, false);
 const inside = recordWaterCheck(strandLimit.bundle, created.pool.id, {values: hygieneValues({ph: '7.50'})}, employee, now);
 assert.equal(inside.ok, true);
 assert.equal(inside.alerts.length, 0);
 const outsideStrand = recordWaterCheck(inside.bundle, strand.pool.id, {values: hygieneValues({ph: '7.50'})}, admin, now);
 assert.equal(outsideStrand.alerts.length, 1);
 assert.equal(outsideStrand.alerts[0].maxLimit, '7.40');
 assert.equal(outsideStrand.alerts[0].status, 'open');
 const changed = updateWaterParameter(outsideStrand.bundle, parameter(outsideStrand.bundle, created.pool.id, 'ph').id, {minValue: '6.80', maxValue: '7.20', required: true, active: true}, manager);
 const historic = changed.bundle.waterChecks.find(item => item.id === inside.check.id).readings.find(item => item.parameterCode === 'ph');
 assert.equal(historic.maxLimit, '7.60');
 assert.equal(historic.value, '7.50');
 assert.equal(changed.bundle.waterAlerts.some(item => item.poolId === created.pool.id), false);
 const later = recordWaterCheck(changed.bundle, created.pool.id, {values: hygieneValues({ph: '7.50'})}, employee, '2026-11-10T12:00:00.000Z');
 assert.equal(later.alerts.length, 1);
 assert.equal(later.alerts[0].maxLimit, '7.20');
 assert.equal(changed.bundle.waterChecks.find(item => item.id === inside.check.id).readings.find(item => item.parameterCode === 'ph').maxLimit, '7.60');
 const signed = acknowledgeWaterAlert(later.bundle, later.alerts[0].id, 'Zur Kenntnis genommen', employee, '2026-11-10T12:05:00.000Z');
 assert.equal(signed.ok, true);
 assert.equal(signed.alert.status, 'acknowledged');
 assert.notEqual(signed.alert.status, 'resolved');
 assert.equal(JSON.stringify(signed.bundle.waterChecks.find(item => item.id === later.check.id).readings), JSON.stringify(later.check.readings));
 const measured = recordWaterMeasure(signed.bundle, signed.alert.id, 'Frischwasser zugesetzt', employee, '2026-11-10T12:06:00.000Z');
 assert.equal(measured.ok, true);
 assert.equal(measured.alert.status, 'acknowledged');
 const repeat = recordWaterCheck(measured.bundle, created.pool.id, {values: hygieneValues({ph: '7.10'}), followUpAlertId: signed.alert.id}, employee, '2026-11-10T12:20:00.000Z');
 assert.equal(repeat.ok, true);
 assert.equal(repeat.check.followUpAlertId, signed.alert.id);
 assert.equal(repeat.bundle.waterAlerts.find(item => item.id === signed.alert.id).status, 'acknowledged');
 assert.equal(recordWaterCheck(repeat.bundle, created.pool.id, {values: hygieneValues({ph: ''})}, employee, now).ok, false);
 assert.equal(recordWaterCheck(repeat.bundle, created.pool.id, {values: hygieneValues({combined_chlorine: ''})}, employee, now).ok, false);
 assert.equal(recordWaterCheck(repeat.bundle, created.pool.id, {values: hygieneValues({free_chlorine: '30'})}, employee, now).ok, false);
 assert.equal(recordWaterCheck(repeat.bundle, created.pool.id, {values: hygieneValues({temperature: '28,50'})}, employee, now).ok, false);
 const comma = recordWaterCheck(repeat.bundle, created.pool.id, {values: hygieneValues({ph: '7,80', temperature: '28,5'})}, employee, '2026-11-10T13:00:00.000Z');
 assert.equal(comma.ok, true);
 assert.equal(comma.check.readings.find(item => item.parameterCode === 'ph').value, '7.80');
 assert.equal(comma.check.readings.find(item => item.parameterCode === 'temperature').value, '28.5');
 assert.equal(comma.alerts.some(item => item.parameterCode === 'ph' && item.value === '7.80'), true);
 assert.equal(recordWaterCheck(repeat.bundle, created.pool.id, {values: hygieneValues()}, otherEmployee, now).ok, false);
 assert.equal(recordWaterCheck(repeat.bundle, created.pool.id, {values: hygieneValues()}, inactive, now).ok, false);
 const paused = setWaterPoolActive(repeat.bundle, created.pool.id, false, manager);
 assert.equal(waterControlState(paused.pool, paused.bundle.waterChecks, paused.bundle.waterPoolParameters, now).due, false);
 assert.equal(recordWaterCheck(paused.bundle, created.pool.id, {values: hygieneValues()}, employee, now).ok, false);
 assert.equal(paused.bundle.waterChecks.length, repeat.bundle.waterChecks.length);
 const resumed = setWaterPoolActive(paused.bundle, created.pool.id, true, admin);
 assert.equal(resumed.pool.active, true);
 const timed = createWaterPool(emptyOperations(), {facility, name: 'Zeitplan', scheduleMode: 'times', scheduledTimes: '8:00, 14:00', weekdays: [1, 2, 3, 4, 5, 6, 7]}, manager, '2026-11-09T00:00:00.000Z');
 const beforeSlot = waterControlState(timed.pool, [], timed.parameters, '2026-11-09T06:30:00.000Z');
 assert.equal(beforeSlot.due, false);
 assert.match(beforeSlot.detail, /08:00/);
 const missedSlot = waterControlState(timed.pool, [], timed.parameters, '2026-11-09T07:30:00.000Z');
 assert.equal(missedSlot.due, true);
 assert.equal(missedSlot.bucket, 'today');
 const covered = recordWaterCheck(timed.bundle, timed.pool.id, {values: hygieneValues()}, employee, '2026-11-09T07:30:00.000Z');
 const waiting = waterControlState(timed.pool, covered.bundle.waterChecks, covered.bundle.waterPoolParameters, '2026-11-09T12:00:00.000Z');
 assert.equal(waiting.due, false);
 assert.match(waiting.detail, /14:00/);
 const afternoon = waterControlState(timed.pool, covered.bundle.waterChecks, covered.bundle.waterPoolParameters, '2026-11-09T13:30:00.000Z');
 assert.equal(afternoon.due, true);
 assert.match(afternoon.detail, /14:00/);
 const weekly = updateWaterPool(inside.bundle, created.pool.id, {name: 'Schwimmer', scheduleMode: 'weekly', intervalCount: 1}, manager);
 assert.equal(waterControlState(weekly.pool, weekly.bundle.waterChecks, weekly.bundle.waterPoolParameters, '2026-11-15T12:00:00.000Z').due, false);
 assert.equal(waterControlState(weekly.pool, weekly.bundle.waterChecks, weekly.bundle.waterPoolParameters, '2026-11-16T12:00:01.000Z').due, true);
 const overdue = createWaterPool(emptyOperations(), {facility, name: 'Gestern', scheduleMode: 'daily'}, manager, '2026-11-08T12:00:00.000Z');
 assert.equal(waterControlState(overdue.pool, [], overdue.parameters, now).bucket, 'overdue');
 const notices = facilityNotices(outsideStrand.bundle, [], {facilityIds: [facility.id], now, actor: employee});
 assert.equal(notices.some(item => item.facilityId === second.id), false);
 assert.equal(notices.some(item => item.kind === 'water-warning'), false);
 const strandNotices = facilityNotices(outsideStrand.bundle, [], {facilityIds: [second.id], now, actor: admin});
 assert.equal(strandNotices.some(item => item.kind === 'water-warning'), true);
 const metrics = operationMetrics(outsideStrand.bundle, [facility.id, second.id], '2026-11-09', now);
 assert.equal(metrics.waterOpen, 1);
 assert.equal(operationMetrics(overdue.bundle, [facility.id], '2026-11-09', now).waterMissing, 1);
 const db = controlDb({userId: manager.userId});
 const denied = await saveWaterPool(db, emptyOperations(), {facility, name: 'Schwimmer', scheduleMode: 'daily'}, employee, now, context);
 assert.equal(denied.ok, false);
 assert.equal(db.calls.some(call => call[0] === 'insert'), false);
 const saved = await saveWaterPool(db, emptyOperations(), {facility, name: 'Schwimmer', scheduleMode: 'times', scheduledTimes: '08:00, 14:00', weekdays: [1, 2, 3, 4, 5, 6, 7]}, manager, now, context);
 assert.equal(saved.ok, true);
 assert.equal(saved.bundle.waterPoolParameters.filter(item => item.poolId === saved.pool.id).length, 4);
 const employeeDb = controlDb({userId: employee.userId, rows: db.rows});
 const ph = parameter(saved.bundle, saved.pool.id, 'ph');
 const limited = await saveWaterParameter(db, saved.bundle, ph.id, {minValue: '6.80', maxValue: '7.60', required: true, active: true}, manager, now, context);
 assert.equal(limited.ok, true);
 const calm = await saveWaterCheck(employeeDb, limited.bundle, saved.pool.id, {values: hygieneValues({ph: '7.50'})}, employee, now, context);
 assert.equal(calm.ok, true);
 assert.equal(calm.alerts.length, 0);
 const tightened = await saveWaterParameter(db, calm.bundle, ph.id, {minValue: '6.80', maxValue: '7.20', required: true, active: true}, manager, now, context);
 assert.equal(tightened.ok, true);
 assert.equal(tightened.bundle.waterChecks.find(item => item.id === calm.check.id).readings.find(item => item.parameterCode === 'ph').maxLimit, '7.60');
 const hot = await saveWaterCheck(employeeDb, tightened.bundle, saved.pool.id, {values: hygieneValues({ph: '7.50'})}, employee, '2026-11-10T12:00:00.000Z', context);
 assert.equal(hot.ok, true);
 assert.equal(hot.alerts[0].maxLimit, '7.20');
 assert.equal(hot.bundle.waterChecks.find(item => item.id === calm.check.id).readings.find(item => item.parameterCode === 'ph').maxLimit, '7.60');
 const blocked = await saveWaterParameter(employeeDb, hot.bundle, ph.id, {minValue: '1', maxValue: '2', required: true, active: true}, employee, now, context);
 assert.equal(blocked.ok, false);
 assert.equal(employeeDb.calls.filter(call => call[0] === 'update' && call[1] === 'water_pool_parameters').length, 0);
 const acknowledged = await saveWaterAcknowledgement(employeeDb, hot.bundle, hot.alerts[0].id, 'Zur Kenntnis genommen', employee, now, context);
 assert.equal(acknowledged.ok, true);
 assert.equal(acknowledged.alert.status, 'acknowledged');
 assert.equal(acknowledged.alert.value, hot.alerts[0].value);
 const action = await saveWaterMeasure(employeeDb, acknowledged.bundle, acknowledged.alert.id, 'Frischwasser zugesetzt', employee, now, context);
 assert.equal(action.ok, true);
 assert.equal(action.alert.status, 'acknowledged');
 const follow = await saveWaterCheck(employeeDb, action.bundle, saved.pool.id, {values: hygieneValues({ph: '7.00'}), followUpAlertId: acknowledged.alert.id}, employee, now, context);
 assert.equal(follow.ok, true);
 assert.equal(follow.check.followUpAlertId, acknowledged.alert.id);
 const stopped = await saveWaterPoolActive(db, follow.bundle, saved.pool.id, false, manager, now, context);
 assert.equal(stopped.ok, true);
 assert.equal(waterControlState(stopped.pool, stopped.bundle.waterChecks, stopped.bundle.waterPoolParameters, now).due, false);
 assert.equal(stopped.bundle.waterChecks.length, follow.bundle.waterChecks.length);
 const again = await saveWaterPoolActive(db, stopped.bundle, saved.pool.id, true, admin, now, context);
 assert.equal(again.pool.active, true);
 const hiddenRows = structuredClone(db.rows);
 hiddenRows.temperature_points.push({id: 'own-point', organization_id: facility.organization_id, facility_id: facility.id, name: 'Becken', location: 'Halle', minimum_celsius: '24', maximum_celsius: '28', active: true, created_by: manager.userId, created_at: now});
 const waterMissing = await loadOperations(controlDb({missingTables: ['water_parameter_definitions', 'water_pools', 'water_pool_parameters', 'water_checks', 'water_alerts', 'water_alert_measures', 'water_round_drafts'], rows: hiddenRows}), employee, context);
 assert.equal(waterMissing.temperatureInstalled, true);
 assert.equal(waterMissing.waterInstalled, false);
 assert.equal(waterMissing.bundle.temperaturePoints.length, 1);
 assert.equal(waterMissing.bundle.waterPools.length, 0);
 const temperatureMissing = await loadOperations(controlDb({missingTables: ['temperature_points', 'temperature_readings', 'temperature_alerts'], rows: hiddenRows}), employee, context);
 assert.equal(temperatureMissing.temperatureInstalled, false);
 assert.equal(temperatureMissing.waterInstalled, true);
 assert.equal(temperatureMissing.bundle.waterPools.length, 1);
 assert.equal(addWaterParameter(again.bundle, saved.pool.id, 'ph', manager, now).ok, false);
 const extended = {
  ...created.bundle,
  waterParameters: [...waterParameterCatalog, {code: 'ozone', name: 'Ozon', unit: 'mg/l', decimals: 2, minPlausible: 0, maxPlausible: 5, sortOrder: 5, active: true}]
 };
 const ozone = addWaterParameter(extended, created.pool.id, 'ozone', manager, now);
 assert.equal(ozone.ok, true);
 assert.equal(recordWaterCheck(ozone.bundle, created.pool.id, {values: hygieneValues()}, employee, now).ok, false);
 const withOzone = recordWaterCheck(ozone.bundle, created.pool.id, {values: {...hygieneValues(), ozone: '0,20'}}, employee, now);
 assert.equal(withOzone.ok, true);
 assert.equal(withOzone.check.readings.find(item => item.parameterCode === 'ozone').value, '0.20');
});

test('Techniker sehen die Wasserhistorie und verändern keine Grenzwerte', () => {
 const technician = {userId: 'technician-1', name: 'Timo', memberships: [membership('technician')]};
 const mixed = {userId: 'mixed-1', name: 'Mira', memberships: [membership('technician'), membership('employee', second)]};
 const created = createWaterPool(emptyOperations(), {facility, name: 'Schwimmer', scheduleMode: 'daily', intervalCount: 1}, manager, now);
 const strand = createWaterPool(created.bundle, {facility: second, name: 'Strand', scheduleMode: 'daily', intervalCount: 1}, admin, now);
 const oldOwn = recordWaterCheck(strand.bundle, created.pool.id, {values: hygieneValues({ph: '8.20'})}, manager, '2026-11-08T10:00:00.000Z');
 const oldStrand = recordWaterCheck(oldOwn.bundle, strand.pool.id, {values: hygieneValues()}, admin, '2026-11-08T10:00:00.000Z');
 const currentOwn = recordWaterCheck(oldStrand.bundle, created.pool.id, {values: hygieneValues()}, technician, now);
 const ownToday = recordWaterCheck(currentOwn.bundle, created.pool.id, {values: hygieneValues()}, employee, now);
 assert.equal(currentOwn.ok, true);
 const withForeign = {
  ...ownToday.bundle,
  waterChecks: [...ownToday.bundle.waterChecks, {id: 'foreign-check', poolId: 'foreign-pool', facilityId: foreign.id, organizationId: foreign.organization_id, measuredAt: '2026-11-01T10:00:00.000Z', readings: [{parameterCode: 'ph', value: '7.00'}]}],
  waterPools: [...ownToday.bundle.waterPools, {id: 'foreign-pool', facilityId: foreign.id, organizationId: foreign.organization_id, name: 'Fremdbecken', scheduleMode: 'daily', intervalCount: 1}]
 };
 const employeeRows = waterRowsForMember(withForeign, employee.memberships, now, employee.userId);
 const technicianRows = waterRowsForMember(withForeign, technician.memberships, now, technician.userId);
 const managerRows = waterRowsForMember(withForeign, manager.memberships, now, manager.userId);
 const adminRows = waterRowsForMember(withForeign, admin.memberships, now, admin.userId);
 const mixedRows = waterRowsForMember(withForeign, mixed.memberships, now, mixed.userId);
 assert.equal(employeeRows.checks.length, 0);
 assert.equal(employeeRows.alerts.length, 0);
 assert.equal(employeeRows.checks.some(item => item.recordedBy === technician.userId || item.recordedBy === employee.userId), false);
 assert.equal(technicianRows.checks.some(item => item.facilityId === facility.id && item.measuredAt === '2026-11-08T10:00:00.000Z'), true);
 assert.equal(managerRows.checks.some(item => item.facilityId === facility.id && item.measuredAt === '2026-11-08T10:00:00.000Z'), true);
 assert.equal(adminRows.checks.some(item => item.facilityId === second.id), true);
 assert.equal(technicianRows.checks.some(item => item.facilityId === foreign.id), false);
 assert.equal(mixedRows.checks.some(item => item.facilityId === facility.id && item.measuredAt === '2026-11-08T10:00:00.000Z'), true);
 assert.equal(mixedRows.checks.some(item => item.facilityId === second.id && item.measuredAt === '2026-11-08T10:00:00.000Z'), false);
 assert.equal(updateWaterParameter(currentOwn.bundle, parameter(currentOwn.bundle, created.pool.id, 'ph').id, {minValue: '6.80', maxValue: '7.60', required: true, active: true}, technician).ok, false);
 assert.equal(updateWaterPool(currentOwn.bundle, created.pool.id, {name: 'Anders', scheduleMode: 'weekly', intervalCount: 2}, technician).ok, false);
 assert.equal(setWaterPoolActive(currentOwn.bundle, created.pool.id, false, technician).ok, false);
 assert.equal(createWaterPool(currentOwn.bundle, {facility, name: 'Neues Becken', scheduleMode: 'daily'}, technician, now).ok, false);
 const point = createTemperaturePoint(emptyOperations(), {facility, name: 'Becken', location: 'Halle', minimum: '20', maximum: '30'}, manager, now);
 assert.equal(recordTemperature(point.bundle, point.point.id, {value: '24'}, technician, now).ok, true);
 assert.equal(createTemperaturePoint(point.bundle, {facility, name: 'Weiter', location: 'Keller', minimum: '1', maximum: '2'}, technician, now).ok, false);
 const csv = waterMeasurementCsv({...withForeign, ...technicianRows}, facility.id);
 assert.match(csv, /Freies Chlor/);
 assert.match(csv, /8\.20|8,20/);
 assert.doesNotMatch(csv, /Fremdbecken/);
 const roleMigration = readFileSync(new URL('../../tageswerk_3_4_technician_role.sql', import.meta.url), 'utf8');
 const waterMigration = readFileSync(new URL('../../tageswerk_3_3_water_hygiene.sql', import.meta.url), 'utf8');
 assert.match(roleMigration, /m\.role = 'technician'/);
 assert.match(roleMigration, /IN \('employee', 'technician'\)/);
 assert.match(waterMigration, /tageswerk_water_check_in_round/);
 assert.match(waterMigration, /'technician', 'facility_manager', 'company_admin'/);
 assert.match(waterMigration, /water_pools_update[\s\S]{0,240}IN \('company_admin', 'facility_manager'\)/);
 assert.doesNotMatch(waterMigration, /redox/);
});

function finishWaterDraft(db, roundId, userId) {
 for (const draft of db.rows.water_round_drafts || []) {
  if (draft.round_id === roundId && draft.user_id === userId && draft.status === 'open') {
   draft.status = 'completed';
   draft.revision = Number(draft.revision || 1) + 1;
  }
 }
}

function withWaterRound(db, userId, failAt = -1) {
 db.rpc = async (name, args) => {
  if (name !== 'tageswerk_record_water_round') return {data: null, error: {code: '42883', message: 'function does not exist'}};
  if (!args?.p_round_id || !Array.isArray(args.p_checks) || args.p_checks.length < 1) {
   return {data: null, error: {code: 'P0001', message: 'Die Kontrollrunde ist unvollständig.'}};
  }
  const duplicate = args.p_checks.some(item => db.rows.water_checks.some(row => row.round_id === args.p_round_id && row.pool_id === item.pool_id));
  if (duplicate) {
   finishWaterDraft(db, args.p_round_id, userId);
   return {data: {status: 'already_stored', round_id: args.p_round_id}, error: null};
  }
  const checks = db.rows.water_checks.map(row => structuredClone(row));
  const alerts = db.rows.water_alerts.map(row => structuredClone(row));
  const drafts = (db.rows.water_round_drafts || []).map(row => structuredClone(row));
  const ids = [];
  for (let index = 0; index < args.p_checks.length; index += 1) {
   if (index === failAt) {
    db.rows.water_checks.splice(0, db.rows.water_checks.length, ...checks);
    db.rows.water_alerts.splice(0, db.rows.water_alerts.length, ...alerts);
    if (db.rows.water_round_drafts) db.rows.water_round_drafts.splice(0, db.rows.water_round_drafts.length, ...drafts);
    return {data: null, error: {code: 'P0001', message: 'Die Kontrollrunde ist unvollständig.'}};
   }
   const item = args.p_checks[index];
   const inserted = await db.insert('water_checks', {
    pool_id: item.pool_id,
    facility_id: item.facility_id,
    note: item.note || '',
    round_id: args.p_round_id,
    readings: item.readings
   });
   if (inserted.error) {
    db.rows.water_checks.splice(0, db.rows.water_checks.length, ...checks);
    db.rows.water_alerts.splice(0, db.rows.water_alerts.length, ...alerts);
    if (db.rows.water_round_drafts) db.rows.water_round_drafts.splice(0, db.rows.water_round_drafts.length, ...drafts);
    return inserted;
   }
   ids.push(inserted.data.id);
  }
  finishWaterDraft(db, args.p_round_id, userId);
  return {data: {status: 'stored', round_id: args.p_round_id, ids}, error: null};
 };
 return db;
}

function seedWaterLimits(db, pools) {
 for (const pool of pools) {
  for (const code of ['free_chlorine', 'combined_chlorine', 'ph', 'temperature']) {
   db.rows.water_pool_parameters.push({
    id: `${pool.id}-${code}`,
    pool_id: pool.id,
    facility_id: pool.facilityId,
    organization_id: pool.organizationId,
    parameter_code: code,
    required: true,
    active: true,
    min_value: code === 'ph' ? '6.50' : null,
    max_value: code === 'ph' ? '7.60' : null
   });
  }
 }
}

test('Kontrollrunden bleiben vollständig, unterbrechbar und je Rolle getrennt', async () => {
 const kinder = createWaterPool(emptyOperations(), {facility, name: 'Kinder', scheduleMode: 'daily', intervalCount: 1}, manager, now);
 const schwimmer = createWaterPool(kinder.bundle, {facility, name: 'Schwimmer', scheduleMode: 'daily', intervalCount: 1}, manager, now);
 const paused = createWaterPool(schwimmer.bundle, {facility, name: 'Lehrschwimm', scheduleMode: 'daily', intervalCount: 1}, manager, now);
 const inactive = setWaterPoolActive(paused.bundle, paused.pool.id, false, manager);
 const strand = createWaterPool(inactive.bundle, {facility: second, name: 'Strand', scheduleMode: 'daily', intervalCount: 1}, admin, now);
 let bundle = strand.bundle;
 for (const pool of [kinder.pool, schwimmer.pool]) {
  bundle = updateWaterParameter(bundle, parameter(bundle, pool.id, 'ph').id, {minValue: '6.50', maxValue: '7.60', required: true, active: true}, manager).bundle;
 }
 const pools = waterRoundPools(bundle, facility.id);
 assert.deepEqual(pools.map(pool => pool.name), ['Kinder', 'Schwimmer']);
 const previousStorage = globalThis.sessionStorage;
 const bucket = new Map();
 globalThis.sessionStorage = {
  getItem(key) { return bucket.has(key) ? bucket.get(key) : null; },
  setItem(key, value) { bucket.set(key, String(value)); },
  removeItem(key) { bucket.delete(key); }
 };
 try {
  clearWaterRound(employee.userId, facility.id);
  let round = emptyWaterRound(facility.id, 'round-1');
  round = moveWaterRound(round, pools, 1, {values: hygieneValues(), note: 'erst'});
  round = rememberWaterEntry(round, schwimmer.pool.id, {values: hygieneValues({temperature: '27,5'}), note: 'später'});
  assert.equal(round.index, 1);
  assert.equal(round.entries[kinder.pool.id].note, 'erst');
  const back = moveWaterRound(round, pools, -1, round.entries[schwimmer.pool.id]);
  assert.equal(back.index, 0);
  assert.equal(back.entries[schwimmer.pool.id].values.temperature, '27,5');
  assert.equal(waterRoundProgress(bundle, back, pools, employee, now).filled, 2);
  storeWaterRound(employee.userId, back);
  clearWaterRound(employee.userId, facility.id);
  assert.equal(loadWaterRound(employee.userId, facility.id), null);
  const resumed = roundFromWaterDraft({
   facilityId: facility.id,
   userId: employee.userId,
   roundId: 'round-1',
   status: 'open',
   revision: 2,
   progress: {index: back.index, phase: 'edit'},
   entries: back.entries
  });
  assert.equal(resumed.roundId, 'round-1');
  assert.equal(resumed.entries[kinder.pool.id].note, 'erst');
  assert.equal(resumed.entries[schwimmer.pool.id].values.temperature, '27,5');
  const incomplete = reviewWaterRound(bundle, {...resumed, entries: {...resumed.entries, [schwimmer.pool.id]: {values: hygieneValues({ph: ''}), note: ''}}}, employee, now);
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.error, /Schwimmer/);
  const breach = reviewWaterRound(bundle, {...resumed, entries: {...resumed.entries, [kinder.pool.id]: {values: hygieneValues({ph: '8,20'}), note: 'hoch'}}}, employee, now);
  assert.equal(breach.ok, true);
  assert.equal(breach.checks.length, 2);
  assert.equal(breach.bundle.waterAlerts.some(item => item.poolId === kinder.pool.id && item.parameterCode === 'ph'), true);
  assert.equal(reviewWaterRound(bundle, resumed, inactive, now).ok, false);
  const historicReadings = [{parameterCode: 'ph', value: '7.10', unit: '', minLimit: '6.50', maxLimit: '7.60'}];
  const withHistory = {
   ...bundle,
   waterChecks: [{
    id: 'historic-1', poolId: kinder.pool.id, facilityId: facility.id, organizationId: facility.organization_id,
    measuredAt: '2026-11-01T10:00:00.000Z', recordedBy: manager.userId, recordedName: 'Lea', note: 'alt', roundId: null, readings: historicReadings
   }]
  };
  const db = withWaterRound(controlDb({userId: employee.userId}), employee.userId);
  seedWaterLimits(db, [kinder.pool, schwimmer.pool]);
  db.rows.water_checks.push({
   id: 'historic-1', pool_id: kinder.pool.id, facility_id: facility.id, organization_id: facility.organization_id,
   measured_at: '2026-11-01T10:00:00.000Z', recorded_by: manager.userId, note: 'alt', round_id: null,
   readings: [{parameter_code: 'ph', value: '7.10', unit: '', min_limit: '6.50', max_limit: '7.60'}]
  });
  const ready = {...resumed, entries: {...resumed.entries, [kinder.pool.id]: {values: hygieneValues({ph: '8,20'}), note: 'hoch'}}};
  const saved = await saveWaterRound(db, withHistory, ready, employee, now, context);
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.id, 'round-1');
  assert.equal(saved.bundle.waterChecks.some(item => item.roundId === 'round-1'), false);
  assert.equal(db.rows.water_checks.filter(row => row.round_id === 'round-1').length, 2);
  assert.equal(db.rows.water_alerts.some(item => item.parameter_code === 'ph' && item.value_amount === '8.20'), true);
  assert.equal(saved.bundle.waterChecks.find(item => item.id === 'historic-1').readings[0].value, '7.10');
  const again = await saveWaterRound(db, withHistory, ready, employee, now, context);
  assert.equal(again.ok, true, again.error);
  assert.equal(db.rows.water_checks.filter(row => row.round_id === 'round-1').length, 2);
  assert.deepEqual(again.ids, []);
  const rollback = withWaterRound(controlDb({userId: employee.userId}), employee.userId, 1);
  seedWaterLimits(rollback, [kinder.pool, schwimmer.pool]);
  const failed = await saveWaterRound(rollback, bundle, ready, employee, now, context);
  assert.equal(failed.ok, false);
  assert.equal(rollback.rows.water_checks.length, 0);
  assert.equal(rollback.rows.water_alerts.length, 0);
  const technician = {userId: 'technician-1', name: 'Timo', memberships: [membership('technician')]};
  const technicianDb = withWaterRound(controlDb({userId: technician.userId}), technician.userId);
  seedWaterLimits(technicianDb, [kinder.pool, schwimmer.pool]);
  const technicianRound = {...ready, roundId: 'round-tech'};
  const technicianSaved = await saveWaterRound(technicianDb, bundle, technicianRound, technician, now, context);
  assert.equal(technicianSaved.ok, true);
  const managerSaved = await saveWaterRound(withWaterRound(controlDb({userId: manager.userId}), manager.userId), bundle, {...ready, roundId: 'round-manager'}, manager, now, context);
  assert.equal(managerSaved.ok, true);
  const adminRound = emptyWaterRound(second.id, 'round-admin');
  adminRound.entries[strand.pool.id] = {values: hygieneValues(), note: ''};
  const adminSaved = await saveWaterRound(withWaterRound(controlDb({userId: admin.userId}), admin.userId), bundle, adminRound, admin, now, context);
  assert.equal(adminSaved.ok, true);
  const employeeStored = db.rows.water_checks.filter(row => row.round_id === 'round-1').map(row => ({
   id: row.id,
   poolId: row.pool_id,
   facilityId: row.facility_id,
   organizationId: row.organization_id,
   measuredAt: row.measured_at,
   recordedBy: row.recorded_by,
   recordedName: 'Mia',
   roundId: row.round_id,
   readings: row.readings.map(reading => ({
    parameterCode: reading.parameter_code,
    value: String(reading.value),
    unit: reading.unit || '',
    minLimit: reading.min_limit == null ? null : String(reading.min_limit),
    maxLimit: reading.max_limit == null ? null : String(reading.max_limit)
   }))
  }));
  const combined = {
   ...bundle,
   waterChecks: [...saved.bundle.waterChecks, ...employeeStored, ...technicianSaved.bundle.waterChecks, ...adminSaved.bundle.waterChecks],
   waterPools: bundle.waterPools
  };
  const employeeView = waterRowsForMember(combined, employee.memberships, now, employee.userId);
  const technicianView = waterRowsForMember(combined, technician.memberships, now, technician.userId);
  const managerView = waterRowsForMember(combined, manager.memberships, now, manager.userId);
  const adminView = waterRowsForMember(combined, admin.memberships, now, admin.userId);
  assert.equal(employeeView.checks.length, 0);
  assert.equal(employeeView.checks.some(item => item.facilityId === second.id), false);
  assert.equal(technicianView.checks.some(item => item.recordedBy === employee.userId), true);
  assert.equal(technicianView.checks.some(item => item.facilityId === second.id), false);
  assert.equal(managerView.checks.some(item => item.recordedBy === technician.userId), true);
  assert.equal(adminView.checks.some(item => item.facilityId === second.id), true);
  const rows = waterHistoryRows(combined, facility.id, {from: '2026-11-09', to: '2026-11-09', poolId: kinder.pool.id, recordedBy: employee.userId});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].values.ph.value, '8.20');
  assert.match(rows[0].limitStatus, /Abweichung/);
  assert.equal(waterHistoryRows(combined, facility.id, {from: '2026-11-10', to: '2026-11-10'}).length, 0);
  const csv = waterHistoryCsv(waterHistoryRows(technicianView, facility.id, {}));
  assert.match(csv, /Datum;Uhrzeit;Becken;Freies Chlor;Gebundenes Chlor;pH-Wert;Wassertemperatur;Mitarbeiter;Grenzwertstatus/);
  assert.doesNotMatch(csv, /Strand/);
  assert.equal(waterHistoryRows(employeeView, facility.id, {}).some(row => row.recordedName === 'Timo'), false);
  const waterMigration = readFileSync(new URL('../../tageswerk_3_3_water_hygiene.sql', import.meta.url), 'utf8');
  const roleMigration = readFileSync(new URL('../../tageswerk_3_4_technician_role.sql', import.meta.url), 'utf8');
  assert.match(waterMigration, /tageswerk_record_water_round/);
  assert.match(waterMigration, /recorded_by = auth\.uid\(\)/);
  assert.match(waterMigration, /Gespeicherte Hygienemessungen bleiben unverändert/);
  assert.match(waterMigration, /1\. tageswerk_3_1_temperature\.sql/);
  assert.match(roleMigration, /tageswerk_3_3_water_hygiene\.sql, diese Datei, danach tageswerk_3_4_invitation_role\.sql/);
  assert.doesNotMatch(waterMigration, /set_config\('tageswerk\.water_round_close/);
  assert.doesNotMatch(waterMigration, /redox/);
 } finally {
  clearWaterRound(employee.userId, facility.id);
  if (previousStorage === undefined) delete globalThis.sessionStorage;
  else globalThis.sessionStorage = previousStorage;
 }
});

test('Messhistorie, Kontrollrunde und Einladung bleiben in den vorbereiteten Regeln begrenzt', () => {
 const waterMigration = readFileSync(new URL('../../tageswerk_3_3_water_hygiene.sql', import.meta.url), 'utf8');
 const roleMigration = readFileSync(new URL('../../tageswerk_3_4_technician_role.sql', import.meta.url), 'utf8');
 const invitationMigration = readFileSync(new URL('../../tageswerk_3_4_invitation_role.sql', import.meta.url), 'utf8');
 const roundSource = readFileSync(new URL('../../js/operations-controls.js', import.meta.url), 'utf8');
 const roundFunction = waterMigration.slice(waterMigration.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_record_water_round'), waterMigration.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_discard_water_round_draft'));
 const checkSelect = waterMigration.slice(waterMigration.indexOf('CREATE POLICY water_checks_select'), waterMigration.indexOf('CREATE POLICY water_checks_insert'));
 assert.match(waterMigration, /GRANT SELECT, INSERT ON TABLE public\.water_checks TO authenticated;/);
 assert.doesNotMatch(waterMigration, /GRANT (UPDATE|DELETE)[^;]*water_checks/);
 assert.doesNotMatch(waterMigration, /CREATE POLICY water_checks_update/);
 assert.match(roundFunction, /SET search_path = ''/);
 assert.doesNotMatch(roundFunction, /SECURITY DEFINER/);
 assert.match(roundFunction, /already_stored/);
 assert.doesNotMatch(roundFunction, /FROM public\.water_checks/);
 assert.match(roundFunction, /UPDATE public\.water_round_drafts/);
 assert.match(roundFunction, /status = 'completed'/);
 const draftSelect = waterMigration.slice(waterMigration.indexOf('CREATE POLICY water_round_drafts_select'), waterMigration.indexOf('CREATE POLICY water_round_drafts_insert'));
 assert.match(draftSelect, /user_id = auth\.uid\(\)/);
 assert.match(draftSelect, /status = 'open'/);
 assert.match(waterMigration, /CREATE UNIQUE INDEX water_round_drafts_one_open/);
 assert.doesNotMatch(waterMigration, /GRANT DELETE[^;]*water_round_drafts/);
 const saveFunction = waterMigration.slice(waterMigration.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_save_water_round_draft'), waterMigration.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_record_water_round'));
 assert.match(saveFunction, /SET search_path = ''/);
 assert.doesNotMatch(saveFunction, /SECURITY DEFINER/);
 assert.match(saveFunction, /tageswerk_facility_organization/);
 assert.match(saveFunction, /'conflict'/);
 assert.doesNotMatch(saveFunction, /water_round_close/);
 assert.doesNotMatch(saveFunction, /water_checks/);
 const updatePolicy = waterMigration.slice(waterMigration.indexOf('CREATE POLICY water_round_drafts_update'), waterMigration.indexOf('REVOKE ALL ON TABLE public.water_parameter_definitions'));
 assert.match(updatePolicy, /tageswerk_water_round_checks_in_transaction\(round_id, facility_id\)/);
 assert.match(updatePolicy, /tageswerk_water_round_discard_in_transaction\(round_id\)/);
 assert.match(updatePolicy, /status = 'open'/);
 assert.doesNotMatch(updatePolicy, /current_setting/);
 assert.doesNotMatch(updatePolicy, /status IN \('open', 'completed'\)/);
 const guardFunction = waterMigration.slice(waterMigration.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_guard_water_round_draft'), waterMigration.indexOf('CREATE TRIGGER water_round_drafts_bind_facility'));
 assert.match(guardFunction, /Der Entwurf wird nur über die vorgesehene Funktion abgeschlossen oder verworfen/);
 assert.match(guardFunction, /tageswerk_water_round_checks_in_transaction/);
 assert.match(guardFunction, /tageswerk_water_round_discard_in_transaction/);
 assert.doesNotMatch(guardFunction, /current_setting/);
 const successPath = roundFunction.slice(0, roundFunction.indexOf('WHEN unique_violation'));
 const insertedAt = successPath.indexOf('INSERT INTO public.water_checks');
 const closedAt = successPath.lastIndexOf('UPDATE public.water_round_drafts');
 assert.ok(insertedAt >= 0 && closedAt > insertedAt);
 assert.doesNotMatch(successPath, /set_config/);
 const proof = waterMigration.slice(waterMigration.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_water_round_checks_in_transaction'), waterMigration.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_water_round_discard_in_transaction'));
 assert.match(proof, /RETURNS boolean/);
 assert.match(proof, /SECURITY DEFINER/);
 assert.match(proof, /SET search_path = ''/);
 assert.match(proof, /check_row\.recorded_by = auth\.uid\(\)/);
 assert.match(proof, /check_row\.xmin = pg_current_xact_id\(\)::xid/);
 assert.doesNotMatch(proof, /jsonb_build_object/);
 const discardFunction = waterMigration.slice(waterMigration.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_discard_water_round_draft'), waterMigration.indexOf('REVOKE ALL ON FUNCTION public.tageswerk_water_schedule_valid'));
 assert.match(discardFunction, /SECURITY DEFINER/);
 assert.match(discardFunction, /SET search_path = ''/);
 assert.match(discardFunction, /INSERT INTO public\.water_round_discards/);
 assert.doesNotMatch(discardFunction, /water_checks/);
 assert.doesNotMatch(discardFunction, /set_config/);
 assert.match(discardFunction, /user_id = auth\.uid\(\)/);
 assert.match(discardFunction, /'discarded'/);
 assert.match(waterMigration, /REVOKE ALL ON TABLE public\.water_round_discards FROM PUBLIC, anon, authenticated;/);
 assert.doesNotMatch(waterMigration, /GRANT [^;]*water_round_discards/);
 assert.doesNotMatch(waterMigration, /set_config\('tageswerk\.water_round_close/);
 let withoutBoundedDefiners = waterMigration;
 for (const name of ['tageswerk_water_round_checks_in_transaction', 'tageswerk_water_round_discard_in_transaction', 'tageswerk_discard_water_round_draft']) {
  const start = withoutBoundedDefiners.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  const end = withoutBoundedDefiners.indexOf('$tageswerk$;', start);
  withoutBoundedDefiners = withoutBoundedDefiners.slice(0, start) + withoutBoundedDefiners.slice(end + '$tageswerk$;'.length);
 }
 assert.doesNotMatch(withoutBoundedDefiners, /SECURITY DEFINER/);
 assert.match(checkSelect, /'technician', 'facility_manager', 'company_admin'/);
 assert.doesNotMatch(checkSelect, /employee/);
 assert.match(waterMigration, /pg_catalog\.pg_trigger_depth\(\) > 0/);
 assert.match(roleMigration, /WHEN 'technician' THEN 3/);
 assert.match(roleMigration, /t\.typtype = 'e'/);
 assert.match(roleMigration, /ADD VALUE/);
 assert.match(roleMigration, /entspricht nicht der geprüften Fassung aus Tageswerk 2\.9 und wurde nicht ersetzt/);
 assert.match(roleMigration, /memberships_role_check/);
 assert.doesNotMatch(roleMigration, /UPDATE public\.memberships SET role = 'technician'/);
 assert.match(roleMigration, /UPDATE public\.memberships SET role = p_role WHERE id = v_existing/);
 assert.match(roleMigration, /Geschaeftsfuehrungsrechte werden hier nicht veraendert/);
 assert.match(roleMigration, /actor_role IN \(''employee'', ''technician''\) AND NEW\.reading_type <> ''regular''/);
 assert.match(roleMigration, /Stornieren darf die Betriebsleitung oder Geschäftsführung/);
 assert.doesNotMatch(roleMigration, /DROP (TABLE|POLICY)[^;]*water_round/);
 assert.doesNotMatch(roleMigration, /ADD COLUMN role/);
 assert.match(invitationMigration, /ADD COLUMN role text NOT NULL DEFAULT 'employee'/);
 assert.doesNotMatch(roleMigration, /tageswerk_guard_invitation_role/);
 assert.match(invitationMigration, /accept_staff_invitation entspricht nicht der geprüften Fassung und wurde nicht ersetzt/);
 assert.match(invitationMigration, /CREATE OR REPLACE FUNCTION public\.accept_staff_invitation\(\)/);
 assert.match(invitationMigration, /v_role := coalesce\(v_invitation\.role, 'employee'\)/);
 assert.match(invitationMigration, /Eine Einladung kann nur Mitarbeiter oder Techniker vorsehen/);
 assert.match(roundSource, /sessionStorage/);
 assert.doesNotMatch(roundSource, /localStorage/);
 const loadSlice = roundSource.slice(roundSource.indexOf('export function loadWaterRound'), roundSource.indexOf('export function storeWaterRound'));
 assert.doesNotMatch(loadSlice, /sessionStorage/);
 const appSource = readFileSync(new URL('../../js/app.js', import.meta.url), 'utf8');
 const roundUi = readFileSync(new URL('../../js/operations-ui.js', import.meta.url), 'utf8');
 assert.match(appSource, /clearLocalWaterDrafts\(\)/);
 assert.match(roundUi, /Kontrollrunde fortsetzen/);
 assert.match(roundUi, /Kontrollrunde verwerfen/);
 assert.match(roundUi, /confirm\('Kontrollrunde verwerfen\? Die erfassten Werte werden nicht als Messung gespeichert\.'\)/);
 assert.match(roundUi, /waterDraftSaveDelay/);
 const previousStorage = globalThis.sessionStorage;
 const bucket = new Map();
 globalThis.sessionStorage = {
  getItem(key) { return bucket.has(key) ? bucket.get(key) : null; },
  setItem(key, value) { bucket.set(key, String(value)); },
  removeItem(key) { bucket.delete(key); },
  key(index) { return [...bucket.keys()][index] || null; },
  get length() { return bucket.size; }
 };
 try {
  storeWaterRound(employee.userId, emptyWaterRound(facility.id, 'round-browser'));
  sessionStorage.setItem(`tageswerk-water-round:${employee.userId}:${facility.id}`, '{"roundId":"round-browser"}');
  clearLocalWaterDrafts();
  assert.equal(loadWaterRound(employee.userId, facility.id), null);
  assert.equal(sessionStorage.getItem(`tageswerk-water-round:${employee.userId}:${facility.id}`), null);
 } finally {
  clearLocalWaterDrafts();
  if (previousStorage === undefined) delete globalThis.sessionStorage;
  else globalThis.sessionStorage = previousStorage;
 }
});

function draftRpc(drafts, userId, allowedFacilityIds) {
 return async (name, args) => {
  if (name !== 'tageswerk_save_water_round_draft') return {data: null, error: {code: '42883', message: 'function does not exist'}};
  if (!allowedFacilityIds.includes(args?.p_facility_id)) return {data: null, error: {code: 'P0001', message: 'Keine Berechtigung für diesen Betrieb.'}};
  if (!args?.p_round_id || typeof args.p_entries !== 'object' || typeof args.p_progress !== 'object') {
   return {data: null, error: {code: 'P0001', message: 'Der Entwurf ist unvollständig.'}};
  }
  const revision = Number(args.p_revision) || 0;
  const existing = drafts.find(item => item.facility_id === args.p_facility_id && item.user_id === userId && item.status === 'open');
  if (!existing) {
   if (revision > 0 || drafts.some(item => item.round_id === args.p_round_id)) {
    return {data: {status: 'conflict', round_id: args.p_round_id, revision}, error: null};
   }
   const row = {
    id: `draft-${drafts.length + 1}`,
    organization_id: facility.organization_id,
    facility_id: args.p_facility_id,
    user_id: userId,
    round_id: args.p_round_id,
    entries: args.p_entries,
    progress: args.p_progress,
    status: 'open',
    revision: 1,
    created_at: now,
    updated_at: now
   };
   drafts.push(row);
   return {data: {status: 'stored', round_id: row.round_id, revision: 1, updated_at: now}, error: null};
  }
  if (existing.round_id !== args.p_round_id || existing.revision !== revision) {
   return {data: {status: 'conflict', round_id: existing.round_id, revision: existing.revision}, error: null};
  }
  existing.entries = args.p_entries;
  existing.progress = args.p_progress;
  existing.revision += 1;
  existing.updated_at = now;
  return {data: {status: 'stored', round_id: existing.round_id, revision: existing.revision, updated_at: existing.updated_at}, error: null};
 };
}

test('Wasserentwürfe bleiben je Benutzer offen und überschreiben keine neuere Fassung', async () => {
 assert.equal(waterDraftSaveDelay, 700);
 assert.match(waterDraftStatusText.offline, /bleiben im Formular/);
 assert.match(waterDraftStatusText.saving, /Wird gespeichert/);
 assert.match(waterDraftStatusText.saved, /Entwurf gespeichert/);
 assert.match(waterDraftStatusText.conflict, /neuere Entwurf/);
 clearLocalWaterDrafts();
 const visibleDb = controlDb({userId: employee.userId});
 visibleDb.rows.water_round_drafts.push(
  {id: 'own', organization_id: facility.organization_id, facility_id: facility.id, user_id: employee.userId, round_id: 'round-own', entries: {pool: {values: {ph: '7,10'}, note: 'bleibt'}}, progress: {index: 1, phase: 'edit'}, status: 'open', revision: 3, created_at: now, updated_at: now},
  {id: 'done', organization_id: facility.organization_id, facility_id: facility.id, user_id: employee.userId, round_id: 'round-done', entries: {pool: {values: {ph: '8,20'}, note: 'fertig'}}, progress: {index: 0, phase: 'summary'}, status: 'completed', revision: 4, created_at: now, updated_at: now},
  {id: 'colleague', organization_id: facility.organization_id, facility_id: facility.id, user_id: 'employee-3', round_id: 'round-colleague', entries: {pool: {values: {ph: '1,00'}, note: 'fremd'}}, progress: {}, status: 'open', revision: 1, created_at: now, updated_at: now},
  {id: 'strand', organization_id: second.organization_id, facility_id: second.id, user_id: employee.userId, round_id: 'round-strand', entries: {pool: {values: {ph: '7,00'}, note: 'strand'}}, progress: {}, status: 'open', revision: 1, created_at: now, updated_at: now},
  {id: 'foreign', organization_id: foreign.organization_id, facility_id: foreign.id, user_id: employee.userId, round_id: 'round-foreign', entries: {pool: {values: {ph: '7,00'}, note: 'fremd'}}, progress: {}, status: 'open', revision: 1, created_at: now, updated_at: now}
 );
 const loaded = await loadOperations(visibleDb, employee, context);
 assert.equal(loaded.waterInstalled, true);
 assert.equal(loaded.bundle.waterRoundDrafts.length, 1);
 assert.equal(loaded.bundle.waterRoundDrafts[0].roundId, 'round-own');
 assert.equal(loaded.bundle.waterChecks.length, 0);
 assert.equal(loadWaterRound(employee.userId, facility.id), null);
 const resumed = roundFromWaterDraft(ownOpenWaterDraft(loaded.bundle, facility.id, employee.userId));
 assert.equal(resumed.roundId, 'round-own');
 assert.equal(resumed.entries.pool.values.ph, '7,10');
 assert.equal(resumed.index, 1);
 assert.equal(resumed.revision, 3);
 assert.equal(ownOpenWaterDraft(loaded.bundle, second.id, employee.userId), null);
 const drafts = [];
 const db = controlDb({userId: employee.userId});
 const apply = draftRpc(drafts, employee.userId, [facility.id]);
 let waiting = null;
 db.rpc = async (name, args) => {
  if (!waiting) {
   waiting = new Promise(resolve => { db.release = resolve; });
   await waiting;
  }
  return apply(name, args);
 };
 const round = emptyWaterRound(facility.id, 'round-live');
 const older = saveWaterRoundDraft(db, {...round, entries: {pool: {values: {ph: '1,00'}, note: 'alt'}}});
 const newer = saveWaterRoundDraft(db, {...round, entries: {pool: {values: {ph: '7,20'}, note: 'neu'}}});
 db.release();
 const [staleResult, freshResult] = await Promise.all([older, newer]);
 assert.equal(freshResult.ok, true);
 assert.equal(freshResult.revision, 1);
 assert.equal(staleResult.conflict, true);
 assert.equal(staleResult.round.entries.pool.values.ph, '1,00');
 assert.equal(drafts[0].entries.pool.values.ph, '7,20');
 assert.equal(drafts.filter(item => item.status === 'open').length, 1);
 const updated = await saveWaterRoundDraft(db, {...freshResult.round, entries: {pool: {values: {ph: '7,40'}, note: 'neu'}}}, employee);
 assert.equal(updated.revision, 2);
 assert.equal(drafts[0].entries.pool.values.ph, '7,40');
 const stale = await saveWaterRoundDraft(db, {...round, revision: 1, entries: {pool: {values: {ph: '1,00'}, note: 'alt'}}});
 assert.equal(stale.conflict, true);
 assert.equal(drafts[0].entries.pool.values.ph, '7,40');
 assert.equal(drafts[0].revision, 2);
 db.rpc = async () => { throw new Error('network'); };
 const offline = await saveWaterRoundDraft(db, {...updated.round, entries: {pool: {values: {ph: '7,40'}, note: 'bleibt'}}});
 assert.equal(offline.offline, true);
 assert.equal(offline.round.entries.pool.note, 'bleibt');
 assert.equal(drafts[0].revision, 2);
 const secondRound = await saveWaterRoundDraft({...db, rpc: apply}, emptyWaterRound(facility.id, 'round-other'), employee);
 assert.equal(secondRound.conflict, true);
 assert.equal(drafts.filter(item => item.user_id === employee.userId && item.status === 'open').length, 1);
 const deniedFacility = await saveWaterRoundDraft({...db, rpc: apply}, emptyWaterRound(second.id, 'round-strand-new'), employee);
 assert.equal(deniedFacility.ok, false);
 const colleague = {userId: 'employee-3', name: 'Noah', memberships: [membership('employee')]};
 const shared = [];
 const mia = controlDb({userId: employee.userId});
 mia.rpc = draftRpc(shared, employee.userId, [facility.id]);
 const noah = controlDb({userId: colleague.userId});
 noah.rpc = draftRpc(shared, colleague.userId, [facility.id]);
 const miaSaved = await saveWaterRoundDraft(mia, emptyWaterRound(facility.id, 'round-mia'), employee);
 const noahSaved = await saveWaterRoundDraft(noah, emptyWaterRound(facility.id, 'round-noah'), colleague);
 assert.equal(miaSaved.ok, true);
 assert.equal(noahSaved.ok, true);
 assert.equal(shared.filter(item => item.status === 'open').length, 2);
 const managerDrafts = [];
 const managerDb = controlDb({userId: manager.userId});
 managerDb.rpc = draftRpc(managerDrafts, manager.userId, [facility.id, second.id]);
 const managerSaved = await saveWaterRoundDraft(managerDb, emptyWaterRound(second.id, 'round-manager-draft'), manager);
 assert.equal(managerSaved.ok, true);
 assert.equal(managerDrafts[0].facility_id, second.id);
 const kinder = createWaterPool(emptyOperations(), {facility, name: 'Kinder', scheduleMode: 'daily', intervalCount: 1}, manager, now);
 const schwimmer = createWaterPool(kinder.bundle, {facility, name: 'Schwimmer', scheduleMode: 'daily', intervalCount: 1}, manager, now);
 let bundle = schwimmer.bundle;
 for (const pool of [kinder.pool, schwimmer.pool]) {
  bundle = updateWaterParameter(bundle, parameter(bundle, pool.id, 'ph').id, {minValue: '6.50', maxValue: '7.60', required: true, active: true}, manager).bundle;
 }
 const ready = emptyWaterRound(facility.id, 'round-finish');
 ready.entries[kinder.pool.id] = {values: hygieneValues(), note: ''};
 ready.entries[schwimmer.pool.id] = {values: hygieneValues(), note: ''};
 ready.revision = 2;
 const finishDb = withWaterRound(controlDb({userId: employee.userId}), employee.userId);
 seedWaterLimits(finishDb, [kinder.pool, schwimmer.pool]);
 finishDb.rows.water_round_drafts.push({
  id: 'draft-finish', organization_id: facility.organization_id, facility_id: facility.id, user_id: employee.userId,
  round_id: 'round-finish', entries: ready.entries, progress: {index: 1, phase: 'summary'}, status: 'open', revision: 2, created_at: now, updated_at: now
 });
 const saved = await saveWaterRound(finishDb, {...bundle, waterRoundDrafts: [{roundId: 'round-finish', facilityId: facility.id, userId: employee.userId, status: 'open', revision: 2}]}, ready, employee, now, context);
 assert.equal(saved.ok, true, saved.error);
 assert.equal(saved.bundle.waterChecks.some(item => item.roundId === 'round-finish'), false);
 assert.equal(saved.bundle.waterRoundDrafts.some(item => item.roundId === 'round-finish'), false);
 assert.equal(finishDb.rows.water_checks.filter(row => row.round_id === 'round-finish').length, 2);
 assert.equal(finishDb.rows.water_round_drafts[0].status, 'completed');
 const again = await saveWaterRound(finishDb, bundle, ready, employee, now, context);
 assert.equal(again.ok, true, again.error);
 assert.deepEqual(again.ids, []);
 assert.equal(finishDb.rows.water_checks.filter(row => row.round_id === 'round-finish').length, 2);
 assert.equal(finishDb.rows.water_round_drafts[0].status, 'completed');
 const recordRpc = finishDb.rpc;
 finishDb.rpc = async (name, args) => name === 'tageswerk_save_water_round_draft'
  ? draftRpc(finishDb.rows.water_round_drafts, employee.userId, [facility.id])(name, args)
  : recordRpc(name, args);
 const closed = await saveWaterRoundDraft(finishDb, {...ready, revision: finishDb.rows.water_round_drafts[0].revision, entries: {changed: true}});
 assert.equal(closed.conflict, true);
 assert.equal(finishDb.rows.water_round_drafts[0].status, 'completed');
 assert.equal(finishDb.rows.water_round_drafts[0].entries.changed, undefined);
 const rollback = withWaterRound(controlDb({userId: employee.userId}), employee.userId, 1);
 seedWaterLimits(rollback, [kinder.pool, schwimmer.pool]);
 rollback.rows.water_round_drafts.push({
  id: 'draft-rollback', organization_id: facility.organization_id, facility_id: facility.id, user_id: employee.userId,
  round_id: 'round-finish', entries: ready.entries, progress: {index: 1, phase: 'summary'}, status: 'open', revision: 2, created_at: now, updated_at: now
 });
 const failed = await saveWaterRound(rollback, bundle, ready, employee, now, context);
 assert.equal(failed.ok, false);
 assert.equal(rollback.rows.water_checks.length, 0);
 assert.equal(rollback.rows.water_round_drafts[0].status, 'open');
 assert.equal(rollback.rows.water_round_drafts[0].revision, 2);
});

function directDraftStatus(draft, nextStatus) {
 if (draft.status !== 'open' || nextStatus !== 'open') return {ok: false};
 draft.status = nextStatus;
 return {ok: true};
}

test('Direkte Statusänderungen bleiben verboten und Verwerfen schreibt keine Messung', async () => {
 const open = {status: 'open', revision: 2, entries: {pool: {values: {ph: '7,20'}}}};
 assert.equal(directDraftStatus(open, 'completed').ok, false);
 assert.equal(directDraftStatus(open, 'discarded').ok, false);
 assert.equal(open.status, 'open');
 assert.equal(open.revision, 2);
 assert.deepEqual(open.entries.pool.values, {ph: '7,20'});
 const completed = {status: 'completed', revision: 3};
 const discardedDraft = {status: 'discarded', revision: 4};
 assert.equal(directDraftStatus(completed, 'open').ok, false);
 assert.equal(directDraftStatus(discardedDraft, 'discarded').ok, false);
 assert.equal(completed.status, 'completed');
 assert.equal(discardedDraft.status, 'discarded');
 const drafts = [
  {id: 'own', organization_id: facility.organization_id, facility_id: facility.id, user_id: employee.userId, round_id: 'round-drop', entries: {pool: {values: {ph: '7,20'}, note: ''}}, progress: {index: 0, phase: 'edit'}, status: 'open', revision: 2, created_at: now, updated_at: now},
  {id: 'other', organization_id: facility.organization_id, facility_id: facility.id, user_id: 'employee-3', round_id: 'round-other-user', entries: {pool: {values: {ph: '1,00'}, note: 'fremd'}}, progress: {}, status: 'open', revision: 1, created_at: now, updated_at: now}
 ];
 const db = controlDb({userId: employee.userId});
 db.rows.water_round_drafts = drafts;
 db.rows.water_checks.push({id: 'existing-check', pool_id: 'pool', facility_id: facility.id, organization_id: facility.organization_id, round_id: null, readings: []});
 const checksBefore = db.rows.water_checks.length;
 db.rpc = async (name, args) => {
  if (name !== 'tageswerk_discard_water_round_draft') return {data: null, error: {code: '42883', message: 'function does not exist'}};
  const own = drafts.find(item => item.user_id === employee.userId && item.round_id === args?.p_round_id && item.status === 'open');
  if (!own) return {data: {status: 'absent', round_id: args?.p_round_id}, error: null};
  own.status = 'discarded';
  own.revision += 1;
  return {data: {status: 'discarded', round_id: own.round_id}, error: null};
 };
 const foreign = await discardWaterRound(db, {roundId: 'round-other-user'});
 assert.equal(foreign.ok, false);
 assert.equal(foreign.absent, true);
 assert.equal(drafts.find(item => item.id === 'other').status, 'open');
 const own = await discardWaterRound(db, {roundId: 'round-drop'});
 assert.equal(own.ok, true);
 assert.equal(drafts.find(item => item.id === 'own').status, 'discarded');
 assert.equal(db.rows.water_checks.length, checksBefore);
 const repeat = await discardWaterRound(db, {roundId: 'round-drop'});
 assert.equal(repeat.absent, true);
 assert.equal(drafts.find(item => item.id === 'own').status, 'discarded');
 assert.equal(db.rows.water_checks.length, checksBefore);
 const loaded = await loadOperations(db, employee, context);
 assert.equal(ownOpenWaterDraft(loaded.bundle, facility.id, employee.userId), null);
 assert.equal(loaded.bundle.waterRoundDrafts.length, 0);
});

test('Dieselbe Person sieht Wasserwerte nur im Betrieb mit Historienrolle', () => {
 const mixed = [membership('technician'), membership('employee', second)];
 const bundle = {
  ...emptyOperations(),
  waterChecks: [
   {id: 'home', facilityId: facility.id, organizationId: facility.organization_id, poolId: 'pool-a', recordedBy: employee.userId, readings: [{parameterCode: 'ph', value: '7.20'}]},
   {id: 'other-site', facilityId: second.id, organizationId: second.organization_id, poolId: 'pool-b', recordedBy: employee.userId, readings: [{parameterCode: 'ph', value: '8.20'}]}
  ]
 };
 const view = waterRowsForMember(bundle, mixed, now, 'mixed-1');
 assert.equal(waterHistoryRole({id: facility.id, organization_id: facility.organization_id}, mixed), true);
 assert.equal(waterHistoryRole({id: second.id, organization_id: second.organization_id}, mixed), false);
 assert.deepEqual(view.checks.map(item => item.id), ['home']);
 assert.equal(view.checks.some(item => item.readings.some(reading => reading.value === '8.20')), false);
 const employeeOnly = waterRowsForMember(bundle, [membership('employee'), membership('employee', second)], now, employee.userId);
 assert.equal(employeeOnly.checks.length, 0);
 const managerBoth = [membership('facility_manager'), membership('facility_manager', second)];
 const managed = waterRowsForMember(bundle, managerBoth, now, manager.userId);
 assert.equal(managed.checks.length, 2);
 const adminView = waterRowsForMember(bundle, [membership('company_admin')], now, admin.userId);
 assert.equal(adminView.checks.length, 2);
 const foreignAdmin = waterRowsForMember(bundle, [membership('company_admin', foreign)], now, 'foreign-admin');
 assert.equal(foreignAdmin.checks.length, 0);
});

test('Kontrollrunde abschließen bleibt je Rolle bestätigt und übersteht einen Fehler', async () => {
 const kinder = createWaterPool(emptyOperations(), {facility, name: 'Kinder', scheduleMode: 'daily', intervalCount: 1}, manager, now);
 const schwimmer = createWaterPool(kinder.bundle, {facility, name: 'Schwimmer', scheduleMode: 'daily', intervalCount: 1}, manager, now);
 let bundle = schwimmer.bundle;
 for (const pool of [kinder.pool, schwimmer.pool]) {
  bundle = updateWaterParameter(bundle, parameter(bundle, pool.id, 'ph').id, {minValue: '6.50', maxValue: '7.60', required: true, active: true}, manager).bundle;
 }
 const technician = {userId: 'technician-1', name: 'Timo', memberships: [membership('technician')]};
 const ready = emptyWaterRound(facility.id, 'round-close');
 ready.revision = 2;
 ready.phase = 'summary';
 ready.entries[kinder.pool.id] = {values: hygieneValues({ph: '8,20'}), note: 'hoch'};
 ready.entries[schwimmer.pool.id] = {values: hygieneValues(), note: ''};
 const incomplete = {...ready, entries: {...ready.entries, [schwimmer.pool.id]: {values: hygieneValues({ph: ''}), note: ''}}};
 const incompleteDb = withWaterRound(controlDb({userId: employee.userId}), employee.userId);
 const rejected = await saveWaterRound(incompleteDb, bundle, incomplete, employee, now, context);
 assert.equal(rejected.ok, false);
 assert.match(rejected.error, /Schwimmer/);
 assert.equal(incompleteDb.calls.some(call => call[0] === 'rpc'), false);
 assert.equal(incomplete.entries[kinder.pool.id].values.ph, '8,20');
 assert.equal(waterRoundDisplayStatus(bundle, incomplete, employee, now), 'Entwurf gespeichert');

 const employeeDb = withWaterRound(controlDb({userId: employee.userId}), employee.userId);
 seedWaterLimits(employeeDb, [kinder.pool, schwimmer.pool]);
 const employeeSaved = await saveWaterRound(employeeDb, bundle, ready, employee, now, context);
 assert.equal(employeeSaved.ok, true, employeeSaved.error);
 assert.equal(employeeSaved.id, ready.roundId);
 assert.equal(employeeDb.rows.water_checks.filter(row => row.round_id === ready.roundId).length, 2);
 assert.equal(employeeDb.rows.water_alerts.some(item => item.parameter_code === 'ph' && item.value_amount === '8.20'), true);
 assert.equal(employeeSaved.bundle.waterChecks.some(item => item.roundId === ready.roundId), false);

 const technicianDb = withWaterRound(controlDb({userId: technician.userId}), technician.userId);
 seedWaterLimits(technicianDb, [kinder.pool, schwimmer.pool]);
 const technicianReady = {...ready, roundId: 'round-technician'};
 const technicianSaved = await saveWaterRound(technicianDb, bundle, technicianReady, technician, now, context);
 assert.equal(technicianSaved.ok, true, technicianSaved.error);
 assert.equal(technicianSaved.bundle.waterChecks.filter(item => item.roundId === technicianReady.roundId && item.recordedBy === technician.userId).length, 2);
 assert.equal(waterHistoryRole({id: facility.id, organization_id: facility.organization_id}, technician.memberships), true);
 assert.equal(waterHistoryRole({id: facility.id, organization_id: facility.organization_id}, employee.memberships), false);
 for (const actor of [
  {userId: 'manager-close', name: 'Lea', memberships: [membership('facility_manager')]},
  {userId: 'admin-close', name: 'Kim', memberships: [membership('company_admin')]}
 ]) {
  const roleDb = withWaterRound(controlDb({userId: actor.userId}), actor.userId);
  seedWaterLimits(roleDb, [kinder.pool, schwimmer.pool]);
  const roleRound = {...ready, roundId: `round-${actor.userId}`};
  const roleSaved = await saveWaterRound(roleDb, bundle, roleRound, actor, now, context);
  assert.equal(roleSaved.ok, true, roleSaved.error);
  assert.equal(roleSaved.bundle.waterChecks.filter(item => item.roundId === roleRound.roundId && item.recordedBy === actor.userId).length, 2);
  assert.equal(waterHistoryRole({id: facility.id, organization_id: facility.organization_id}, actor.memberships), true);
 }

 const deniedDb = controlDb({userId: employee.userId});
 deniedDb.rpc = async () => ({data: null, error: {code: '42501', message: 'new row violates row-level security policy for table "water_round_drafts"'}});
 const denied = await saveWaterRound(deniedDb, bundle, {...ready, roundId: 'round-denied'}, employee, now, context);
 assert.equal(denied.ok, false);
 assert.equal(denied.error, 'new row violates row-level security policy for table "water_round_drafts"');
 assert.doesNotMatch(denied.error, /nicht installiert/);
 assert.equal(deniedDb.rows.water_checks.length, 0);
 assert.equal(ready.entries[kinder.pool.id].values.ph, '8,20');
 assert.notEqual(waterRoundDisplayStatus(bundle, ready, employee, now), 'Endgültig abgeschlossen');

 const guardDb = controlDb({userId: technician.userId});
 guardDb.rpc = async () => ({data: null, error: {code: 'P0001', message: 'Der Entwurf wird nur über die vorgesehene Funktion abgeschlossen oder verworfen.'}});
 const guarded = await saveWaterRound(guardDb, bundle, technicianReady, technician, now, context);
 assert.equal(guarded.ok, false);
 assert.equal(guarded.error, 'Der Entwurf wird nur über die vorgesehene Funktion abgeschlossen oder verworfen.');
 assert.equal(guardDb.rows.water_checks.length, 0);
 assert.equal(technicianReady.entries[schwimmer.pool.id].values.temperature, '28.0');

 const retryDb = withWaterRound(controlDb({userId: technician.userId}), technician.userId, 0);
 seedWaterLimits(retryDb, [kinder.pool, schwimmer.pool]);
 const retryRound = {...ready, roundId: 'round-retry'};
 const failed = await saveWaterRound(retryDb, bundle, retryRound, technician, now, context);
 assert.equal(failed.ok, false);
 assert.match(failed.error, /unvollständig|bleiben im Entwurf/);
 assert.equal(retryDb.rows.water_checks.length, 0);
 assert.equal(retryRound.entries[kinder.pool.id].values.ph, '8,20');
 withWaterRound(retryDb, technician.userId);
 const retried = await saveWaterRound(retryDb, bundle, retryRound, technician, now, context);
 assert.equal(retried.ok, true, retried.error);
 assert.equal(retryDb.rows.water_checks.filter(row => row.round_id === 'round-retry').length, 2);
 assert.equal(waterRoundDisplayStatus(bundle, retryRound, technician, now), 'Vollständig ausgefüllt');

 const logged = [];
 const previousError = console.error;
 console.error = (...args) => logged.push(args);
 try {
  const visibleDb = controlDb({userId: employee.userId});
  visibleDb.rpc = async () => ({data: null, error: {code: '42883', message: 'function public.tageswerk_own_water_round_stored(uuid, jsonb) does not exist', details: ready.entries}});
  const visible = await saveWaterRound(visibleDb, bundle, {...ready, roundId: 'round-visible'}, employee, now, context);
  assert.equal(visible.ok, false);
  assert.equal(visible.error, 'function public.tageswerk_own_water_round_stored(uuid, jsonb) does not exist');
  assert.doesNotMatch(visible.error, /Betriebsdatenbank ist noch nicht installiert/);
  const thrownDb = controlDb({userId: employee.userId});
  thrownDb.rpc = async () => { throw {code: 'PGRST202', message: 'invalid input syntax for type numeric: "8,20"', details: 'person@example.com'}; };
  const thrown = await saveWaterRound(thrownDb, bundle, {...ready, roundId: 'round-thrown'}, employee, now, context);
  assert.equal(thrown.error, 'invalid input syntax for type numeric: "8,20"');
  const emptyDb = controlDb({userId: employee.userId});
  emptyDb.rpc = async () => ({data: null, error: {code: 'XX000', message: ''}});
  const empty = await saveWaterRound(emptyDb, bundle, {...ready, roundId: 'round-empty'}, employee, now, context);
  assert.equal(empty.error, 'Die Kontrollrunde konnte nicht abgeschlossen werden. Die Eingaben bleiben erhalten.');
 } finally {
  console.error = previousError;
 }
 assert.deepEqual(logged[0], ['tageswerk_record_water_round', '42883', 'function public.tageswerk_own_water_round_stored(uuid, jsonb) does not exist']);
 assert.equal(logged[0].length, 3);
 assert.doesNotMatch(logged.map(entry => entry.join(' ')).join('\n'), /8,20|person@example.com|parameter_code/);

 const ui = readFileSync(new URL('../../js/operations-ui.js', import.meta.url), 'utf8');
 const handler = ui.slice(ui.indexOf("button('Kontrollrunde speichern'"), ui.indexOf('card.append(actions);', ui.indexOf("button('Kontrollrunde speichern'")));
 const confirmed = handler.slice(handler.indexOf('if (result?.ok)'), handler.indexOf('} else {'));
 assert.match(confirmed, /clearWaterRound/);
 assert.match(confirmed, /Endgültig abgeschlossen/);
 assert.doesNotMatch(handler.slice(0, handler.indexOf('if (result?.ok)')), /Endgültig abgeschlossen/);
 assert.match(handler, /waterRoundError = result\?\.error/);
 assert.match(handler, /if \(!result\?\.ok\) renderPanel\(\)/);
 assert.equal(waterRoundFailureMessage({code: '42501', message: 'permission denied for table water_checks'}), 'Keine Berechtigung für diese Kontrollrunde. Die erfassten Werte bleiben im Entwurf.');

 const installed = readFileSync(new URL('../../tageswerk_3_3_water_hygiene.sql', import.meta.url), 'utf8');
 const proof = installed.slice(installed.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_water_round_checks_in_transaction'), installed.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_water_round_discard_in_transaction'));
 const oldRecord = installed.slice(installed.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_record_water_round'), installed.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_discard_water_round_draft'));
 assert.match(proof, /check_row\.xmin = pg_current_xact_id\(\)::xid/);
 assert.match(oldRecord, /INSERT INTO public\.water_checks[\s\S]*^\s*EXCEPTION\b/m);
 const correction = readFileSync(new URL('../../tageswerk_3_4_2_water_round_close.sql', import.meta.url), 'utf8');
 const record = correction.slice(correction.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_record_water_round'), correction.lastIndexOf('REVOKE ALL ON FUNCTION public.tageswerk_record_water_round'));
 const helper = correction.slice(correction.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_own_water_round_stored'), correction.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_finish_own_water_round_draft'));
 const finish = correction.slice(correction.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_finish_own_water_round_draft'), correction.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_record_water_round'));
 assert.doesNotMatch(record, /^\s*EXCEPTION\b/m);
 assert.doesNotMatch(record, /EXCEPTION WHEN/);
 assert.doesNotMatch(record, /SECURITY DEFINER/);
 assert.doesNotMatch(record, /set_config/);
 assert.doesNotMatch(record, /UPDATE public\.water_round_drafts/);
 assert.match(record, /tageswerk_finish_own_water_round_draft\(p_round_id, facility\)/);
 assert.ok(record.indexOf('INSERT INTO public.water_checks') < record.indexOf('tageswerk_finish_own_water_round_draft(p_round_id, facility)'));
 assert.match(record, /closed_drafts IS DISTINCT FROM 1/);
 assert.match(finish, /SECURITY DEFINER/);
 assert.match(finish, /SET search_path = ''/);
 assert.match(finish, /draft\.user_id = auth\.uid\(\)/);
 assert.match(finish, /draft\.status = 'open'/);
 assert.match(finish, /AND status = 'open'/);
 assert.match(finish, /facility_id = p_facility_id/);
 assert.match(finish, /public\.tageswerk_meter_role\(organization, p_facility_id\) IS NULL/);
 assert.match(finish, /tageswerk_water_round_checks_in_transaction\(p_round_id, p_facility_id\) IS NOT TRUE/);
 assert.match(finish, /SET status = 'completed'/);
 assert.ok(finish.indexOf('UPDATE public.water_round_drafts') < finish.indexOf('GET DIAGNOSTICS closed_drafts = ROW_COUNT'));
 assert.doesNotMatch(finish, /EXCEPTION WHEN/);
 assert.doesNotMatch(finish, /\b(min|max|sum|avg)\s*\(/i);
 assert.match(helper, /RETURNS boolean/);
 assert.match(helper, /SECURITY DEFINER/);
 assert.match(helper, /SET search_path = ''/);
 assert.match(helper, /check_row\.recorded_by = auth\.uid\(\)/);
 assert.match(helper, /draft\.user_id = auth\.uid\(\)/);
 assert.match(helper, /draft\.status = 'completed'/);
 assert.match(helper, /public\.tageswerk_meter_role/);
 assert.match(helper, /::numeric/);
 assert.match(helper, /coalesce\(item->>'note', ''\) IS DISTINCT FROM check_row\.note/);
 assert.match(helper, /check_row\.recorded_by IS DISTINCT FROM auth\.uid\(\)/);
 assert.doesNotMatch(helper, /EXCEPTION WHEN/);
 assert.doesNotMatch(helper, /INSERT|UPDATE|DELETE/);
 assert.doesNotMatch(helper, /\b(min|max|sum|avg)\s*\(/i);
 assert.match(helper, /SELECT count\(\*\)::integer/);
 assert.match(helper, /SELECT draft\.organization_id, draft\.facility_id/);
 assert.match(helper, /IF draft_count = 1 THEN/);
 assert.match(record, /tageswerk_own_water_round_stored\(p_round_id, p_checks\)/);
 assert.doesNotMatch(correction, /DROP POLICY|CREATE POLICY|water_checks_select/);
 assert.doesNotMatch(correction, /employee/);
 const runner = readFileSync(new URL('../integration/run.mjs', import.meta.url), 'utf8');
 assert.doesNotMatch(runner, /tageswerk_3_4_2_water_round_close\.sql/);
 const check = readFileSync(new URL('../../tageswerk_3_4_2_water_round_close_pruefung.sql', import.meta.url), 'utf8');
 assert.match(check, /to_regprocedure\('public\.tageswerk_own_water_round_stored\(uuid,jsonb\)'\)/);
 assert.match(check, /to_regprocedure\('public\.tageswerk_own_water_round_stored\(uuid,uuid\[\]\)'\) IS NULL/);
 assert.match(check, /check_row\.note/);
 assert.match(check, /public\.tageswerk_meter_role/);
 assert.match(check, /::numeric/);
 assert.match(check, /to_regprocedure\('public\.tageswerk_record_water_round\(uuid,jsonb\)'\)/);
 assert.match(check, /water_checks_protect/);
 assert.match(check, /helper\.prosecdef IS TRUE/);
 assert.match(check, /recorder\.prosecdef IS FALSE/);
 assert.match(check, /GET DIAGNOSTICS closed_drafts = ROW_COUNT/);
 assert.match(check, /draft\.status = ''completed''/);
 assert.match(check, /EXCEPTION WHEN/);
 assert.match(check, /position\('min\(' IN pg_get_functiondef\(helper\.oid\)\) = 0/);
 assert.doesNotMatch(check, /^\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|GRANT|REVOKE|TRUNCATE)\b/im);
 assert.doesNotMatch(check, /SELECT\s+public\.tageswerk_record_water_round/i);
 assert.doesNotMatch(runner, /tageswerk_3_4_2_water_round_close_pruefung\.sql/);
 assert.doesNotMatch(runner, /tageswerk_3_4_2_water_round_close_bereinigung\.sql/);
 assert.doesNotMatch(runner, /tageswerk_3_4_2_water_round_close_uuid\.sql/);
 assert.doesNotMatch(runner, /tageswerk_3_4_2_water_round_close_rls\.sql/);
 assert.doesNotMatch(runner, /tageswerk_3_4_2_water_round_schedule\.sql/);
 assert.doesNotMatch(record, /\b(min|max|sum|avg)\s*\(/i);
 const rlsFix = readFileSync(new URL('../../tageswerk_3_4_2_water_round_close_rls.sql', import.meta.url), 'utf8');
 const rlsBody = rlsFix.slice(rlsFix.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_finish_own_water_round_draft'), rlsFix.lastIndexOf('COMMIT'));
 const installedBody = correction.slice(correction.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_finish_own_water_round_draft'), correction.lastIndexOf('COMMIT'));
 assert.equal(rlsBody.replace(/\s+/g, ' ').trim(), installedBody.replace(/\s+/g, ' ').trim());
 assert.doesNotMatch(rlsFix, /DROP POLICY|CREATE POLICY|ALTER TABLE|TRUNCATE/);
 assert.match(check, /tageswerk_finish_own_water_round_draft\(uuid,uuid\)/);
 assert.match(check, /water_round_drafts_update/);
 assert.match(check, /water_round_drafts_guard/);
 assert.match(check, /polcmd = 'd'/);
 const ownDraft = {round_id: 'round-own', facility_id: facility.id, user_id: 'owner', status: 'open', revision: 2};
 const foreignDraft = {round_id: 'round-foreign', facility_id: facility.id, user_id: 'other', status: 'open', revision: 1};
 const completedDraft = {round_id: 'round-done', facility_id: facility.id, user_id: 'owner', status: 'completed', revision: 3};
 const closeOwnOpenDraft = (drafts, userId, roundId, facilityId, proof) => {
  let updated = 0;
  const next = drafts.map(draft => {
   if (draft.user_id !== userId || draft.round_id !== roundId || draft.facility_id !== facilityId || draft.status !== 'open' || proof !== true) return draft;
   updated += 1;
   return {...draft, status: 'completed', revision: draft.revision + 1};
  });
  return {updated, drafts: next};
 };
 for (const userId of ['employee-1', 'technician-1', 'manager-1', 'admin-1']) {
  const result = closeOwnOpenDraft([{...ownDraft, user_id: userId}, foreignDraft, completedDraft], userId, 'round-own', facility.id, true);
  assert.equal(result.updated, 1);
  assert.equal(result.drafts[0].status, 'completed');
  assert.equal(result.drafts[1].status, 'open');
  assert.equal(result.drafts[1].user_id, 'other');
  assert.equal(result.drafts[2].status, 'completed');
  assert.equal(result.drafts[2].revision, 3);
 }
 const blocked = closeOwnOpenDraft([ownDraft, foreignDraft, completedDraft], 'owner', 'round-foreign', facility.id, true);
 assert.equal(blocked.updated, 0);
 assert.equal(blocked.drafts[1].status, 'open');
 const withoutProof = closeOwnOpenDraft([ownDraft], 'owner', 'round-own', facility.id, false);
 assert.equal(withoutProof.updated, 0);
 assert.equal(withoutProof.drafts[0].status, 'open');
 const alreadyClosed = closeOwnOpenDraft([completedDraft], 'owner', 'round-done', facility.id, true);
 assert.equal(alreadyClosed.updated, 0);
 assert.equal(alreadyClosed.drafts[0].revision, 3);
 const uuidFix = readFileSync(new URL('../../tageswerk_3_4_2_water_round_close_uuid.sql', import.meta.url), 'utf8');
 const uuidHelper = uuidFix.slice(uuidFix.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_own_water_round_stored'), uuidFix.indexOf('COMMIT'));
 assert.equal(uuidHelper.replace(/\s+/g, ' ').trim(), helper.replace(/\s+/g, ' ').trim());
 assert.doesNotMatch(uuidFix, /tageswerk_record_water_round/);
 assert.doesNotMatch(uuidFix, /\b(min|max|sum|avg)\s*\(/i);
 assert.doesNotMatch(uuidFix, /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/im);
 const cleanup = readFileSync(new URL('../../tageswerk_3_4_2_water_round_close_bereinigung.sql', import.meta.url), 'utf8');
 assert.match(cleanup, /DROP FUNCTION IF EXISTS public\.tageswerk_own_water_round_stored\(uuid, uuid\[\]\);/);
 assert.doesNotMatch(cleanup, /uuid, jsonb/);
 assert.doesNotMatch(cleanup, /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|GRANT|REVOKE|TRUNCATE)\b/im);
});

test('Mehrere Wasserhygiene-Kontrollrunden pro Tag bleiben eindeutig zugeordnet', async () => {
 const created = createWaterPool(emptyOperations(), {facility, name: 'Kinder', scheduleMode: 'daily', intervalCount: 1}, manager, now);
 const secondPool = createWaterPool(created.bundle, {facility, name: 'Schwimmer', scheduleMode: 'times', scheduledTimes: '08:00, 20:00', weekdays: [1, 2, 3, 4, 5, 6, 7]}, manager, now);
 assert.deepEqual(secondPool.pool.scheduledTimes, ['08:00', '20:00']);
 const slots = [
  {id: 'slot-9', facilityId: facility.id, time: '09:00', active: true},
  {id: 'slot-14', facilityId: facility.id, time: '14:00', active: true},
  {id: 'slot-19', facilityId: facility.id, time: '19:00', active: true}
 ];
 const bundle = {...secondPool.bundle, waterFacilitySlots: slots, waterRoundSlots: []};
 const pools = waterRoundPools(bundle, facility.id);
 const filled = (roundId, slot, kind = 'planned') => {
  let round = emptyWaterRound(facility.id, roundId);
  for (const pool of pools) round = rememberWaterEntry(round, pool.id, {values: hygieneValues(), note: ''});
  return {...round, slotId: slot?.id || null, kind, slotTime: slot?.time || ''};
 };
 const openSchedule = () => {
  const db = controlDb();
  const shared = {rows: db.rows, assignments: []};
  shared.rows.water_facility_slots = slots.map(slot => ({
   id: slot.id,
   facility_id: facility.id,
   organization_id: facility.organization_id,
   slot_time: slot.time,
   active: true
  }));
  shared.rows.water_round_slots = shared.assignments;
  shared.rows.water_checks.push({
   id: 'historic-1', pool_id: created.pool.id, facility_id: facility.id, organization_id: facility.organization_id,
   measured_at: '2026-11-01T10:00:00.000Z', recorded_by: manager.userId, note: 'alt', round_id: null,
   readings: [{parameter_code: 'ph', value: '7.10', unit: '', min_limit: '6.50', max_limit: '7.60'}]
  });
  const connect = userId => {
   const connected = withWaterRound(controlDb({userId, rows: shared.rows}), userId);
   seedWaterLimits(connected, [created.pool, secondPool.pool]);
   const record = connected.rpc;
   connected.rpc = async (name, args) => {
    if (name === 'tageswerk_discard_water_round_draft') return {data: {status: 'discarded', round_id: args.p_round_id}, error: null};
    if (name !== 'tageswerk_record_scheduled_water_round') return record(name, args);
    const day = berlinDay(now);
    const activePoolIds = [created.pool.id, secondPool.pool.id];
    const supplied = [...new Set((args.p_checks || []).map(item => item.pool_id))];
    if (supplied.length !== activePoolIds.length || supplied.some(id => !activePoolIds.includes(id))) {
     return {data: null, error: {code: 'P0001', message: 'Die Kontrollrunde umfasst nicht alle aktiven Becken.'}};
    }
    if (args.p_slot_id) {
     const clash = shared.assignments.find(item => item.slot_id === args.p_slot_id && item.service_day === day && item.kind === 'planned' && item.round_id !== args.p_round_id);
     if (clash) return {data: null, error: {code: 'P0001', message: 'Dieser Termin wurde bereits abgeschlossen.'}};
    }
    const stored = await record('tageswerk_record_water_round', args);
    if (stored.error) return stored;
    const link = shared.assignments.find(item => item.round_id === args.p_round_id);
    if (stored.data?.status === 'already_stored') {
     if (link && (link.slot_id || null) === (args.p_slot_id || null)) return stored;
     return {data: null, error: {code: 'P0001', message: 'Diese Kontrollrunde ist bereits gespeichert und kann diesem Termin nicht zugeordnet werden.'}};
    }
    if (stored.data?.status !== 'stored') return stored;
    if (link) return {data: null, error: {code: 'P0001', message: 'Diese Kontrollrunde ist bereits einem Termin zugeordnet.'}};
    shared.assignments.push({
     id: `link-${shared.assignments.length + 1}`,
     facility_id: facility.id,
     organization_id: facility.organization_id,
     round_id: args.p_round_id,
     slot_id: args.p_slot_id,
     kind: args.p_slot_id ? 'planned' : 'extra',
     slot_time: args.p_slot_id ? (slots.find(slot => slot.id === args.p_slot_id)?.time || '') : '',
     service_day: day,
     user_id: userId
    });
    return stored;
   };
   return connected;
  };
  return {shared, connect};
 };

 const day = openSchedule();
 const employeeDb = day.connect(employee.userId);
 let savedBundle = bundle;
 const completed = [];
 for (const slot of slots) {
  const round = filled(`round-${slot.time}`, slot);
  const saved = await saveWaterRound(employeeDb, savedBundle, round, employee, now, context);
  assert.equal(saved.ok, true, saved.error);
  savedBundle = saved.bundle;
  completed.push(saved.id);
 }
 assert.equal(new Set(completed).size, 3);
 assert.deepEqual(waterDayRounds(savedBundle, facility.id, '2026-11-09T18:30:00.000Z').planned.map(item => item.status), ['Abgeschlossen', 'Abgeschlossen', 'Abgeschlossen']);
 const repeated = await saveWaterRound(employeeDb, savedBundle, filled('round-09:00', slots[0]), employee, now, context);
 assert.equal(repeated.ok, true, repeated.error);
 assert.equal(day.shared.assignments.filter(item => item.slot_id === 'slot-9').length, 1);
 assert.equal(day.shared.rows.water_checks.filter(row => row.round_id === 'round-09:00').length, 2);
 const partial = await employeeDb.rpc('tageswerk_record_scheduled_water_round', {
  p_round_id: 'round-partial',
  p_slot_id: 'slot-19',
  p_checks: [{pool_id: created.pool.id, facility_id: facility.id, note: '', readings: []}]
 });
 assert.match(partial.error.message, /nicht alle aktiven Becken/);
 assert.equal(day.shared.rows.water_checks.some(row => row.round_id === 'round-partial'), false);
 assert.equal(day.shared.assignments.some(item => item.round_id === 'round-partial'), false);
 const reloaded = await loadOperations(employeeDb, employee, context);
 assert.equal(reloaded.ok, true, reloaded.error);
 assert.equal(reloaded.bundle.waterChecks.find(item => item.id === 'historic-1').readings[0].value, '7.10');
 assert.equal(reloaded.bundle.waterChecks.filter(item => item.id === 'historic-1').length, 1);
 const reloadedDay = waterDayRounds(reloaded.bundle, facility.id, '2026-11-09T18:30:00.000Z');
 assert.deepEqual(reloadedDay.planned.map(item => [item.time, item.status]), [['09:00', 'Abgeschlossen'], ['14:00', 'Abgeschlossen'], ['19:00', 'Abgeschlossen']]);

 const earlyBundle = {
  ...bundle,
  waterRoundSlots: [{id: 'early', facilityId: facility.id, roundId: 'round-early', slotId: 'slot-14', kind: 'planned', slotTime: '14:00', serviceDay: '2026-11-09', userId: employee.userId}]
 };
 const early = waterDayRounds(earlyBundle, facility.id, '2026-11-09T07:00:00.000Z');
 assert.equal(early.planned.find(item => item.time === '09:00').status, 'Noch nicht fällig');
 assert.equal(early.planned.find(item => item.time === '14:00').status, 'Abgeschlossen');

 const missedBundle = {
  ...bundle,
  waterRoundSlots: [{id: 'later', facilityId: facility.id, roundId: 'round-later', slotId: 'slot-14', kind: 'planned', slotTime: '14:00', serviceDay: '2026-11-09', userId: employee.userId}]
 };
 const missed = waterDayRounds(missedBundle, facility.id, '2026-11-09T15:30:00.000Z');
 assert.equal(missed.planned.find(item => item.time === '09:00').status, 'Überfällig');
 assert.equal(missed.planned.find(item => item.time === '14:00').status, 'Abgeschlossen');
 assert.equal(missed.planned.find(item => item.time === '19:00').status, 'Noch nicht fällig');

 const pair = openSchedule();
 const first = pair.connect(employee.userId);
 const colleague = {userId: 'employee-4', name: 'Noah', memberships: [membership('employee')]};
 const other = pair.connect(colleague.userId);
 const firstSaved = await saveWaterRound(first, bundle, filled('round-shared', slots[0]), employee, now, context);
 assert.equal(firstSaved.ok, true, firstSaved.error);
 const checksBefore = pair.shared.rows.water_checks.length;
 const competing = filled('round-shared-2', slots[0]);
 const competingEntries = JSON.stringify(competing.entries);
 const secondSaved = await saveWaterRound(other, bundle, competing, colleague, now, context);
 assert.equal(secondSaved.ok, false);
 assert.equal(secondSaved.conflict, true);
 assert.equal(secondSaved.error, 'Dieser Termin wurde bereits abgeschlossen. Die eingegebenen Messwerte bleiben erhalten.');
 assert.equal(JSON.stringify(competing.entries), competingEntries);
 assert.equal(pair.shared.rows.water_checks.length, checksBefore);
 assert.equal(pair.shared.assignments.length, 1);
 assert.equal(waterDayRounds(secondSaved.bundle, facility.id, now).planned.find(item => item.time === '09:00').status, 'Abgeschlossen');

 const discarded = openSchedule();
 const draftDb = discarded.connect(employee.userId);
 const draftRound = filled('round-draft', slots[1]);
 let progress = null;
 const draftRecord = draftDb.rpc;
 draftDb.rpc = async (name, args) => {
  if (name === 'tageswerk_save_water_round_draft') {
   progress = args.p_progress;
   return {data: {status: 'stored', round_id: args.p_round_id, revision: 1}, error: null};
  }
  return draftRecord(name, args);
 };
 const draft = await saveWaterRoundDraft(draftDb, draftRound);
 assert.equal(draft.ok, true, draft.error);
 assert.equal(progress.slotId, 'slot-14');
 assert.equal(progress.kind, 'planned');
 assert.equal(progress.slotTime, '14:00');
 assert.equal(discarded.shared.assignments.length, 0);
 const restored = roundFromWaterDraft({facilityId: facility.id, roundId: 'round-draft', revision: 1, entries: draftRound.entries, progress});
 assert.equal(restored.slotId, 'slot-14');
 assert.equal(restored.kind, 'planned');
 const dropped = await discardWaterRound(draftDb, restored);
 assert.equal(dropped.ok, true, dropped.error);
 assert.equal(discarded.shared.assignments.length, 0);
 const afterDiscard = await saveWaterRound(draftDb, bundle, filled('round-after-discard', slots[1]), employee, now, context);
 assert.equal(afterDiscard.ok, true, afterDiscard.error);
 assert.equal(discarded.shared.assignments.filter(item => item.slot_id === 'slot-14').length, 1);

 const extraDay = openSchedule();
 const extraDb = extraDay.connect(employee.userId);
 const extra = await saveWaterRound(extraDb, bundle, filled('round-extra', null, 'extra'), employee, now, context);
 assert.equal(extra.ok, true, extra.error);
 assert.equal(extraDay.shared.assignments[0].kind, 'extra');
 assert.equal(extraDay.shared.assignments[0].slot_id, null);
 const extraView = waterDayRounds(extra.bundle, facility.id, now);
 assert.equal(extraView.planned.every(item => item.status !== 'Abgeschlossen'), true);
 assert.equal(extraView.extras[0].label, 'Zusatzkontrolle');
 assert.equal(extraView.extras[0].status, 'Abgeschlossen');
 const extraAgain = await saveWaterRound(extraDb, extra.bundle, filled('round-extra', null, 'extra'), employee, now, context);
 assert.equal(extraAgain.ok, true, extraAgain.error);
 assert.equal(extraDay.shared.assignments.length, 1);
 assert.equal(extraDay.shared.rows.water_checks.filter(row => row.round_id === 'round-extra').length, 2);
 const orphanDay = openSchedule();
 const orphanDb = orphanDay.connect(employee.userId);
 const storedWithoutPlan = await saveWaterRound(orphanDb, bundle, {...filled('round-orphan', slots[0]), kind: ''}, employee, now, context);
 assert.equal(storedWithoutPlan.ok, true, storedWithoutPlan.error);
 const orphanChecks = orphanDay.shared.rows.water_checks.filter(row => row.round_id === 'round-orphan').map(row => row.id);
 const orphaned = await saveWaterRound(orphanDb, bundle, filled('round-orphan', slots[0]), employee, now, context);
 assert.equal(orphaned.ok, false);
 assert.match(orphaned.error, /bereits gespeichert und kann diesem Termin nicht zugeordnet/);
 assert.equal(orphanDay.shared.assignments.length, 0);
 assert.deepEqual(orphanDay.shared.rows.water_checks.filter(row => row.round_id === 'round-orphan').map(row => row.id), orphanChecks);
 const fresh = await saveWaterRound(orphanDb, bundle, filled('round-orphan-new', slots[0]), employee, now, context);
 assert.equal(fresh.ok, true, fresh.error);
 assert.equal(orphanDay.shared.assignments.filter(item => item.slot_id === 'slot-9' && item.round_id === 'round-orphan-new').length, 1);
 const moveDay = openSchedule();
 const moveDb = moveDay.connect(employee.userId);
 const keptSlot = await saveWaterRound(moveDb, bundle, filled('round-move', slots[0]), employee, now, context);
 assert.equal(keptSlot.ok, true, keptSlot.error);
 const otherSlot = await saveWaterRound(moveDb, bundle, filled('round-move', slots[1]), employee, now, context);
 assert.equal(otherSlot.ok, false);
 assert.match(otherSlot.error, /diesem Termin nicht zugeordnet/);
 assert.deepEqual(moveDay.shared.assignments.map(item => [item.round_id, item.slot_id]), [['round-move', 'slot-9']]);
 assert.equal(moveDay.shared.rows.water_checks.filter(row => row.round_id === 'round-move').length, 2);

 const unassigned = await saveWaterRound(extraDb, bundle, {...filled('round-open', null, 'planned')}, employee, now, context);
 assert.equal(unassigned.ok, false);
 assert.match(unassigned.error, /keinem Termin/);

 assert.equal(berlinInstant('2026-03-29', '02:30'), '');
 assert.equal(berlinInstant('2026-03-28', '09:00'), '2026-03-28T08:00:00.000Z');
 assert.equal(berlinInstant('2026-03-29', '09:00'), '2026-03-29T07:00:00.000Z');
 assert.equal(berlinInstant('2026-10-24', '09:00'), '2026-10-24T07:00:00.000Z');
 assert.equal(berlinInstant('2026-10-25', '09:00'), '2026-10-25T08:00:00.000Z');
 const winterMorning = waterDayRounds(bundle, facility.id, '2026-03-28T07:30:00.000Z');
 const summerMorning = waterDayRounds(bundle, facility.id, '2026-03-29T07:30:00.000Z');
 const summerEvening = waterDayRounds(bundle, facility.id, '2026-10-24T07:30:00.000Z');
 const winterEvening = waterDayRounds(bundle, facility.id, '2026-10-25T07:30:00.000Z');
 assert.equal(winterMorning.planned[0].status, 'Noch nicht fällig');
 assert.equal(summerMorning.planned[0].status, 'Fällig');
 assert.equal(summerEvening.planned[0].status, 'Fällig');
 assert.equal(winterEvening.planned[0].status, 'Noch nicht fällig');

 const changedPlan = {
  ...bundle,
  waterFacilitySlots: [
   {id: 'slot-9', facilityId: facility.id, time: '09:00', active: true, effectiveOn: '2026-11-09', retiredOn: '2026-11-10'},
   {id: 'slot-14', facilityId: facility.id, time: '14:00', active: true, effectiveOn: '2026-11-09', retiredOn: ''},
   {id: 'slot-19', facilityId: facility.id, time: '19:00', active: true, effectiveOn: '2026-11-10', retiredOn: ''}
  ],
  waterRoundSlots: [{id: 'done-9', facilityId: facility.id, roundId: 'round-9', slotId: 'slot-9', kind: 'planned', slotTime: '09:00', serviceDay: '2026-11-09', userId: employee.userId}]
 };
 const changedToday = waterDayRounds(changedPlan, facility.id, now);
 assert.deepEqual(changedToday.planned.map(item => [item.time, item.status]), [['09:00', 'Abgeschlossen'], ['14:00', 'Noch nicht fällig']]);
 const changedTomorrow = waterDayRounds(changedPlan, facility.id, '2026-11-10T12:00:00.000Z');
 assert.deepEqual(changedTomorrow.planned.map(item => item.time), ['14:00', '19:00']);
 assert.equal(changedTomorrow.planned.some(item => item.time === '09:00'), false);
 const firstPlan = waterFacilityPlan({
  ...bundle,
  waterFacilitySlots: slots.map(slot => ({...slot, effectiveOn: '2026-11-10', retiredOn: ''}))
 }, facility.id, now);
 assert.equal(firstPlan.current.length, 0);
 assert.deepEqual(firstPlan.upcoming.map(slot => slot.time), ['09:00', '14:00', '19:00']);
 assert.equal(waterDayRounds(firstPlan.current.length ? {} : {
  ...bundle,
  waterFacilitySlots: slots.map(slot => ({...slot, effectiveOn: '2026-11-10', retiredOn: ''})),
  waterRoundSlots: []
 }, facility.id, now).planned.length, 0);

 const settingsDb = controlDb({userId: manager.userId});
 settingsDb.rows.water_facility_slots = [];
 settingsDb.rows.water_round_slots = [];
 settingsDb.rows.water_checks.push({
  id: 'historic-plan', pool_id: created.pool.id, facility_id: facility.id, organization_id: facility.organization_id,
  measured_at: '2026-11-01T10:00:00.000Z', recorded_by: manager.userId, note: 'alt', round_id: null,
  readings: [{parameter_code: 'ph', value: '7.10', unit: '', min_limit: null, max_limit: null}]
 });
 let settingsCalls = 0;
 settingsDb.rpc = async (name, args) => {
  settingsCalls += 1;
  if (name !== 'tageswerk_save_water_facility_slots') return {data: null, error: {message: 'function does not exist'}};
  settingsDb.rows.water_facility_slots = args.p_times.map(time => ({
   id: `saved-${time}`,
   facility_id: args.p_facility_id,
   organization_id: facility.organization_id,
   slot_time: time,
   active: true,
   effective_on: '2026-11-10',
   retired_on: null
  }));
  return {data: null, error: null};
 };
 const employeeTimes = await saveWaterFacilitySlots(settingsDb, emptyOperations(), facility, '09:00', employee, now, context);
 assert.equal(employeeTimes.ok, false);
 assert.equal(settingsCalls, 0);
 const tooMany = await saveWaterFacilitySlots(settingsDb, emptyOperations(), facility, '08:00, 10:00, 12:00, 14:00, 16:00, 18:00, 20:00', manager, now, context);
 assert.equal(tooMany.ok, false);
 assert.equal(settingsCalls, 0);
 const savedTimes = await saveWaterFacilitySlots(settingsDb, emptyOperations(), facility, '9:00, 14:00, 19:00', manager, now, context);
 assert.equal(savedTimes.ok, true, savedTimes.error);
 assert.equal(waterFacilityPlan(savedTimes.bundle, facility.id, now).current.length, 0);
 assert.deepEqual(waterFacilityPlan(savedTimes.bundle, facility.id, now).upcoming.map(slot => slot.time), ['09:00', '14:00', '19:00']);
 assert.equal(savedTimes.bundle.waterChecks.find(item => item.id === 'historic-plan').readings[0].value, '7.10');
 assert.equal(settingsDb.rows.water_checks.length, 1);
 settingsDb.rows.water_facility_slots = [];
 const cleared = await saveWaterFacilitySlots(settingsDb, savedTimes.bundle, facility, '', manager, now, context);
 assert.equal(cleared.ok, true, cleared.error);
 assert.equal(cleared.bundle.waterFacilitySlots.length, 0);
 assert.equal(waterDayRounds(cleared.bundle, facility.id, now).planned.length, 0);

 const schedule = readFileSync(new URL('../../tageswerk_3_4_2_water_round_schedule.sql', import.meta.url), 'utf8');
 const scheduled = schedule.slice(schedule.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_record_scheduled_water_round'), schedule.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_save_water_facility_slots'));
 assert.equal(scheduled.includes('SECURITY DEFINER'), false);
 assert.equal(/EXCEPTION\s+WHEN/.test(schedule), false);
 const claimAt = scheduled.indexOf('tageswerk_claim_water_round_slot');
 const recordAt = scheduled.indexOf('tageswerk_record_water_round');
 const insertAt = scheduled.indexOf('INSERT INTO public.water_round_slots');
 assert.equal(claimAt >= 0 && claimAt < recordAt && recordAt < insertAt, true);
 assert.equal(schedule.includes('CREATE OR REPLACE FUNCTION public.tageswerk_record_water_round'), false);
 assert.equal(schedule.includes('DROP POLICY'), false);
 assert.match(schedule, /tageswerk_water_round_checks_in_transaction\(round_id, facility_id\)/);
 assert.match(schedule, /water_round_slots_one_planned/);
 assert.match(schedule, /FOR UPDATE/);
 assert.match(schedule, /Dieser Termin wurde bereits abgeschlossen/);
 assert.match(schedule, /Eine neue Kontrollzeit gilt ab dem nächsten Tag/);
 assert.match(schedule, /Eine laufende Kontrollzeit bleibt bis zum nächsten Tag unverändert/);
 assert.match(schedule, /effective_on/);
 assert.match(schedule, /retired_on/);
 assert.equal(schedule.includes('CREATE POLICY water_round_slots_update'), false);
 assert.equal(schedule.includes('CREATE POLICY water_round_slots_delete'), false);
 assert.equal(schedule.includes('FOR DELETE'), false);
 assert.equal(schedule.includes('UPDATE public.water_checks'), false);
 assert.equal(schedule.includes('UPDATE public.water_round_drafts'), false);
 assert.match(schedule, /REVOKE ALL ON FUNCTION public\.tageswerk_claim_water_round_slot\(uuid, uuid, uuid\) FROM PUBLIC, anon/);
 assert.match(schedule, /GRANT EXECUTE ON FUNCTION public\.tageswerk_claim_water_round_slot\(uuid, uuid, uuid\) TO authenticated/);
 const scheduledBeforeRecord = scheduled.slice(0, scheduled.indexOf('tageswerk_record_water_round'));
 assert.equal(scheduledBeforeRecord.includes('already_stored'), false);
 assert.match(scheduled, /bereits gespeichert und kann diesem Termin nicht zugeordnet/);
 assert.match(schedule, /tageswerk_water_round_covers_active_pools\(round_id, facility_id\)/);
 assert.match(schedule, /nicht alle aktiven Becken/);
 const savePlan = schedule.slice(schedule.indexOf('CREATE OR REPLACE FUNCTION public.tageswerk_save_water_facility_slots'), schedule.lastIndexOf('REVOKE ALL ON FUNCTION'));
 assert.equal(savePlan.indexOf('tageswerk_lock_water_facility_plan') >= 0 && savePlan.indexOf('tageswerk_lock_water_facility_plan') < savePlan.indexOf('UPDATE public.water_facility_slots'), true);
 assert.match(schedule, /pg_advisory_xact_lock/);
 assert.match(savePlan, /retired_on <= today/);
 const nextDay = day => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
 };
 const applyTimes = (rows, times, today) => {
  const tomorrow = nextDay(today);
  let next = rows.map(row => ({...row}));
  next = next.map(row => row.active && row.retiredOn && row.retiredOn <= today ? {...row, active: false} : row);
  next = next.map(row => row.active && row.effectiveOn <= today && (!row.retiredOn || row.retiredOn > today) && !times.includes(row.time) ? {...row, retiredOn: tomorrow} : row);
  next = next.map(row => row.active && row.effectiveOn <= today && row.retiredOn > today && times.includes(row.time) ? {...row, retiredOn: ''} : row);
  next = next.map(row => row.active && row.effectiveOn > today && !times.includes(row.time) ? {...row, active: false} : row);
  for (const time of times) {
   if (next.some(row => row.active && row.time === time && row.effectiveOn <= tomorrow && (!row.retiredOn || row.retiredOn > tomorrow))) continue;
   const pending = next.find(row => row.active && row.time === time && row.effectiveOn > today);
   if (pending) {
    next = next.map(row => row.id === pending.id ? {...row, active: true, effectiveOn: tomorrow, retiredOn: ''} : row);
    continue;
   }
   next = next.map(row => row.active && row.time === time && row.effectiveOn <= today && row.retiredOn && row.retiredOn <= today ? {...row, active: false} : row);
   next.push({id: `slot-${time}-${tomorrow}`, time, active: true, effectiveOn: tomorrow, retiredOn: ''});
  }
  return next;
 };
 const links = [{id: 'link-1', roundId: 'round-9', slotId: 'slot-09:00-2026-11-10', slotTime: '09:00', serviceDay: '2026-11-10'}];
 let plan = applyTimes([], ['09:00', '14:00'], '2026-11-09');
 assert.deepEqual(plan.map(row => [row.time, row.effectiveOn]), [['09:00', '2026-11-10'], ['14:00', '2026-11-10']]);
 plan = applyTimes(plan, ['14:00'], '2026-11-10');
 assert.equal(plan.find(row => row.time === '09:00').retiredOn, '2026-11-11');
 assert.equal(plan.find(row => row.time === '09:00').active, true);
 assert.deepEqual(links, [{id: 'link-1', roundId: 'round-9', slotId: 'slot-09:00-2026-11-10', slotTime: '09:00', serviceDay: '2026-11-10'}]);
 plan = applyTimes(plan, ['09:00', '14:00'], '2026-11-11');
 assert.equal(plan.filter(row => row.time === '09:00' && row.active).length, 1);
 assert.equal(plan.find(row => row.id === 'slot-09:00-2026-11-10').active, false);
 assert.equal(plan.find(row => row.time === '09:00' && row.active).effectiveOn, '2026-11-12');
 assert.equal(links[0].slotId, 'slot-09:00-2026-11-10');
 let pending = applyTimes([], ['16:00'], '2026-11-09');
 pending = applyTimes(pending, [], '2026-11-09');
 pending = applyTimes(pending, ['16:00'], '2026-11-09');
 assert.equal(pending.filter(row => row.time === '16:00' && row.active).length, 1);
 assert.equal(pending.find(row => row.time === '16:00' && row.active).id, 'slot-16:00-2026-11-10');
 const closeSql = readFileSync(new URL('../../tageswerk_3_4_2_water_round_close.sql', import.meta.url), 'utf8');
 assert.equal(closeSql.includes('water_round_slots'), false);
 assert.equal(closeSql.includes('tageswerk_record_scheduled_water_round'), false);
 const screen = readFileSync(new URL('../../js/operations-ui.js', import.meta.url), 'utf8');
 assert.match(screen, /Kontrollrunden heute/);
 assert.match(screen, /Zusatzkontrolle starten/);
 assert.match(screen, /Kontrollzeiten speichern/);
 assert.match(screen, /Eine versäumte Runde bleibt überfällig/);
 assert.match(screen, /gilt ab dem nächsten Kalendertag/);
 assert.match(screen, /nachträglich als fehlend/);
 assert.match(screen, /Als Zusatzkontrolle speichern/);
 assert.match(screen, /result\?\.conflict && result\.bundle/);
 const storeSource = readFileSync(new URL('../../js/operations-store.js', import.meta.url), 'utf8');
 assert.match(storeSource, /Die eingegebenen Messwerte bleiben erhalten/);
});
