import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {emptyOperations} from '../../js/operations.js';
import {
 loadOperations,
 saveWaterFilter,
 saveWaterFilterActive,
 saveWaterFilterChange,
 saveWaterFilterFlush,
 saveWaterFilterFlushCorrection
} from '../../js/operations-store.js';
import {
 canCorrectWaterFilterFlush,
 canManageWaterFilters,
 canReadWaterFilterFlushHistory,
 canReadWaterFilterStatusHistory,
 canRecordWaterFilterFlush,
 filterFlushHistoryRows,
 filterStatusHistoryRows,
 filtersForPool,
 waterFilterFlushDraftError
} from '../../js/water-filters.js';

const now = '2026-11-14T12:00:00.000Z';
const facility = {id: 'fac-a', organization_id: 'org-a', name: 'Bad'};
const foreign = {id: 'fac-c', organization_id: 'org-b', name: 'Fremd'};
const context = {
 facilities: [facility, foreign],
 names: {
  'employee-1': 'Mia',
  'technician-1': 'Tim',
  'manager-1': 'Lea',
  'admin-1': 'Alex'
 }
};

function membership(role, target = facility, active = true) {
 return {
  organization_id: target.organization_id,
  facility_id: role === 'company_admin' ? null : target.id,
  role,
  is_active: active
 };
}

const employee = {userId: 'employee-1', name: 'Mia', memberships: [membership('employee')]};
const technician = {userId: 'technician-1', name: 'Tim', memberships: [membership('technician')]};
const manager = {userId: 'manager-1', name: 'Lea', memberships: [membership('facility_manager')]};
const admin = {userId: 'admin-1', name: 'Alex', memberships: [membership('company_admin')]};

const baseMigration = readFileSync(new URL('../../tageswerk_3_5_8_water_filter_flushes.sql', import.meta.url), 'utf8');
const extensionMigration = readFileSync(new URL('../../tageswerk_3_5_8_water_filter_extensions.sql', import.meta.url), 'utf8');
const storeSource = readFileSync(new URL('../../js/operations-store.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../../js/operations-ui-water.js', import.meta.url), 'utf8');

function blankRows() {
 return {
  daily_reports: [], daily_report_revisions: [], daily_report_defects: [],
  inspection_templates: [], inspection_points: [], inspection_runs: [], inspection_results: [],
  assets: [], maintenance_logs: [], asset_defects: [], procurement_requests: [],
  temperature_points: [], temperature_readings: [], temperature_alerts: [],
  materials: [], material_movements: [],
  water_parameter_definitions: [], water_pools: [
   {id: 'pool-1', organization_id: facility.organization_id, facility_id: facility.id, name: 'Kinderbecken', active: true},
   {id: 'pool-2', organization_id: facility.organization_id, facility_id: facility.id, name: 'Schwimmerbecken', active: true}
  ],
  water_pool_parameters: [], water_checks: [], water_alerts: [], water_alert_measures: [], water_round_drafts: [],
  water_facility_slots: [], water_round_slots: [],
  water_filters: [],
  water_filter_flushes: [],
  water_filter_flush_corrections: [],
  water_filter_status_events: []
 };
}

function refreshLastFlush(rows, filterId) {
 const filter = rows.water_filters.find(item => item.id === filterId);
 if (!filter) return;
 const candidates = rows.water_filter_flushes.map(flush => {
  const latest = rows.water_filter_flush_corrections
   .filter(item => item.flush_id === flush.id)
   .sort((a, b) => String(b.corrected_at).localeCompare(String(a.corrected_at)))[0];
  return {
   filter_id: latest ? latest.filter_id : flush.filter_id,
   flushed_at: latest ? latest.flushed_at : flush.flushed_at,
   recorded_at: flush.recorded_at,
   recorded_by: flush.recorded_by,
   id: flush.id
  };
 }).filter(item => item.filter_id === filterId).sort((left, right) => {
  const byFlush = String(right.flushed_at).localeCompare(String(left.flushed_at));
  if (byFlush) return byFlush;
  const byRecorded = String(right.recorded_at).localeCompare(String(left.recorded_at));
  return byRecorded || String(right.id).localeCompare(String(left.id));
 });
 const latest = candidates[0];
 filter.last_flushed_at = latest?.flushed_at || null;
 filter.last_flushed_by = latest?.recorded_by || null;
}

function filterDb(options = {}) {
 const rows = options.rows || blankRows();
 const calls = [];
 return {
  calls,
  rows,
  async select(table) {
   calls.push(['select', table]);
   if ((options.missingTables || []).includes(table)) {
    return {data: null, error: {code: 'PGRST205', message: 'schema cache'}};
   }
   return {data: (rows[table] || []).map(row => ({...row})), error: null};
  },
  async insert(table, row) {
   calls.push(['insert', table, row]);
   if (options.insertError) return {data: null, error: options.insertError};
   if (options.emptyInsert) return {data: null, error: null};
   if (!rows[table]) rows[table] = [];
   if (table === 'water_filter_flushes') {
    const filter = rows.water_filters.find(item => item.id === row.filter_id);
    if (!filter || filter.active === false) {
     return {data: null, error: {code: 'P0001', message: 'Der Filter ist nicht aktiv.'}};
    }
    const flushedAt = row.flushed_at || now;
    const stamp = new Date(flushedAt).getTime();
    const current = new Date(now).getTime();
    if (stamp > current) return {data: null, error: {code: 'P0001', message: 'Ein zukünftiger Spülzeitpunkt ist nicht zulässig.'}};
    if (stamp < current - 24 * 60 * 60 * 1000) {
     return {data: null, error: {code: 'P0001', message: 'Eine nachträgliche Spülung ist höchstens 24 Stunden zulässig.'}};
    }
    const saved = {
     id: `flush-${rows.water_filter_flushes.length + 1}`,
     organization_id: filter.organization_id,
     facility_id: filter.facility_id,
     pool_id: filter.pool_id,
     filter_id: filter.id,
     flushed_at: flushedAt,
     recorded_at: now,
     recorded_by: options.userId,
     note: row.note || ''
    };
    rows.water_filter_flushes.push(saved);
    refreshLastFlush(rows, filter.id);
    return {data: {...saved}, error: null};
   }
   const saved = {
    id: `${table}-${rows[table].length + 1}`,
    organization_id: row.organization_id || facility.organization_id,
    created_by: options.userId,
    created_at: now,
    active: true,
    last_flushed_at: null,
    last_flushed_by: null,
    ...row
   };
   rows[table].push(saved);
   return {data: {...saved}, error: null};
  },
  async update(table, id, patch) {
   calls.push(['update', table, id, patch]);
   if (table === 'water_filter_flushes') {
    return {data: null, error: {code: '42501', message: 'permission denied for table water_filter_flushes'}};
   }
   if (table === 'water_filters' && Object.prototype.hasOwnProperty.call(patch, 'active')) {
    return {data: null, error: {code: '42501', message: 'permission denied for column active'}};
   }
   const current = (rows[table] || []).find(item => item.id === id);
   if (!current || options.emptyUpdate) return {data: null, error: null};
   Object.assign(current, patch);
   return {data: {...current}, error: null};
  },
  async rpc(name, args) {
   calls.push(['rpc', name, args]);
   if (options.rpcError) return {data: null, error: options.rpcError};
   if (name === 'tageswerk_set_water_filter_active') {
    const filter = rows.water_filters.find(item => item.id === args.p_filter_id);
    if (!filter) return {data: {ok: false}, error: null};
    const event = {
     id: `status-${rows.water_filter_status_events.length + 1}`,
     filter_id: filter.id,
     facility_id: filter.facility_id,
     organization_id: filter.organization_id,
     changed_at: now,
     changed_by: options.userId,
     reason: args.p_reason,
     old_active: filter.active === true,
     new_active: args.p_active === true
    };
    filter.active = args.p_active === true;
    rows.water_filter_status_events.push(event);
    return {data: {ok: true, event_id: event.id}, error: null};
   }
   if (name === 'tageswerk_correct_water_filter_flush') {
    const flush = rows.water_filter_flushes.find(item => item.id === args.p_flush_id);
    if (!flush) return {data: {ok: false}, error: null};
    const nextFilter = rows.water_filters.find(item => item.id === args.p_filter_id);
    if (!nextFilter || nextFilter.active === false) {
     return {data: null, error: {code: 'P0001', message: 'Der Filter ist nicht aktiv.'}};
    }
    const correction = {
     id: `correction-${rows.water_filter_flush_corrections.length + 1}`,
     flush_id: flush.id,
     facility_id: flush.facility_id,
     organization_id: flush.organization_id,
     corrected_at: now,
     corrected_by: options.userId,
     reason: args.p_reason,
     previous_filter_id: flush.filter_id,
     previous_pool_id: flush.pool_id,
     previous_flushed_at: flush.flushed_at,
     previous_note: flush.note || '',
     filter_id: nextFilter.id,
     pool_id: nextFilter.pool_id,
     flushed_at: args.p_flushed_at,
     note: args.p_note || ''
    };
    const previous = rows.water_filter_flush_corrections
     .filter(item => item.flush_id === flush.id)
     .sort((a, b) => String(b.corrected_at).localeCompare(String(a.corrected_at)))[0];
    if (previous) {
     correction.previous_filter_id = previous.filter_id;
     correction.previous_pool_id = previous.pool_id;
     correction.previous_flushed_at = previous.flushed_at;
     correction.previous_note = previous.note || '';
    }
    rows.water_filter_flush_corrections.push(correction);
    refreshLastFlush(rows, flush.filter_id);
    refreshLastFlush(rows, nextFilter.id);
    return {data: {ok: true, correction_id: correction.id}, error: null};
   }
   return {data: null, error: {code: '42883', message: 'function does not exist'}};
  }
 };
}

test('Rollen trennen Verwaltung, Erfassen, Historie und Korrektur', () => {
 assert.equal(canRecordWaterFilterFlush(facility, employee.memberships), true);
 assert.equal(canReadWaterFilterFlushHistory(facility, employee.memberships), false);
 assert.equal(canManageWaterFilters(facility, employee.memberships), false);
 assert.equal(canCorrectWaterFilterFlush(facility, employee.memberships), false);
 assert.equal(canReadWaterFilterStatusHistory(facility, employee.memberships), false);

 assert.equal(canRecordWaterFilterFlush(facility, technician.memberships), true);
 assert.equal(canReadWaterFilterFlushHistory(facility, technician.memberships), true);
 assert.equal(canManageWaterFilters(facility, technician.memberships), false);
 assert.equal(canCorrectWaterFilterFlush(facility, technician.memberships), false);
 assert.equal(canReadWaterFilterStatusHistory(facility, technician.memberships), false);

 assert.equal(canManageWaterFilters(facility, manager.memberships), true);
 assert.equal(canCorrectWaterFilterFlush(facility, manager.memberships), true);
 assert.equal(canReadWaterFilterStatusHistory(facility, manager.memberships), true);
 assert.equal(canManageWaterFilters(facility, admin.memberships), true);
 assert.equal(canCorrectWaterFilterFlush(facility, admin.memberships), true);
});

test('Filterverwaltung legt an, benennt um und trennt Becken', async () => {
 const db = filterDb({userId: manager.userId});
 const first = await saveWaterFilter(db, emptyOperations(), facility, {poolId: 'pool-1', name: 'Sandfilter A'}, manager, context);
 assert.equal(first.ok, true);
 assert.equal(first.filter.poolId, 'pool-1');
 assert.equal(first.filter.name, 'Sandfilter A');
 assert.equal(first.filter.active, true);

 const second = await saveWaterFilter(db, first.bundle, facility, {poolId: 'pool-2', name: 'Sandfilter B'}, manager, context);
 assert.equal(second.ok, true);
 assert.equal(second.filter.poolId, 'pool-2');

 const renamed = await saveWaterFilterChange(db, second.bundle, first.id, {name: 'Sandfilter Nord'}, manager, context);
 assert.equal(renamed.ok, true);
 assert.equal(renamed.filter.name, 'Sandfilter Nord');

 const poolOne = filtersForPool(renamed.bundle.waterFilters, 'pool-1', {includeInactive: true});
 const poolTwo = filtersForPool(renamed.bundle.waterFilters, 'pool-2', {includeInactive: true});
 assert.deepEqual(poolOne.map(item => item.name), ['Sandfilter Nord']);
 assert.deepEqual(poolTwo.map(item => item.name), ['Sandfilter B']);

 const denied = await saveWaterFilter(db, renamed.bundle, facility, {poolId: 'pool-1', name: 'Unerlaubt'}, employee, context);
 assert.equal(denied.ok, false);
 assert.equal(db.calls.filter(call => call[0] === 'insert' && call[1] === 'water_filters').length, 2);
});

test('Spülung speichern, Nachtrag und Ablehnungen', async () => {
 const db = filterDb({userId: employee.userId});
 const managerDb = filterDb({userId: manager.userId, rows: db.rows});
 const created = await saveWaterFilter(managerDb, emptyOperations(), facility, {poolId: 'pool-1', name: 'Hauptfilter'}, manager, context);
 assert.equal(created.ok, true);

 const within = await saveWaterFilterFlush(db, created.bundle, facility, {
  filterId: created.id,
  flushedAt: '2026-11-14T10:00:00.000Z',
  note: 'Routine'
 }, employee, now, context);
 assert.equal(within.ok, true);
 assert.equal(within.id, 'flush-1');

 const loaded = await loadOperations(filterDb({userId: manager.userId, rows: db.rows}), manager, context);
 assert.equal(loaded.ok, true);
 assert.equal(loaded.bundle.waterFilters.find(item => item.id === created.id).lastFlushedAt, '2026-11-14T10:00:00.000Z');
 assert.equal(loaded.bundle.waterFilters.find(item => item.id === created.id).lastFlushedBy, employee.userId);
 assert.equal(loaded.bundle.waterFilterFlushes[0].recordedName, 'Mia');
 assert.equal(loaded.bundle.waterFilterFlushes[0].note, 'Routine');

 assert.match(waterFilterFlushDraftError({
  filterId: created.id,
  flushedAt: '2026-11-12T11:00:00.000Z'
 }, now), /24 Stunden/);
 const tooOld = await saveWaterFilterFlush(db, loaded.bundle, facility, {
  filterId: created.id,
  flushedAt: '2026-11-12T11:00:00.000Z',
  note: 'alt'
 }, employee, now, context);
 assert.equal(tooOld.ok, false);
 assert.match(tooOld.error, /24 Stunden/);

 const future = await saveWaterFilterFlush(db, loaded.bundle, facility, {
  filterId: created.id,
  flushedAt: '2026-11-15T12:00:00.000Z',
  note: 'Zukunft'
 }, employee, now, context);
 assert.equal(future.ok, false);
 assert.match(future.error, /zukünftig/);

 const before = db.rows.water_filter_flushes.length;
 const empty = await saveWaterFilterFlush(filterDb({userId: employee.userId, emptyInsert: true, rows: structuredClone(db.rows)}), loaded.bundle, facility, {
  filterId: created.id,
  flushedAt: '2026-11-14T11:00:00.000Z',
  note: ''
 }, employee, now, context);
 assert.equal(empty.ok, false);
 assert.equal(before, db.rows.water_filter_flushes.length);
});

test('Statuswechsel, Historie und keine Spülung auf inaktive Filter', async () => {
 const db = filterDb({userId: manager.userId});
 const created = await saveWaterFilter(db, emptyOperations(), facility, {poolId: 'pool-1', name: 'Statusfilter'}, manager, context);
 const off = await saveWaterFilterActive(db, created.bundle, created.id, false, 'Wartung nötig', manager, context);
 assert.equal(off.ok, true);
 assert.equal(off.filter.active, false);
 assert.equal(db.calls.some(call => call[0] === 'rpc' && call[1] === 'tageswerk_set_water_filter_active'), true);
 assert.equal(db.calls.some(call => call[0] === 'update' && call[1] === 'water_filters' && Object.prototype.hasOwnProperty.call(call[3] || {}, 'active')), false);

 const events = filterStatusHistoryRows(off.bundle.waterFilterStatusEvents, {facilityId: facility.id});
 assert.equal(events.length, 1);
 assert.equal(events[0].reason, 'Wartung nötig');
 assert.equal(events[0].oldActive, true);
 assert.equal(events[0].newActive, false);
 assert.equal(events[0].changedName, 'Lea');

 const employeeDb = filterDb({userId: employee.userId, rows: db.rows});
 const blocked = await saveWaterFilterFlush(employeeDb, off.bundle, facility, {
  filterId: created.id,
  flushedAt: '2026-11-14T11:30:00.000Z',
  note: ''
 }, employee, now, context);
 assert.equal(blocked.ok, false);
 assert.match(blocked.error, /nicht aktiv|nicht bestätigt|Berechtigung|Filter/);
 assert.equal(filtersForPool(off.bundle.waterFilters, 'pool-1').length, 0);

 const reasonMissing = await saveWaterFilterActive(db, off.bundle, created.id, true, 'ok', manager, context);
 assert.equal(reasonMissing.ok, false);
 assert.match(reasonMissing.error, /Begründung/);

 const on = await saveWaterFilterActive(db, off.bundle, created.id, true, 'Wartung abgeschlossen', manager, context);
 assert.equal(on.ok, true);
 assert.equal(on.filter.active, true);
 assert.equal(filterStatusHistoryRows(on.bundle.waterFilterStatusEvents, {facilityId: facility.id}).length, 2);

 const employeeDenied = await saveWaterFilterActive(employeeDb, on.bundle, created.id, false, 'Versuch', employee, context);
 assert.equal(employeeDenied.ok, false);
});

test('Korrekturen ändern wirksam, Originale bleiben und last_flushed folgt nach', async () => {
 const db = filterDb({userId: manager.userId});
 const filterA = await saveWaterFilter(db, emptyOperations(), facility, {poolId: 'pool-1', name: 'Filter A'}, manager, context);
 const filterB = await saveWaterFilter(db, filterA.bundle, facility, {poolId: 'pool-2', name: 'Filter B'}, manager, context);
 const flush = await saveWaterFilterFlush(filterDb({userId: employee.userId, rows: db.rows}), filterB.bundle, facility, {
  filterId: filterA.id,
  flushedAt: '2026-11-14T09:00:00.000Z',
  note: 'falscher Filter'
 }, employee, now, context);
 assert.equal(flush.ok, true);

 const managerView = await loadOperations(filterDb({userId: manager.userId, rows: db.rows}), manager, context);
 const original = managerView.bundle.waterFilterFlushes.find(item => item.id === flush.id);
 assert.equal(original.originalFilterId, filterA.id);
 assert.equal(original.originalNote, 'falscher Filter');

 const first = await saveWaterFilterFlushCorrection(filterDb({userId: manager.userId, rows: db.rows}), managerView.bundle, flush.id, {
  filterId: filterB.id,
  flushedAt: '2026-11-14T09:15:00.000Z',
  note: 'korrigiert',
  reason: 'Falsche Zuordnung'
 }, manager, context);
 assert.equal(first.ok, true);
 assert.equal(first.flush.isCorrected, true);
 assert.equal(first.flush.filterId, filterB.id);
 assert.equal(first.flush.note, 'korrigiert');
 assert.equal(first.flush.originalFilterId, filterA.id);
 assert.equal(first.flush.originalNote, 'falscher Filter');
 assert.equal(db.rows.water_filter_flushes.find(item => item.id === flush.id).filter_id, filterA.id);
 assert.equal(db.rows.water_filter_flushes.find(item => item.id === flush.id).note, 'falscher Filter');
 assert.equal(db.calls.some(call => call[0] === 'update' && call[1] === 'water_filter_flushes'), false);

 const afterFirst = await loadOperations(filterDb({userId: manager.userId, rows: db.rows}), manager, context);
 assert.equal(afterFirst.bundle.waterFilters.find(item => item.id === filterA.id).lastFlushedAt, null);
 assert.equal(afterFirst.bundle.waterFilters.find(item => item.id === filterB.id).lastFlushedAt, '2026-11-14T09:15:00.000Z');

 const second = await saveWaterFilterFlushCorrection(filterDb({userId: manager.userId, rows: db.rows}), afterFirst.bundle, flush.id, {
  filterId: filterB.id,
  flushedAt: '2026-11-14T09:20:00.000Z',
  note: 'nochmals',
  reason: 'Uhrzeit nachziehen'
 }, manager, context);
 assert.equal(second.ok, true);
 assert.equal(second.flush.correctionCount, 2);
 assert.equal(second.flush.flushedAt, '2026-11-14T09:20:00.000Z');
 assert.equal(db.rows.water_filter_flush_corrections.length, 2);

 const noReason = await saveWaterFilterFlushCorrection(filterDb({userId: manager.userId, rows: db.rows}), second.bundle, flush.id, {
  filterId: filterB.id,
  flushedAt: '2026-11-14T09:25:00.000Z',
  note: 'x',
  reason: 'ab'
 }, manager, context);
 assert.equal(noReason.ok, false);

 const techDenied = await saveWaterFilterFlushCorrection(filterDb({userId: technician.userId, rows: db.rows}), second.bundle, flush.id, {
  filterId: filterB.id,
  flushedAt: '2026-11-14T09:30:00.000Z',
  note: 'tech',
  reason: 'Versuch ohne Recht'
 }, technician, context);
 assert.equal(techDenied.ok, false);

 const history = filterFlushHistoryRows(second.bundle.waterFilterFlushes, {
  facilityId: facility.id,
  poolId: 'pool-2',
  from: '2026-11-14',
  to: '2026-11-14'
 });
 assert.equal(history.length, 1);
 assert.equal(history[0].isCorrected, true);
});

test('Mitarbeiter laden keine Spülhistorie, Leitung und Techniker schon', async () => {
 const db = filterDb({userId: manager.userId});
 const created = await saveWaterFilter(db, emptyOperations(), facility, {poolId: 'pool-1', name: 'Sichtfilter'}, manager, context);
 await saveWaterFilterFlush(filterDb({userId: employee.userId, rows: db.rows}), created.bundle, facility, {
  filterId: created.id,
  flushedAt: '2026-11-14T08:00:00.000Z',
  note: 'sichtbar'
 }, employee, now, context);

 const employeeLoaded = await loadOperations(filterDb({userId: employee.userId, rows: db.rows}), employee, context);
 assert.equal(employeeLoaded.ok, true);
 // RLS wird hier nicht simuliert; die UI-Rechte sperren die Historie für Mitarbeiter.
 assert.equal(canReadWaterFilterFlushHistory(facility, employee.memberships), false);
 assert.match(uiSource, /const history = canReadWaterFilterFlushHistory/);
 assert.match(uiSource, /if \(history\)/);

 const techLoaded = await loadOperations(filterDb({userId: technician.userId, rows: db.rows}), technician, context);
 assert.equal(techLoaded.bundle.waterFilterFlushes.length >= 1, true);
 assert.equal(canReadWaterFilterFlushHistory(facility, technician.memberships), true);
});

test('Sicherheit: RLS, Caps, RPC und keine direkten Historien-/Statusänderungen', () => {
 assert.match(baseMigration, /FORCE ROW LEVEL SECURITY/);
 assert.match(baseMigration, /water_filter_flushes_select[\s\S]*'technician', 'facility_manager', 'company_admin'/);
 assert.match(baseMigration, /water_filters_select[\s\S]*employee[\s\S]*active IS TRUE/);
 assert.doesNotMatch(baseMigration, /GRANT UPDATE ON TABLE public\.water_filter_flushes/);
 assert.doesNotMatch(baseMigration, /GRANT DELETE ON TABLE public\.water_filter_flushes/);

 assert.match(extensionMigration, /tageswerk_water_filter_caps/);
 assert.match(extensionMigration, /tageswerk_correct_water_filter_flush/);
 assert.match(extensionMigration, /tageswerk_set_water_filter_active/);
 assert.match(extensionMigration, /Originaleintrag bleibt unverändert/);
 assert.match(extensionMigration, /GRANT UPDATE \(name\) ON TABLE public\.water_filters/);
 assert.match(extensionMigration, /REVOKE UPDATE ON TABLE public\.water_filters FROM PUBLIC/);
 assert.doesNotMatch(extensionMigration, /GRANT UPDATE ON TABLE public\.water_filter_flushes/);

 assert.match(storeSource, /tageswerk_correct_water_filter_flush/);
 assert.match(storeSource, /tageswerk_set_water_filter_active/);
 assert.doesNotMatch(storeSource, /db\.update\('water_filter_flushes'/);
 assert.match(uiSource, /saveWaterFilterFlushCorrection\(/);
 assert.match(uiSource, /saveWaterFilterActive\(/);
 assert.doesNotMatch(uiSource, /update\('water_filter_flushes'/);
});
