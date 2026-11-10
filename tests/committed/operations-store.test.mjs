import assert from 'node:assert/strict';
import test from 'node:test';
import {emptyOperations, inspectionOverdue} from '../../js/operations.js';
import {
 loadOperations,
 saveAssetDefect,
 saveAssetRecord,
 saveDailyReport,
 saveDailyReportRevision,
 saveInspectionAssignment,
 saveInspectionDefect,
 saveInspectionResult,
 saveInspectionTemplate,
 saveMaintenanceLog,
 saveProcurementRequest,
 saveProcurementReview,
 saveReportDefect,
 storageMessage
} from '../../js/operations-store.js';

const now = '2026-11-09T12:00:00.000Z';
const facility = {id: 'fac-a', organization_id: 'org-a', name: 'Bad'};
const foreign = {id: 'fac-c', organization_id: 'org-b', name: 'Fremd'};
const context = {facilities: [facility], names: {'employee-1': 'Mia', 'manager-1': 'Lea'}};

function membership(role, target = facility, active = true) {
 return {organization_id: target.organization_id, facility_id: role === 'company_admin' ? null : target.id, role, is_active: active};
}

const employee = {userId: 'employee-1', name: 'Mia', memberships: [membership('employee')]};
const manager = {userId: 'manager-1', name: 'Lea', memberships: [membership('facility_manager')]};
const inactive = {userId: 'employee-2', name: 'Inaktiv', memberships: [membership('employee', facility, false)]};

function blankRows() {
 return {
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
  procurement_requests: []
 };
}

function memoryDb(options = {}) {
 const rows = options.rows || blankRows();
 const calls = [];
 return {
  calls,
  rows,
  async select(table) {
   calls.push(['select', table]);
   if (options.missing) return {data: null, error: {code: 'PGRST205', message: 'Could not find the table in the schema cache'}};
   return {data: (rows[table] || []).map(row => ({...row})), error: null};
  },
  async insert(table, row) {
   calls.push(['insert', table, row]);
   if (options.emptyInsert) return {data: null, error: null};
   if (options.insertError) return {data: null, error: options.insertError};
   const saved = {
    id: `${table}-${rows[table].length + 1}`,
    organization_id: row.facility_id === foreign.id ? foreign.organization_id : facility.organization_id,
    created_by: options.userId || employee.userId,
    created_at: now,
    requested_by: options.userId || employee.userId,
    requested_at: now,
    status: 'submitted',
    completed_by: options.userId || employee.userId,
    completed_at: now,
    ...row
   };
   rows[table].push(saved);
   return {data: {...saved}, error: null};
  },
  async update(table, id, patch) {
   calls.push(['update', table, id, patch]);
   if (options.updateError) return {data: null, error: options.updateError};
   const current = rows[table].find(item => item.id === id);
   if (!current || options.emptyUpdate) return {data: null, error: null};
   Object.assign(current, patch, {reviewed_by: options.userId, reviewed_at: now});
   return {data: {...current}, error: null};
  },
  async rpc(name, args) {
   calls.push(['rpc', name, args]);
   if (options.rpcError) return {data: null, error: options.rpcError};
   if (name === 'tageswerk_update_daily_report') {
    const report = rows.daily_reports.find(item => item.id === args.p_report_id);
    const previous = {incidents: report.incidents, handover: report.handover};
    report.incidents = args.p_incidents;
    report.handover = args.p_handover;
    if (!options.omitRevision) {
     rows.daily_report_revisions.push({
      id: 'rev-1',
      report_id: report.id,
      editor_id: options.userId,
      edited_at: now,
      incidents: previous.incidents,
      handover: previous.handover,
      change_note: args.p_change_note
     });
    }
    return {data: {...report}, error: null};
   }
   if (name === 'tageswerk_link_daily_report_defect') {
    if (options.rejectLink) return {data: null, error: {message: 'Der Mangel gehört zu einem anderen Betrieb.'}};
    return {data: {id: args.p_report_id, defect_id: args.p_defect_id}, error: null};
   }
   if (name === 'tageswerk_create_inspection_template') {
    const id = 'template-1';
    rows.inspection_templates.push({
     id,
     organization_id: facility.organization_id,
     facility_id: args.p_facility_id,
     name: args.p_name,
     interval_count: args.p_interval_count,
     interval_unit: args.p_interval_unit,
     created_by: options.userId,
     created_at: now
    });
    args.p_labels.forEach((label, index) => rows.inspection_points.push({id: `point-${index + 1}`, template_id: id, label, sort_order: index + 1}));
    return {data: {id}, error: null};
   }
   if (name === 'tageswerk_assign_inspection') {
    const template = rows.inspection_templates.find(item => item.id === args.p_template_id);
    const id = 'run-1';
    rows.inspection_runs.push({
     id,
     template_id: template.id,
     organization_id: template.organization_id,
     facility_id: template.facility_id,
     name: template.name,
     assigned_to: args.p_assigned_to,
     due_at: args.p_due_at,
     status: 'open',
     created_at: now
    });
    for (const point of rows.inspection_points.filter(item => item.template_id === template.id)) {
     rows.inspection_results.push({id: `result-${point.id}`, run_id: id, point_id: point.id, label: point.label, mark: 'unchecked', note: ''});
    }
    return {data: {id}, error: null};
   }
   if (name === 'tageswerk_complete_inspection') {
    const run = rows.inspection_runs.find(item => item.id === args.p_run_id);
    run.status = 'completed';
    run.performed_by = options.userId;
    run.performed_at = now;
    for (const item of args.p_results) {
     const result = rows.inspection_results.find(row => row.run_id === run.id && row.point_id === item.point_id);
     result.mark = item.mark;
     result.note = item.note;
    }
    return {data: {id: run.id, status: 'completed'}, error: null};
   }
   if (name === 'tageswerk_defect_from_inspection') {
    return {data: {id: 'defect-new', facility_id: options.defectFacility || facility.id}, error: null};
   }
   return {data: null, error: {code: '42883', message: 'function does not exist'}};
  }
 };
}

test('Ein bestätigter Tagesbericht wird erneut geladen, eine leere Antwort nicht', async () => {
 const db = memoryDb({userId: employee.userId});
 const saved = await saveDailyReport(db, emptyOperations(), {facility, reportDate: '2026-11-09', incidents: 'Pumpe laut', handover: ''}, employee, now, context);
 assert.equal(saved.ok, true);
 assert.equal(saved.report.id, 'daily_reports-1');
 const loaded = await loadOperations(db, employee, context);
 assert.equal(loaded.bundle.reports[0].id, saved.report.id);
 assert.equal(loaded.bundle.reports[0].incidents, 'Pumpe laut');
 const rejected = await saveDailyReport(memoryDb({emptyInsert: true}), emptyOperations(), {facility, reportDate: '2026-11-09', incidents: 'Ohne Bestätigung', handover: ''}, employee, now, context);
 assert.equal(rejected.ok, false);
 assert.equal(rejected.bundle.reports.length, 0);
 assert.match(rejected.error, /nicht bestätigt/);
});

test('Validierung und fehlende Tabellen schreiben nichts in die Liste', async () => {
 const db = memoryDb();
 const invalid = await saveDailyReport(db, emptyOperations(), {facility, reportDate: '2026-11-09', incidents: '', handover: ''}, employee, now, context);
 assert.equal(invalid.ok, false);
 assert.equal(db.calls.some(call => call[0] === 'insert'), false);
 const missing = await saveDailyReport(memoryDb({insertError: {code: 'PGRST205', message: 'schema cache'}}), emptyOperations(), {facility, reportDate: '2026-11-09', incidents: 'Text', handover: ''}, employee, now, context);
 assert.equal(missing.ok, false);
 assert.match(missing.error, /noch nicht installiert/);
 assert.equal(missing.bundle.reports.length, 0);
 const unloaded = await loadOperations(memoryDb({missing: true}), employee, context);
 assert.equal(unloaded.installed, false);
 assert.equal(unloaded.bundle.reports.length, 0);
});

test('Nachtrag, Status und Mangelverknüpfung brauchen eine bestätigte Antwort', async () => {
 const db = memoryDb({userId: employee.userId});
 const saved = await saveDailyReport(db, emptyOperations(), {facility, reportDate: '2026-11-09', incidents: 'Pumpe laut', handover: 'Prüfen'}, employee, now, context);
 const revised = await saveDailyReportRevision(db, saved.bundle, saved.id, {incidents: 'Pumpe getauscht', handover: 'Beobachten', changeNote: 'Nachkontrolle'}, employee, now, context);
 assert.equal(revised.ok, true);
 assert.equal(revised.report.incidents, 'Pumpe getauscht');
 assert.equal(revised.report.revisions[0].changeNote, 'Nachkontrolle');
 assert.equal(revised.report.revisions[0].incidents, 'Pumpe laut');
 const withoutHistory = memoryDb({userId: employee.userId, omitRevision: true, rows: db.rows});
 const lost = await saveDailyReportRevision(withoutHistory, revised.bundle, revised.id, {incidents: 'Nochmals', handover: 'Beobachten', changeNote: 'Zweiter Grund'}, employee, now, context);
 assert.equal(lost.ok, false);
 assert.equal(lost.bundle.reports[0].incidents, 'Pumpe getauscht');
 const linked = await saveReportDefect(db, revised.bundle, revised.id, {id: 'defect-1', facility_id: facility.id}, employee, context);
 assert.equal(linked.report.defectIds.includes('defect-1'), true);
 const foreignDefect = await saveReportDefect(db, linked.bundle, linked.id, {id: 'defect-2', facility_id: foreign.id}, employee, context);
 assert.equal(foreignDefect.ok, false);
 assert.equal(db.calls.some(call => call[1] === 'tageswerk_link_daily_report_defect' && call[2].p_defect_id === 'defect-2'), false);
 const refused = await saveReportDefect(memoryDb({rejectLink: true, rows: structuredClone(db.rows)}), linked.bundle, linked.id, {id: 'defect-3', facility_id: facility.id}, employee, context);
 assert.equal(refused.ok, false);
 assert.equal(refused.bundle.reports[0].defectIds.includes('defect-3'), false);
});

test('Mitarbeiter sehen fremde Betriebe nicht und genehmigen nicht', async () => {
 const rows = blankRows();
 rows.daily_reports.push({
  id: 'foreign-report',
  organization_id: foreign.organization_id,
  facility_id: foreign.id,
  report_date: '2026-11-09',
  incidents: 'Geheim',
  handover: '',
  created_by: 'other',
  created_at: now
 });
 rows.procurement_requests.push({
  id: 'request-1',
  organization_id: facility.organization_id,
  facility_id: facility.id,
  title: 'Filter',
  quantity: '2.5',
  unit: 'Stück',
  reason: 'Kaputt',
  urgency: 'high',
  status: 'submitted',
  defect_id: null,
  requested_by: employee.userId,
  requested_at: now,
  review_note: ''
 });
 const loaded = await loadOperations(memoryDb({rows}), employee, context);
 assert.equal(loaded.bundle.reports.length, 0);
 assert.equal(loaded.bundle.requests.length, 1);
 const hidden = await loadOperations(memoryDb({rows}), inactive, context);
 assert.equal(hidden.bundle.requests.length, 0);
 const employeeDb = memoryDb({userId: employee.userId, rows: structuredClone(rows)});
 const blocked = await saveProcurementReview(employeeDb, loaded.bundle, 'request-1', 'approved', 'Passt', employee, now, context);
 assert.equal(blocked.ok, false);
 assert.equal(employeeDb.calls.some(call => call[0] === 'update'), false);
 assert.equal(blocked.bundle.requests[0].status, 'submitted');
 const managerDb = memoryDb({userId: manager.userId, rows: structuredClone(rows)});
 const approved = await saveProcurementReview(managerDb, loaded.bundle, 'request-1', 'approved', 'Passt', manager, now, context);
 assert.equal(approved.ok, true);
 assert.equal(approved.request.status, 'approved');
 assert.equal(approved.request.reviewedBy, manager.userId);
 const refused = await saveProcurementReview(memoryDb({userId: manager.userId, emptyUpdate: true, rows: structuredClone(rows)}), loaded.bundle, 'request-1', 'rejected', 'Zu teuer', manager, now, context);
 assert.equal(refused.ok, false);
 assert.equal(refused.bundle.requests[0].status, 'submitted');
});

test('Kontrollgang, Wartung und Beschaffung bestätigen Verlauf und Mangel', async () => {
 const db = memoryDb({userId: manager.userId});
 const template = await saveInspectionTemplate(db, emptyOperations(), {facility, name: 'Früh', points: 'Tür\nLicht', intervalUnit: 'day', intervalCount: 1}, manager, now, context);
 assert.equal(template.template.points.length, 2);
 const assigned = await saveInspectionAssignment(db, template.bundle, template.id, {assignedTo: employee.userId, assignedName: 'Mia', dueAt: '2026-11-08T08:00:00.000Z'}, manager, now, context);
 assert.equal(assigned.run.status, 'open');
 assert.equal(inspectionOverdue(assigned.run, now), true);
 const employeeDb = memoryDb({userId: employee.userId, rows: db.rows});
 const recorded = await saveInspectionResult(employeeDb, assigned.bundle, assigned.id, assigned.run.points.map((point, index) => ({id: point.id, mark: index === 0 ? 'notable' : 'ok', note: index === 0 ? 'Klemmt' : ''})), employee, now, context);
 assert.equal(recorded.run.status, 'completed');
 assert.equal(recorded.notable[0].label, 'Tür');
 const defect = await saveInspectionDefect(employeeDb, recorded.bundle, recorded.id, recorded.notable[0].id, employee, context);
 assert.equal(defect.run.points[0].defectId, 'defect-new');
 const wrongFacility = await saveInspectionDefect(memoryDb({defectFacility: foreign.id, rows: employeeDb.rows}), recorded.bundle, recorded.id, recorded.notable[0].id, employee, context);
 assert.equal(wrongFacility.ok, false);
 assert.equal(wrongFacility.bundle.runs[0].points[0].defectId, null);
 const asset = await saveAssetRecord(db, emptyOperations(), {facility, name: 'Pumpe', location: 'Keller', intervalUnit: 'month', intervalCount: 1, anchorAt: '2026-01-31', responsibleUserId: employee.userId}, manager, now, context);
 assert.equal(asset.asset.name, 'Pumpe');
 const log = await saveMaintenanceLog(memoryDb({userId: employee.userId, rows: db.rows}), asset.bundle, asset.id, 'Dichtung gewechselt', employee, now, context);
 assert.match(log.asset.logs[0].note, /Dichtung/);
 const assetLink = await saveAssetDefect(db, log.bundle, asset.id, {id: 'defect-1', facility_id: facility.id});
 assert.equal(assetLink.asset.defectIds.includes('defect-1'), true);
 const request = await saveProcurementRequest(memoryDb({userId: employee.userId, rows: db.rows}), emptyOperations(), {facility, title: 'Dichtung', quantity: '2,5', unit: 'Stück', reason: 'Verschlissen', urgency: 'normal', defect: {id: 'defect-1', facility_id: facility.id}}, employee, now, context);
 assert.equal(request.request.quantity, '2.5');
 assert.equal(request.request.defectId, 'defect-1');
 assert.equal(request.request.status, 'submitted');
 assert.match(storageMessage({code: '42883', message: 'function does not exist'}), /nicht installiert/);
});
