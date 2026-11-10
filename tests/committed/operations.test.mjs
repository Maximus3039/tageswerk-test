import assert from 'node:assert/strict';
import test from 'node:test';
import {
 assignInspection,
 assetNextDue,
 completeMaintenance,
 createAsset,
 createDailyReport,
 createInspectionTemplate,
 createProcurement,
 dailyReportEmail,
 emptyOperations,
 inspectionDefectDraft,
 inspectionOverdue,
 linkAssetDefect,
 linkReportDefect,
 operationMetrics,
 recordInspection,
 reviewProcurement,
 reviseDailyReport
} from '../../js/operations.js';

const now = '2026-11-09T12:00:00.000Z';
const facility = {id: 'fac-a', organization_id: 'org-a', name: 'Bad'};
const other = {id: 'fac-b', organization_id: 'org-a', name: 'Strand'};
const foreign = {id: 'fac-c', organization_id: 'org-b', name: 'Fremd'};

function membership(role, target = facility, active = true) {
 return {organization_id: target.organization_id, facility_id: role === 'company_admin' ? null : target.id, role, is_active: active};
}

const employee = {userId: 'employee-1', name: 'Mia', memberships: [membership('employee')]};
const manager = {userId: 'manager-1', name: 'Lea', memberships: [membership('facility_manager')]};
const admin = {userId: 'admin-1', name: 'Kim', memberships: [membership('company_admin')]};
const inactive = {userId: 'employee-2', name: 'Inaktiv', memberships: [membership('employee', facility, false)]};

test('Ein Mitarbeiter schreibt den Tagesbericht nur für den eigenen Betrieb', () => {
 const created = createDailyReport(emptyOperations(), {facility, reportDate: '2026-11-09', incidents: 'Pumpe laut', handover: 'Morgen prüfen'}, employee, now);
 assert.equal(created.ok, true);
 assert.equal(created.report.authorName, 'Mia');
 assert.equal(created.report.createdAt, now);
 assert.equal(createDailyReport(created.bundle, {facility: other, reportDate: '2026-11-09', incidents: 'Fremd', handover: ''}, employee, now).ok, false);
 assert.equal(createDailyReport(created.bundle, {facility, reportDate: '2026-11-09', incidents: 'Nochmals', handover: ''}, employee, now).ok, false);
 assert.equal(createDailyReport(emptyOperations(), {facility, reportDate: '2026-11-09', incidents: 'Nein', handover: ''}, inactive, now).ok, false);
 assert.equal(createDailyReport(emptyOperations(), {facility: foreign, reportDate: '2026-11-09', incidents: 'Nein', handover: ''}, admin, now).ok, false);
 const revised = reviseDailyReport(created.bundle, created.report.id, {incidents: 'Pumpe getauscht', handover: 'Beobachten', changeNote: ''}, employee, now);
 assert.equal(revised.ok, false);
 const traced = reviseDailyReport(created.bundle, created.report.id, {incidents: 'Pumpe getauscht', handover: 'Beobachten', changeNote: 'Nachkontrolle'}, employee, '2026-11-09T18:00:00.000Z');
 assert.equal(traced.ok, true);
 assert.equal(traced.report.revisions[0].incidents, 'Pumpe laut');
 assert.equal(traced.report.revisions[0].editorId, employee.userId);
 const linked = linkReportDefect(traced.bundle, traced.report.id, {id: 'defect-1', facility_id: facility.id});
 assert.equal(linked.ok, true);
 assert.equal(linkReportDefect(linked.bundle, traced.report.id, {id: 'defect-2', facility_id: other.id}).ok, false);
 const mail = dailyReportEmail(traced.report, facility.name);
 assert.equal(mail.send, false);
 assert.match(mail.subject, /2026-11-09/);
 assert.match(mail.body, /Pumpe getauscht/);
});

test('Kontrollgänge werden zugewiesen, markiert und bei Auffälligkeit zum Mangel', () => {
 assert.equal(createInspectionTemplate(emptyOperations(), {facility, name: 'Früh', points: 'Tür\nLicht', intervalUnit: 'day', intervalCount: 1}, employee, now).ok, false);
 const template = createInspectionTemplate(emptyOperations(), {facility, name: 'Früh', points: 'Tür\nLicht', intervalUnit: 'day', intervalCount: 1}, manager, now);
 assert.equal(template.ok, true);
 const assigned = assignInspection(template.bundle, template.template.id, {assignedTo: employee.userId, assignedName: 'Mia', dueAt: '2026-11-08T08:00:00.000Z'}, manager, now);
 assert.equal(assigned.ok, true);
 assert.equal(inspectionOverdue(assigned.run, now), true);
 const stranger = {userId: 'employee-9', name: 'Fremd', memberships: [membership('employee', other)]};
 assert.equal(recordInspection(assigned.bundle, assigned.run.id, assigned.run.points.map(point => ({id: point.id, mark: 'ok', note: ''})), stranger, now).ok, false);
 const recorded = recordInspection(assigned.bundle, assigned.run.id, assigned.run.points.map((point, index) => ({id: point.id, mark: index === 0 ? 'notable' : 'ok', note: index === 0 ? 'Klemmt' : ''})), employee, now);
 assert.equal(recorded.ok, true);
 assert.equal(recorded.run.performedBy, employee.userId);
 assert.equal(recorded.notable.length, 1);
 const draft = inspectionDefectDraft(recorded.run, recorded.notable[0]);
 assert.equal(draft.ok, true);
 assert.equal(draft.defect.facility_id, facility.id);
 assert.match(draft.defect.title, /Tür/);
});

test('Wartung berechnet den nächsten Termin und speichert die Historie', () => {
 const asset = createAsset(emptyOperations(), {facility, name: 'Filter', location: 'Keller', intervalUnit: 'month', intervalCount: 1, anchorAt: '2026-01-31T08:00:00.000Z', responsibleUserId: employee.userId, responsibleName: 'Mia'}, manager, now);
 assert.equal(asset.ok, true);
 assert.equal(assetNextDue(asset.asset).toISOString().slice(0, 10), '2026-02-28');
 assert.equal(completeMaintenance(asset.bundle, asset.asset.id, '', employee, now).ok, false);
 assert.equal(completeMaintenance(asset.bundle, asset.asset.id, 'Filter gespült', stranger(), now).ok, false);
 const done = completeMaintenance(asset.bundle, asset.asset.id, 'Filter gespült', employee, now);
 assert.equal(done.ok, true);
 assert.equal(done.asset.logs[0].completedName, 'Mia');
 assert.equal(linkAssetDefect(done.bundle, asset.asset.id, {id: 'defect-3', facility_id: other.id}).ok, false);
 assert.equal(linkAssetDefect(done.bundle, asset.asset.id, {id: 'defect-3', facility_id: facility.id}).ok, true);
});

test('Beschaffung wird gemeldet und nur von der Leitung entschieden', () => {
 const request = createProcurement(emptyOperations(), {facility, title: 'Dichtungen', quantity: '2,5', unit: 'Packung', reason: 'Pumpe tropft', urgency: 'high', defect: {id: 'defect-4', facility_id: facility.id}}, employee, now);
 assert.equal(request.ok, true);
 assert.equal(request.request.status, 'submitted');
 assert.equal(request.request.quantity, '2.5');
 assert.equal(createProcurement(emptyOperations(), {facility, title: 'Sand', quantity: '0', reason: 'Leer', urgency: 'normal'}, employee, now).ok, false);
 assert.equal(createProcurement(emptyOperations(), {facility: other, title: 'Sand', quantity: '1', reason: 'Leer', urgency: 'normal', defect: {id: 'defect-4', facility_id: facility.id}}, admin, now).ok, false);
 assert.equal(reviewProcurement(request.bundle, request.request.id, 'approved', 'Bestellt', employee, now).ok, false);
 const approved = reviewProcurement(request.bundle, request.request.id, 'approved', 'Bestellt', manager, '2026-11-09T15:00:00.000Z');
 assert.equal(approved.ok, true);
 assert.equal(approved.request.reviewedBy, manager.userId);
 assert.equal(approved.request.reviewedAt, '2026-11-09T15:00:00.000Z');
 assert.equal(reviewProcurement(approved.bundle, request.request.id, 'rejected', 'Zu spät', admin, now).ok, false);
 const metrics = operationMetrics(approved.bundle, [facility.id, other.id], '2026-11-09', now);
 assert.equal(metrics.procurementOpen, 0);
 assert.equal(metrics.maintenanceOverdue, 0);
});

test('Techniker nutzen die operativen Module und verwalten sie nicht', () => {
 const technician = {userId: 'technician-1', name: 'Timo', memberships: [membership('technician')]};
 const report = createDailyReport(emptyOperations(), {facility, reportDate: '2026-11-09', incidents: 'Pumpe laut', handover: 'Weiter beobachten'}, technician, now);
 assert.equal(report.ok, true);
 assert.equal(createDailyReport(report.bundle, {facility: other, reportDate: '2026-11-09', incidents: 'Fremd', handover: ''}, technician, now).ok, false);
 const template = createInspectionTemplate(report.bundle, {facility, name: 'Technik', points: 'Pumpe\nFilter', intervalUnit: 'day', intervalCount: 1}, manager, now);
 assert.equal(createInspectionTemplate(report.bundle, {facility, name: 'Eigen', points: 'Tür', intervalUnit: 'day', intervalCount: 1}, technician, now).ok, false);
 const assigned = assignInspection(template.bundle, template.template.id, {assignedTo: technician.userId, assignedName: 'Timo', dueAt: '2026-11-09T08:00:00.000Z'}, manager, now);
 const recorded = recordInspection(assigned.bundle, assigned.run.id, assigned.run.points.map(point => ({id: point.id, mark: 'ok', note: ''})), technician, now);
 assert.equal(recorded.ok, true);
 const asset = createAsset(recorded.bundle, {facility, name: 'Pumpe', location: 'Keller', intervalUnit: 'month', intervalCount: 1, anchorAt: '2026-01-31T08:00:00.000Z', responsibleUserId: technician.userId, responsibleName: 'Timo'}, manager, now);
 assert.equal(createAsset(recorded.bundle, {facility, name: 'Eigen', location: 'Hof', intervalUnit: 'month', intervalCount: 1, anchorAt: now, responsibleUserId: technician.userId}, technician, now).ok, false);
 assert.equal(completeMaintenance(asset.bundle, asset.asset.id, 'Lager gefettet', technician, now).ok, true);
 const request = createProcurement(asset.bundle, {facility, title: 'Dichtung', quantity: '1', unit: 'Stück', reason: 'Pumpe tropft', urgency: 'normal'}, technician, now);
 assert.equal(request.ok, true);
 assert.equal(reviewProcurement(request.bundle, request.request.id, 'approved', 'Bestellt', technician, now).ok, false);
});

function stranger() {
 return {userId: 'employee-9', name: 'Fremd', memberships: [membership('employee', other)]};
}
