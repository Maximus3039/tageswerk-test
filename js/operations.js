import {facilityVisibleToMember, membershipCoversFacility} from './permissions.js';
import {nextReadingAt, readingScheduleStatus} from './meters.js';

const marks = new Set(['ok', 'notable', 'unchecked']);
const urgencies = new Set(['low', 'normal', 'high', 'critical']);
const decisions = new Set(['approved', 'rejected']);

export function emptyOperations() {
 return {
  reports: [],
  templates: [],
  runs: [],
  assets: [],
  requests: [],
  preparedDefects: [],
  temperaturePoints: [],
  temperatureReadings: [],
  temperatureAlerts: [],
  materials: [],
  movements: []
 };
}

function copy(bundle) {
 const source = bundle || emptyOperations();
 return {
  reports: [...source.reports],
  templates: [...source.templates],
  runs: [...source.runs],
  assets: [...source.assets],
  requests: [...source.requests],
  preparedDefects: [...source.preparedDefects],
  temperaturePoints: [...(source.temperaturePoints || [])],
  temperatureReadings: [...(source.temperatureReadings || [])],
  temperatureAlerts: [...(source.temperatureAlerts || [])],
  materials: [...(source.materials || [])],
  movements: [...(source.movements || [])]
 };
}

function newId() {
 if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
 return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function canUse(facility, actor) {
 return !!actor?.userId && facilityVisibleToMember(facility, actor.memberships);
}

function canManage(facility, actor) {
 return !!actor?.userId && (actor.memberships || []).some(membership => membershipCoversFacility(facility, membership, false));
}

function text(value, max) {
 const trimmed = String(value ?? '').trim();
 if (trimmed.length > max) return null;
 return trimmed;
}

function sameFacility(defect, facilityId) {
 return !!defect?.id && defect.facility_id === facilityId;
}

export function reportDraftError(draft) {
 if (!draft?.facility?.id) return 'Bitte einen Betrieb auswählen.';
 if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.reportDate || '')) return 'Bitte ein Datum wählen.';
 const incidents = text(draft.incidents, 4000);
 const handover = text(draft.handover, 4000);
 if (incidents === null || handover === null) return 'Der Text darf höchstens 4000 Zeichen haben.';
 if (!incidents && !handover) return 'Bitte Vorkommnisse oder einen Hinweis für die nächste Schicht eintragen.';
 return '';
}

export function createDailyReport(bundle, draft, actor, now) {
 const error = reportDraftError(draft);
 if (error) return {ok: false, error, bundle};
 if (!canUse(draft.facility, actor)) return {ok: false, error: 'Keine Berechtigung für diesen Betrieb.', bundle};
 const exists = (bundle?.reports || []).some(report => report.facilityId === draft.facility.id && report.reportDate === draft.reportDate);
 if (exists) return {ok: false, error: 'Für diesen Tag liegt bereits ein Bericht vor. Änderungen werden als Nachtrag gespeichert.', bundle};
 const report = {
  id: newId(),
  facilityId: draft.facility.id,
  facilityName: draft.facility.name || 'Betrieb',
  organizationId: draft.facility.organization_id,
  reportDate: draft.reportDate,
  incidents: text(draft.incidents, 4000),
  handover: text(draft.handover, 4000),
  authorId: actor.userId,
  authorName: actor.name || 'Mitarbeiter',
  createdAt: now,
  defectIds: [],
  revisions: []
 };
 const next = copy(bundle);
 next.reports = [report, ...next.reports];
 return {ok: true, bundle: next, report};
}

export function reviseDailyReport(bundle, reportId, draft, actor, now) {
 const report = (bundle?.reports || []).find(item => item.id === reportId);
 if (!report) return {ok: false, error: 'Der Bericht wurde nicht gefunden.', bundle};
 const facility = {id: report.facilityId, organization_id: report.organizationId, name: report.facilityName};
 if (!canUse(facility, actor)) return {ok: false, error: 'Keine Berechtigung für diesen Betrieb.', bundle};
 const error = reportDraftError({...draft, facility, reportDate: report.reportDate});
 if (error) return {ok: false, error, bundle};
 const changeNote = text(draft.changeNote, 2000);
 if (!changeNote || changeNote.length < 3) return {ok: false, error: 'Bitte den Grund der Änderung mit mindestens 3 Zeichen eintragen.', bundle};
 const revision = {
  id: newId(),
  editorId: actor.userId,
  editorName: actor.name || 'Mitarbeiter',
  editedAt: now,
  changeNote,
  incidents: report.incidents,
  handover: report.handover
 };
 const updated = {...report, incidents: text(draft.incidents, 4000), handover: text(draft.handover, 4000), revisions: [revision, ...report.revisions]};
 const next = copy(bundle);
 next.reports = next.reports.map(item => item.id === report.id ? updated : item);
 return {ok: true, bundle: next, report: updated};
}

export function linkReportDefect(bundle, reportId, defect) {
 const report = (bundle?.reports || []).find(item => item.id === reportId);
 if (!report) return {ok: false, error: 'Der Bericht wurde nicht gefunden.', bundle};
 if (!sameFacility(defect, report.facilityId)) return {ok: false, error: 'Der Mangel gehört zu einem anderen Betrieb.', bundle};
 if (report.defectIds.includes(defect.id)) return {ok: true, bundle, report};
 const updated = {...report, defectIds: [...report.defectIds, defect.id]};
 const next = copy(bundle);
 next.reports = next.reports.map(item => item.id === report.id ? updated : item);
 return {ok: true, bundle: next, report: updated};
}

export function filterDailyReports(reports, filter) {
 return (reports || []).filter(report => {
  if (filter?.facilityId && report.facilityId !== filter.facilityId) return false;
  if (filter?.date && report.reportDate !== filter.date) return false;
  return true;
 });
}

export function dailyReportEmail(report, facilityName) {
 const name = facilityName || report?.facilityName || 'Betrieb';
 return {
  send: false,
  subject: `Tagesbericht ${report.reportDate} · ${name}`,
  body: `Besondere Vorkommnisse:\n${report.incidents || 'Keine'}\n\nHinweis für die nächste Schicht:\n${report.handover || 'Keiner'}`
 };
}

export function inspectionDraftError(draft) {
 if (!draft?.facility?.id) return 'Bitte einen Betrieb auswählen.';
 const name = text(draft.name, 200);
 if (!name) return 'Bitte eine Bezeichnung für den Kontrollgang eintragen.';
 const points = String(draft.points || '').split('\n').map(line => line.trim()).filter(Boolean);
 if (!points.length) return 'Bitte mindestens einen Prüfpunkt eintragen.';
 if (points.length > 30 || points.some(point => point.length > 200)) return 'Ein Kontrollgang hat höchstens 30 Prüfpunkte mit je 200 Zeichen.';
 if (!['day', 'week', 'month'].includes(draft.intervalUnit)) return 'Bitte ein Wiederholungsintervall wählen.';
 const count = Number(draft.intervalCount);
 if (!Number.isInteger(count) || count < 1 || count > 365) return 'Bitte eine Intervallanzahl von 1 bis 365 eingeben.';
 return '';
}

export function createInspectionTemplate(bundle, draft, actor, now) {
 const error = inspectionDraftError(draft);
 if (error) return {ok: false, error, bundle};
 if (!canManage(draft.facility, actor)) return {ok: false, error: 'Kontrollgänge legt die Betriebsleitung oder Geschäftsführung an.', bundle};
 const template = {
  id: newId(),
  facilityId: draft.facility.id,
  facilityName: draft.facility.name || 'Betrieb',
  organizationId: draft.facility.organization_id,
  name: text(draft.name, 200),
  intervalCount: Number(draft.intervalCount),
  intervalUnit: draft.intervalUnit,
  points: String(draft.points).split('\n').map(line => line.trim()).filter(Boolean).map(label => ({id: newId(), label})),
  createdBy: actor.userId,
  createdAt: now
 };
 const next = copy(bundle);
 next.templates = [template, ...next.templates];
 return {ok: true, bundle: next, template};
}

export function assignInspection(bundle, templateId, draft, actor, now) {
 const template = (bundle?.templates || []).find(item => item.id === templateId);
 if (!template) return {ok: false, error: 'Die Checkliste wurde nicht gefunden.', bundle};
 const facility = {id: template.facilityId, organization_id: template.organizationId, name: template.facilityName};
 if (!canManage(facility, actor)) return {ok: false, error: 'Zuweisen darf die Betriebsleitung oder Geschäftsführung.', bundle};
 if (!draft?.assignedTo) return {ok: false, error: 'Bitte eine Person für den Kontrollgang auswählen.', bundle};
 if (!draft.dueAt || Number.isNaN(new Date(draft.dueAt).getTime())) return {ok: false, error: 'Bitte Datum und Uhrzeit der nächsten Kontrolle eingeben.', bundle};
 const run = {
  id: newId(),
  templateId: template.id,
  name: template.name,
  facilityId: template.facilityId,
  facilityName: template.facilityName,
  organizationId: template.organizationId,
  assignedTo: draft.assignedTo,
  assignedName: draft.assignedName || 'Mitarbeiter',
  dueAt: new Date(draft.dueAt).toISOString(),
  status: 'open',
  performedBy: null,
  performedName: '',
  performedAt: null,
  points: template.points.map(point => ({id: point.id, label: point.label, mark: 'unchecked', note: '', defectId: null})),
  createdAt: now
 };
 const next = copy(bundle);
 next.runs = [run, ...next.runs];
 return {ok: true, bundle: next, run};
}

export function recordInspection(bundle, runId, results, actor, now) {
 const run = (bundle?.runs || []).find(item => item.id === runId);
 if (!run) return {ok: false, error: 'Der Kontrollgang wurde nicht gefunden.', bundle};
 const facility = {id: run.facilityId, organization_id: run.organizationId, name: run.facilityName};
 if (!canUse(facility, actor)) return {ok: false, error: 'Keine Berechtigung für diesen Betrieb.', bundle};
 if (run.assignedTo !== actor.userId && !canManage(facility, actor)) return {ok: false, error: 'Dieser Kontrollgang ist einer anderen Person zugewiesen.', bundle};
 if (run.status === 'completed') return {ok: false, error: 'Dieser Kontrollgang ist bereits abgeschlossen.', bundle};
 const incoming = new Map((results || []).map(result => [result.id, result]));
 if (run.points.some(point => !marks.has(incoming.get(point.id)?.mark))) return {ok: false, error: 'Bitte jeden Prüfpunkt als in Ordnung, auffällig oder nicht geprüft markieren.', bundle};
 if (run.points.some(point => text(incoming.get(point.id)?.note, 2000) === null)) return {ok: false, error: 'Eine Bemerkung darf höchstens 2000 Zeichen haben.', bundle};
 const points = run.points.map(point => {
  const result = incoming.get(point.id);
  return {...point, mark: result.mark, note: text(result.note, 2000)};
 });
 const updated = {...run, points, status: 'completed', performedBy: actor.userId, performedName: actor.name || 'Mitarbeiter', performedAt: now};
 const next = copy(bundle);
 next.runs = next.runs.map(item => item.id === run.id ? updated : item);
 return {ok: true, bundle: next, run: updated, notable: points.filter(point => point.mark === 'notable')};
}

export function inspectionDefectDraft(run, point) {
 if (!run || point?.mark !== 'notable') return {ok: false, error: 'Nur eine Auffälligkeit kann ein Mangel werden.'};
 return {
  ok: true,
  defect: {
   facility_id: run.facilityId,
   organization_id: run.organizationId,
   title: `${run.name}: ${point.label}`,
   description: point.note || 'Bei der Kontrolle aufgefallen.',
   priority: 'high',
   source: 'inspection',
   sourceId: run.id,
   pointId: point.id
  }
 };
}

export function rememberPreparedDefect(bundle, runId, pointId, defect) {
 const run = (bundle?.runs || []).find(item => item.id === runId);
 if (!run || !sameFacility(defect, run.facilityId)) return {ok: false, error: 'Der Mangel gehört zu einem anderen Betrieb.', bundle};
 const points = run.points.map(point => point.id === pointId ? {...point, defectId: defect.id} : point);
 const updated = {...run, points};
 const next = copy(bundle);
 next.runs = next.runs.map(item => item.id === run.id ? updated : item);
 if (!next.preparedDefects.some(item => item.id === defect.id)) next.preparedDefects = [defect, ...next.preparedDefects];
 return {ok: true, bundle: next, run: updated};
}

export function inspectionOverdue(run, now) {
 return run?.status !== 'completed' && readingScheduleStatus(run?.dueAt, now) === 'overdue';
}

export function assetDraftError(draft) {
 if (!draft?.facility?.id) return 'Bitte einen Betrieb auswählen.';
 const name = text(draft.name, 200);
 if (!name) return 'Bitte eine Bezeichnung für die Anlage eintragen.';
 if (text(draft.location, 200) === null) return 'Der Standort darf höchstens 200 Zeichen haben.';
 if (!['day', 'week', 'month'].includes(draft.intervalUnit)) return 'Bitte ein Wartungsintervall wählen.';
 const count = Number(draft.intervalCount);
 if (!Number.isInteger(count) || count < 1 || count > 365) return 'Bitte eine Intervallanzahl von 1 bis 365 eingeben.';
 if (!draft.anchorAt || Number.isNaN(new Date(draft.anchorAt).getTime())) return 'Bitte das Datum der letzten oder ersten Wartung eingeben.';
 return '';
}

export function createAsset(bundle, draft, actor, now) {
 const error = assetDraftError(draft);
 if (error) return {ok: false, error, bundle};
 if (!canManage(draft.facility, actor)) return {ok: false, error: 'Anlagen erfasst die Betriebsleitung oder Geschäftsführung.', bundle};
 const asset = {
  id: newId(),
  facilityId: draft.facility.id,
  facilityName: draft.facility.name || 'Betrieb',
  organizationId: draft.facility.organization_id,
  name: text(draft.name, 200),
  location: text(draft.location, 200),
  intervalCount: Number(draft.intervalCount),
  intervalUnit: draft.intervalUnit,
  responsibleUserId: draft.responsibleUserId || null,
  responsibleName: draft.responsibleName || '',
  anchorAt: new Date(draft.anchorAt).toISOString(),
  logs: [],
  defectIds: [],
  createdAt: now
 };
 const next = copy(bundle);
 next.assets = [asset, ...next.assets];
 return {ok: true, bundle: next, asset};
}

export function assetNextDue(asset) {
 const last = asset?.logs?.[0]?.completedAt || asset?.anchorAt;
 return nextReadingAt(last, asset?.intervalUnit, asset?.intervalCount);
}

export function assetOverdue(asset, now) {
 const due = assetNextDue(asset);
 return !!due && readingScheduleStatus(due, now) === 'overdue';
}

export function completeMaintenance(bundle, assetId, note, actor, now) {
 const asset = (bundle?.assets || []).find(item => item.id === assetId);
 if (!asset) return {ok: false, error: 'Die Anlage wurde nicht gefunden.', bundle};
 const facility = {id: asset.facilityId, organization_id: asset.organizationId, name: asset.facilityName};
 if (!canUse(facility, actor)) return {ok: false, error: 'Keine Berechtigung für diesen Betrieb.', bundle};
 if (asset.responsibleUserId !== actor.userId && !canManage(facility, actor)) return {ok: false, error: 'Diese Wartung ist einer anderen Person zugeordnet.', bundle};
 const doneNote = text(note, 2000);
 if (!doneNote) return {ok: false, error: 'Bitte eintragen, was gewartet wurde.', bundle};
 const updated = {...asset, logs: [{id: newId(), completedAt: now, completedBy: actor.userId, completedName: actor.name || 'Mitarbeiter', note: doneNote}, ...asset.logs]};
 const next = copy(bundle);
 next.assets = next.assets.map(item => item.id === asset.id ? updated : item);
 return {ok: true, bundle: next, asset: updated};
}

export function linkAssetDefect(bundle, assetId, defect) {
 const asset = (bundle?.assets || []).find(item => item.id === assetId);
 if (!asset) return {ok: false, error: 'Die Anlage wurde nicht gefunden.', bundle};
 if (!sameFacility(defect, asset.facilityId)) return {ok: false, error: 'Der Mangel gehört zu einem anderen Betrieb.', bundle};
 if (asset.defectIds.includes(defect.id)) return {ok: true, bundle, asset};
 const updated = {...asset, defectIds: [...asset.defectIds, defect.id]};
 const next = copy(bundle);
 next.assets = next.assets.map(item => item.id === asset.id ? updated : item);
 return {ok: true, bundle: next, asset: updated};
}

export function procurementDraftError(draft) {
 if (!draft?.facility?.id) return 'Bitte einen Betrieb auswählen.';
 const title = text(draft.title, 180);
 if (!title) return 'Bitte eine Bezeichnung eintragen.';
 const quantity = String(draft.quantity ?? '').trim().replace(',', '.');
 if (!/^\d+(\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0) return 'Bitte eine Menge größer als 0 eingeben.';
 const reason = text(draft.reason, 2000);
 if (!reason || reason.length < 3) return 'Bitte eine Begründung mit mindestens 3 Zeichen eintragen.';
 if (!urgencies.has(draft.urgency)) return 'Bitte eine Dringlichkeit wählen.';
 return '';
}

export function createProcurement(bundle, draft, actor, now) {
 const error = procurementDraftError(draft);
 if (error) return {ok: false, error, bundle};
 if (!canUse(draft.facility, actor)) return {ok: false, error: 'Keine Berechtigung für diesen Betrieb.', bundle};
 if (draft.defect && !sameFacility(draft.defect, draft.facility.id)) return {ok: false, error: 'Der Mangel gehört zu einem anderen Betrieb.', bundle};
 if (draft.materialId) {
  const material = (bundle?.materials || []).find(item => item.id === draft.materialId);
  if (!material || material.facilityId !== draft.facility.id) return {ok: false, error: 'Das Material gehört zu einem anderen Betrieb.', bundle};
  const open = (bundle?.requests || []).some(item => item.materialId === draft.materialId && item.facilityId === draft.facility.id && item.status === 'submitted');
  if (open) return {ok: false, error: 'Für dieses Material liegt bereits eine offene Beschaffung vor.', bundle};
 }
 const request = {
  id: newId(),
  facilityId: draft.facility.id,
  facilityName: draft.facility.name || 'Betrieb',
  organizationId: draft.facility.organization_id,
  title: text(draft.title, 180),
  quantity: String(draft.quantity).trim().replace(',', '.'),
  unit: text(draft.unit, 40) || 'Stück',
  reason: text(draft.reason, 2000),
  urgency: draft.urgency,
  status: 'submitted',
  defectId: draft.defect?.id || null,
  materialId: draft.materialId || null,
  requestedBy: actor.userId,
  requestedName: actor.name || 'Mitarbeiter',
  requestedAt: now,
  reviewedBy: null,
  reviewedName: '',
  reviewedAt: null,
  reviewNote: ''
 };
 const next = copy(bundle);
 next.requests = [request, ...next.requests];
 return {ok: true, bundle: next, request};
}

export function reviewProcurement(bundle, requestId, decision, note, actor, now) {
 const request = (bundle?.requests || []).find(item => item.id === requestId);
 if (!request) return {ok: false, error: 'Die Anfrage wurde nicht gefunden.', bundle};
 const facility = {id: request.facilityId, organization_id: request.organizationId, name: request.facilityName};
 if (!canManage(facility, actor)) return {ok: false, error: 'Freigeben darf die Betriebsleitung oder Geschäftsführung.', bundle};
 if (request.status !== 'submitted') return {ok: false, error: 'Diese Anfrage wurde bereits entschieden.', bundle};
 if (!decisions.has(decision)) return {ok: false, error: 'Bitte die Anfrage genehmigen oder ablehnen.', bundle};
 const reviewNote = text(note, 2000);
 if (!reviewNote || reviewNote.length < 3) return {ok: false, error: 'Bitte eine Begründung mit mindestens 3 Zeichen eintragen.', bundle};
 const updated = {...request, status: decision, reviewedBy: actor.userId, reviewedName: actor.name || 'Leitung', reviewedAt: now, reviewNote};
 const next = copy(bundle);
 next.requests = next.requests.map(item => item.id === request.id ? updated : item);
 return {ok: true, bundle: next, request: updated};
}

export function berlinDay(value) {
 const date = new Date(value);
 if (Number.isNaN(date.getTime())) return '';
 return new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Berlin'}).format(date);
}

function addCalendarDays(day, count) {
 const [year, month, date] = day.split('-').map(Number);
 return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10);
}

export function temperatureCheckDue(point, readings, now) {
 if (!point || point.active === false) return false;
 const latest = (readings || []).filter(reading => reading.pointId === point.id).sort((left, right) => String(right.measuredAt).localeCompare(String(left.measuredAt)))[0];
 if (!latest) return true;
 const unit = point.intervalUnit || 'day';
 const count = Number(point.intervalCount) || 1;
 if (unit === 'day') {
  const today = berlinDay(now);
  const measured = berlinDay(latest.measuredAt);
  if (!today || !measured) return true;
  return addCalendarDays(measured, count) <= today;
 }
 const due = nextReadingAt(latest.measuredAt, unit, count);
 if (!due) return true;
 return due.getTime() <= new Date(now).getTime();
}

export function materialStock(movements, materialId) {
 let total = 0;
 for (const movement of movements || []) {
  if (movement.materialId !== materialId) continue;
  const amount = Number(movement.quantity);
  if (!Number.isFinite(amount)) continue;
  total += movement.direction === 'out' ? -amount : amount;
 }
 return Math.round(total * 1000) / 1000;
}

export function operationMetrics(bundle, facilityIds, today, now) {
 const allowed = new Set(facilityIds || []);
 const inScope = item => allowed.has(item.facilityId);
 return {
  reportsToday: (bundle?.reports || []).filter(report => inScope(report) && report.reportDate === today).length,
  inspectionsOverdue: (bundle?.runs || []).filter(run => inScope(run) && inspectionOverdue(run, now)).length,
  maintenanceOverdue: (bundle?.assets || []).filter(asset => inScope(asset) && assetOverdue(asset, now)).length,
  procurementOpen: (bundle?.requests || []).filter(request => inScope(request) && request.status === 'submitted').length,
  temperatureOpen: (bundle?.temperatureAlerts || []).filter(alert => inScope(alert) && alert.status === 'open').length,
  temperatureMissing: (bundle?.temperaturePoints || []).filter(point => inScope(point) && temperatureCheckDue(point, bundle?.temperatureReadings, now)).length,
  stockLow: (bundle?.materials || []).filter(material => inScope(material) && materialStock(bundle?.movements, material.id) < Number(material.minimum)).length
 };
}
