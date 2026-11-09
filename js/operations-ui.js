import {supabase} from './supabase.js';
import {paintMobile} from './mobile.js';
import {el, show} from './utils.js';
import {state} from './state.js';
import {isManager} from './permissions.js';
import {priorityNames, intervalNames} from './labels.js';
import {
 facilityNotices,
 materialBelowMinimum,
 missingTemperaturePoints,
 procurementFromStock,
 stockOf,
 temperatureDefectDraft
} from './operations-controls.js';
import {
 assetNextDue,
 assetOverdue,
 dailyReportEmail,
 emptyOperations,
 filterDailyReports,
 inspectionOverdue,
 operationMetrics
} from './operations.js';
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
 saveMaterial,
 saveMaterialMovement,
 saveProcurementRequest,
 saveProcurementReview,
 saveReportDefect,
 saveTemperatureAcknowledgement,
 saveTemperaturePoint,
 saveTemperatureReading,
 supabaseOperationDb
} from './operations-store.js';

const markNames = {ok: 'In Ordnung', notable: 'Auffällig', unchecked: 'Nicht geprüft'};
const statusNames = {submitted: 'Gemeldet', approved: 'Genehmigt', rejected: 'Abgelehnt', open: 'Offen', completed: 'Abgeschlossen'};
let installed = false;
let controlsInstalled = false;
let section = 'reports';
let loading = null;
let pendingFacilityId = '';
let saving = false;

function actor() {
 const user = state.currentUser;
 const profile = state.staff.find(member => member.user_id === user?.id);
 return {userId: user?.id, name: profile?.name || 'Mitarbeiter', memberships: state.myMemberships};
}

function facility() {
 return state.accessibleFacilities.find(item => item.id === el('operations-facility')?.value) || null;
}

function defectsFor(facilityId) {
 return (state.cachedDefects || []).filter(defect => defect.facility_id === facilityId);
}

function say(kind, message) {
 const node = el('operations-message');
 if (!node) return;
 node.className = kind;
 node.textContent = message;
}

function database() {
 return supabaseOperationDb(supabase);
}

function context() {
 const names = {};
 for (const member of state.staff || []) names[member.user_id] = member.name;
 const current = actor();
 if (current.userId) names[current.userId] = names[current.userId] || current.name;
 return {facilities: state.accessibleFacilities, names};
}

async function commit(task) {
 if (saving) return null;
 saving = true;
 document.body.dataset.saving = '1';
 let result;
 try {
  result = await task();
 } catch (error) {
  say('error', 'Die Speicherung wurde nicht bestätigt.');
  return null;
 } finally {
  saving = false;
  delete document.body.dataset.saving;
 }
 if (!result?.ok || !result.id) {
  say('error', result?.error || 'Die Speicherung wurde nicht bestätigt.');
  return null;
 }
 state.operationPreview = result.bundle;
 say(result.warning ? 'error' : 'ok', result.warning ? `Gespeichert. ${result.warning}` : '✓ In der Datenbank gespeichert.');
 renderPanel();
 refreshOperationMetrics();
 return result;
}

async function refreshFromDatabase(announce) {
 const loaded = await loadOperations(database(), actor(), context());
 installed = loaded.installed === true;
 controlsInstalled = loaded.controlsInstalled === true;
 state.controlsInstalled = controlsInstalled;
 if (!loaded.ok) {
  if (!state.operationPreview) state.operationPreview = emptyOperations();
  if (announce) say('error', loaded.error);
  return loaded;
 }
 state.operationPreview = loaded.bundle;
 return loaded;
}

function bundle() {
 return state.operationPreview || emptyOperations();
}

function today() {
 return new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Berlin'}).format(new Date());
}

function paintOperationMetrics() {
 if (!el('metric-reports')) return;
 const selected = el('dashboard-facility')?.value;
 const ids = state.accessibleFacilities.filter(item => !selected || selected === 'all' || item.id === selected).map(item => item.id);
 const metrics = operationMetrics(bundle(), ids, today(), new Date().toISOString());
 el('metric-reports').textContent = String(metrics.reportsToday);
 el('metric-inspections').textContent = String(metrics.inspectionsOverdue);
 el('metric-maintenance').textContent = String(metrics.maintenanceOverdue);
 el('metric-procurement').textContent = String(metrics.procurementOpen);
 if (el('metric-temperature')) el('metric-temperature').textContent = String(metrics.temperatureOpen);
 if (el('metric-temperature-missing')) el('metric-temperature-missing').textContent = String(metrics.temperatureMissing);
 if (el('metric-stock')) el('metric-stock').textContent = String(metrics.stockLow);
 paintNotices(ids);
 paintMobile();
}

function paintNotices(facilityIds) {
 const host = el('dash-notices');
 if (!host) return;
 const notices = facilityNotices(bundle(), state.cachedDefects, {
  facilityIds,
  now: new Date().toISOString(),
  actor: actor()
 });
 host.replaceChildren();
 if (!notices.length) {
  const empty = document.createElement('p');
  empty.className = 'muted';
  empty.textContent = 'Keine offenen Hinweise für die ausgewählten Betriebe.';
  host.append(empty);
  return;
 }
 for (const notice of notices) {
  const row = document.createElement('div');
  row.className = notice.warn ? 'dash-row is-overdue' : 'dash-row';
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  const title = document.createElement('strong');
  const facilityName = state.accessibleFacilities.find(item => item.id === notice.facilityId)?.name || 'Betrieb';
  title.textContent = notice.title;
  const detail = document.createElement('small');
  detail.textContent = `${facilityName} · ${notice.detail}`;
  row.append(title, detail);
  const open = () => showNotice(notice);
  row.addEventListener('click', open);
  row.addEventListener('keydown', event => { if (event.key === 'Enter') open(); });
  host.append(row);
 }
}

function showNotice(notice) {
 if (String(notice.kind).startsWith('defect')) {
  document.querySelector('[data-view="defects"]')?.click();
  return;
 }
 const sections = {
  'temperature-warning': 'temperature',
  'temperature-missing': 'temperature',
  'stock-low': 'stock',
  'procurement-open': 'procurement',
  'inspection-overdue': 'inspections',
  'maintenance-overdue': 'maintenance'
 };
 section = sections[notice.kind] || 'notices';
 pendingFacilityId = notice.facilityId;
 for (const tab of document.querySelectorAll('[data-operation]')) tab.classList.toggle('active', tab.dataset.operation === section);
 const card = el('operations-card');
 if (card?.classList.contains('hidden')) {
  el('open-operations')?.click();
  return;
 }
 const select = el('operations-facility');
 if (select && [...select.options].some(option => option.value === notice.facilityId)) select.value = notice.facilityId;
 renderPanel('');
}

export function refreshOperationMetrics() {
 if (!el('metric-reports')) return;
 if (state.operationPreview) {
  paintOperationMetrics();
  return;
 }
 if (!loading) loading = refreshFromDatabase(false).finally(() => {
  loading = null;
  paintOperationMetrics();
 });
}

function button(label, className, onClick) {
 const node = document.createElement('button');
 node.type = 'button';
 node.className = className || '';
 node.textContent = label;
 node.addEventListener('click', async () => {
  if (node.disabled || saving) return;
  node.disabled = true;
  try { await onClick(); }
  finally { node.disabled = false; }
 });
 return node;
}

function labeled(text, control) {
 const node = document.createElement('label');
 node.textContent = text;
 node.append(control);
 return node;
}

function berlinLocal(date = new Date()) {
 const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(date);
 const part = type => parts.find(item => item.type === type)?.value || '00';
 return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

function input(value) {
 const node = document.createElement('input');
 node.autocomplete = 'off';
 if (value) node.value = value;
 return node;
}

function area(value) {
 const node = document.createElement('textarea');
 node.value = value || '';
 return node;
}

function select(options, value) {
 const node = document.createElement('select');
 for (const option of options) {
  const item = document.createElement('option');
  item.value = option.value;
  item.textContent = option.label;
  node.append(item);
 }
 if (value) node.value = value;
 return node;
}

function item(title, lines, overdue) {
 const node = document.createElement('div');
 node.className = overdue ? 'item is-overdue' : 'item';
 const strong = document.createElement('strong');
 strong.textContent = title;
 node.append(strong);
 for (const line of lines) {
  const paragraph = document.createElement('p');
  paragraph.className = 'help';
  paragraph.textContent = line;
  node.append(paragraph);
 }
 return node;
}

function renderReports(host, current) {
 const data = bundle();
 const date = input(today());
 date.type = 'date';
 const incidents = area();
 incidents.placeholder = 'Was war heute besonders?';
 const handover = area();
 handover.placeholder = 'Was muss die nächste Schicht wissen?';
 const defect = select([{value: '', label: 'Keinen Mangel verknüpfen'}, ...defectsFor(current.id).map(row => ({value: row.id, label: row.title}))]);
 const save = button('Tagesbericht speichern', '', () => commit(async () => {
  const saved = await saveDailyReport(database(), bundle(), {facility: current, reportDate: date.value, incidents: incidents.value, handover: handover.value}, actor(), new Date().toISOString(), context());
  const chosen = defectsFor(current.id).find(row => row.id === defect.value);
  if (!saved.ok || !chosen) return saved;
  const linked = await saveReportDefect(database(), saved.bundle, saved.id, chosen, actor(), context());
  if (!linked.ok) return {...saved, warning: linked.error};
  return linked;
 }));
 host.append(labeled('Datum', date), labeled('Besondere Vorkommnisse', incidents), labeled('Hinweis für die nächste Schicht', handover), labeled('Vorhandenen Mangel verknüpfen', defect), save);
 const filterDate = input('');
 filterDate.type = 'date';
 const filter = button('An diesem Tag anzeigen', 'secondary', () => renderPanel(filterDate.value));
 host.append(labeled('Berichte filtern', filterDate), filter);
 for (const report of filterDailyReports(data.reports, {facilityId: current.id, date: host.dataset.filter || ''})) {
  const lines = [
   `${report.facilityName} · ${report.authorName} · ${new Date(report.createdAt).toLocaleString('de-DE')}`,
   `Vorkommnisse: ${report.incidents || 'Keine'}`,
   `Nächste Schicht: ${report.handover || 'Kein Hinweis'}`,
   report.defectIds.length ? `Verknüpfte Mängel: ${report.defectIds.length}` : 'Kein Mangel verknüpft.'
  ];
  for (const revision of report.revisions) lines.push(`Nachtrag ${new Date(revision.editedAt).toLocaleString('de-DE')} · ${revision.editorName}: ${revision.changeNote}`);
  const row = item(report.reportDate, lines, false);
  const note = input();
  note.placeholder = 'Grund der Änderung';
  const nextIncidents = area(report.incidents);
  const nextHandover = area(report.handover);
  row.append(labeled('Geänderte Vorkommnisse', nextIncidents), labeled('Geänderter Hinweis', nextHandover), labeled('Grund der Änderung', note));
  row.append(button('Nachtrag speichern', 'secondary', () => commit(() => saveDailyReportRevision(database(), bundle(), report.id, {incidents: nextIncidents.value, handover: nextHandover.value, changeNote: note.value}, actor(), new Date().toISOString(), context()))));
  row.append(button('E-Mail-Zusammenfassung anzeigen', 'secondary', () => {
   const mail = dailyReportEmail(report, report.facilityName);
   say('ok', `${mail.subject}\n${mail.body}\n\nDie E-Mail wird nicht versendet.`);
  }));
  host.append(row);
 }
}

function renderInspections(host, current) {
 const data = bundle();
 const manager = isManager(current);
 if (manager) {
  const name = input();
  const points = area();
  points.placeholder = 'Ein Prüfpunkt je Zeile';
  const unit = select(Object.entries(intervalNames).map(([value, label]) => ({value, label})), 'week');
  const count = input('1');
  count.type = 'number';
  count.inputMode = 'numeric';
  host.append(labeled('Bezeichnung des Kontrollgangs', name), labeled('Prüfpunkte', points), labeled('Wiederholung', unit), labeled('Intervallanzahl', count));
  host.append(button('Checkliste anlegen', '', () => commit(() => saveInspectionTemplate(database(), bundle(), {facility: current, name: name.value, points: points.value, intervalUnit: unit.value, intervalCount: count.value}, actor(), new Date().toISOString(), context()))));
  const template = select((data.templates || []).filter(item => item.facilityId === current.id).map(item => ({value: item.id, label: item.name})));
  const people = state.staff.filter(member => member.is_active === true && member.facility_id === current.id);
  const person = select(people.map(member => ({value: member.user_id, label: member.name})));
  const due = input();
  due.type = 'datetime-local';
  due.value = berlinLocal();
  host.append(labeled('Checkliste zuweisen', template), labeled('Mitarbeiter', person), labeled('Fällig am', due));
  host.append(button('Kontrollgang zuweisen', 'secondary', () => {
   const chosen = people.find(member => member.user_id === person.value);
   return commit(() => saveInspectionAssignment(database(), bundle(), template.value, {assignedTo: person.value, assignedName: chosen?.name, dueAt: due.value}, actor(), new Date().toISOString(), context()));
  }));
 }
 for (const run of data.runs.filter(item => item.facilityId === current.id)) {
  const overdue = inspectionOverdue(run, new Date().toISOString());
  const row = item(run.name, [`${run.assignedName} · fällig ${new Date(run.dueAt).toLocaleString('de-DE')}`, run.status === 'completed' ? `Ausgeführt von ${run.performedName} am ${new Date(run.performedAt).toLocaleString('de-DE')}` : 'Noch nicht ausgeführt.'], overdue);
  if (run.status !== 'completed') {
   const controls = [];
   for (const point of run.points) {
    const mark = select(Object.entries(markNames).map(([value, label]) => ({value, label})), 'unchecked');
    const note = input();
    note.placeholder = 'Bemerkung, falls nötig';
    row.append(labeled(point.label, mark), note);
    controls.push({id: point.id, mark, note});
   }
   row.append(button('Kontrolle abschließen', '', () => commit(() => saveInspectionResult(database(), bundle(), run.id, controls.map(control => ({id: control.id, mark: control.mark.value, note: control.note.value})), actor(), new Date().toISOString(), context()))));
  } else {
   for (const point of run.points.filter(item => item.mark === 'notable' && !item.defectId)) {
    row.append(button(`Auffälligkeit „${point.label}“ als Mangel speichern`, 'secondary', () => commit(() => saveInspectionDefect(database(), bundle(), run.id, point.id, actor(), context()))));
   }
  }
  host.append(row);
 }
}

function renderMaintenance(host, current) {
 const data = bundle();
 if (isManager(current)) {
  const name = input();
  const location = input();
  const unit = select(Object.entries(intervalNames).map(([value, label]) => ({value, label})), 'month');
  const count = input('1');
  count.type = 'number';
  count.inputMode = 'numeric';
  const anchor = input();
  anchor.type = 'date';
  anchor.value = berlinLocal().slice(0, 10);
  const people = state.staff.filter(member => member.is_active === true && (member.facility_id === current.id || member.facility_id == null));
  const person = select([{value: '', label: 'Noch niemand'}, ...people.map(member => ({value: member.user_id, label: member.name}))]);
  host.append(labeled('Anlage', name), labeled('Standort', location), labeled('Wartung alle', unit), labeled('Intervallanzahl', count), labeled('Letzte oder erste Wartung', anchor), labeled('Verantwortliche Person', person));
  host.append(button('Anlage speichern', '', () => {
   const chosen = people.find(member => member.user_id === person.value);
   return commit(() => saveAssetRecord(database(), bundle(), {facility: current, name: name.value, location: location.value, intervalUnit: unit.value, intervalCount: count.value, anchorAt: anchor.value, responsibleUserId: person.value || null, responsibleName: chosen?.name || ''}, actor(), new Date().toISOString(), context()));
  }));
 }
 for (const asset of data.assets.filter(item => item.facilityId === current.id)) {
  const due = assetNextDue(asset);
  const row = item(asset.name, [`${asset.location || 'Ohne Standort'} · ${asset.responsibleName || 'Keine zuständige Person'}`, due ? `Nächste Wartung ${due.toLocaleDateString('de-DE')}` : 'Kein Termin berechenbar.', asset.logs[0] ? `Zuletzt ${new Date(asset.logs[0].completedAt).toLocaleString('de-DE')} · ${asset.logs[0].completedName}: ${asset.logs[0].note}` : 'Noch keine erledigte Wartung.'], assetOverdue(asset, new Date().toISOString()));
  const note = input();
  note.placeholder = 'Was wurde gewartet?';
  const defect = select([{value: '', label: 'Keinen Mangel verknüpfen'}, ...defectsFor(current.id).map(row => ({value: row.id, label: row.title}))]);
  const materials = bundle().materials.filter(item => item.facilityId === current.id);
  const used = input();
  used.inputMode = 'decimal';
  const material = select(materials.map(item => ({value: item.id, label: item.name})));
  row.append(labeled('Wartung dokumentieren', note), button('Als erledigt speichern', 'secondary', () => commit(() => saveMaintenanceLog(database(), bundle(), asset.id, note.value, actor(), new Date().toISOString(), context()))));
  if (asset.logs[0] && materials.length) {
   row.append(labeled('Benötigtes Material', material), labeled('Menge', used));
   row.append(button('Material zur Wartung buchen', 'secondary', () => commit(() => saveMaterialMovement(database(), bundle(), {materialId: material.value, direction: 'out', quantity: used.value, note: `Wartung ${asset.name}`, maintenanceLogId: asset.logs[0].id}, actor(), new Date().toISOString(), context()))));
  }
  row.append(labeled('Vorhandenen Mangel verknüpfen', defect), button('Mangel mit Anlage verknüpfen', 'secondary', () => {
   const chosen = defectsFor(current.id).find(row => row.id === defect.value);
   return commit(() => saveAssetDefect(database(), bundle(), asset.id, chosen));
  }));
  host.append(row);
 }
}

function renderProcurement(host, current) {
 const data = bundle();
 const title = input();
 const quantity = input('1');
 quantity.inputMode = 'decimal';
 const unit = input('Stück');
 const reason = area();
 const urgency = select(Object.entries(priorityNames).map(([value, label]) => ({value, label})), 'normal');
 const defect = select([{value: '', label: 'Keinen Mangel verknüpfen'}, ...defectsFor(current.id).map(row => ({value: row.id, label: row.title}))]);
 host.append(labeled('Was wird gebraucht?', title), labeled('Menge', quantity), labeled('Einheit', unit), labeled('Begründung', reason), labeled('Dringlichkeit', urgency), labeled('Vorhandenen Mangel verknüpfen', defect));
 host.append(button('Bedarf melden', '', () => {
  const chosen = defectsFor(current.id).find(row => row.id === defect.value);
  return commit(() => saveProcurementRequest(database(), bundle(), {facility: current, title: title.value, quantity: quantity.value, unit: unit.value, reason: reason.value, urgency: urgency.value, defect: chosen || null}, actor(), new Date().toISOString(), context()));
 }));
 for (const request of data.requests.filter(item => item.facilityId === current.id)) {
  const lines = [`${request.quantity} ${request.unit} · ${priorityNames[request.urgency] || request.urgency}`, request.reason, `${request.requestedName} · ${new Date(request.requestedAt).toLocaleString('de-DE')}`, request.defectId ? 'Mit einem Mangel verknüpft.' : 'Ohne Mangel.'];
  if (request.reviewedAt) lines.push(`${statusNames[request.status]} · ${request.reviewedName} · ${new Date(request.reviewedAt).toLocaleString('de-DE')}: ${request.reviewNote}`);
  const row = item(`${request.title} · ${statusNames[request.status] || request.status}`, lines, request.urgency === 'critical' && request.status === 'submitted');
  if (request.status === 'submitted' && isManager(current)) {
   const note = input();
   note.placeholder = 'Begründung der Entscheidung';
   row.append(labeled('Entscheidung begründen', note));
   row.append(button('Genehmigen', '', () => commit(() => saveProcurementReview(database(), bundle(), request.id, 'approved', note.value, actor(), new Date().toISOString(), context()))));
   row.append(button('Ablehnen', 'secondary', () => commit(() => saveProcurementReview(database(), bundle(), request.id, 'rejected', note.value, actor(), new Date().toISOString(), context()))));
  }
  host.append(row);
 }
}

function amountLabel(value) {
 return new Intl.NumberFormat('de-DE', {maximumFractionDigits: 3}).format(Number(value));
}

function controlsNote(host) {
 if (controlsInstalled) return;
 const note = document.createElement('p');
 note.className = 'help';
 note.textContent = 'Temperatur und Bestand sind noch nicht in der Datenbank installiert. Es wurde nichts gespeichert.';
 host.append(note);
}

function renderTemperature(host, current) {
 controlsNote(host);
 const data = bundle();
 if (isManager(current)) {
  const name = input();
  const location = input();
  const minimum = input();
  const maximum = input();
  minimum.inputMode = 'decimal';
  maximum.inputMode = 'decimal';
  host.append(labeled('Messstelle', name), labeled('Standort', location), labeled('Mindestens °C', minimum), labeled('Höchstens °C', maximum));
  host.append(button('Messstelle speichern', '', () => commit(() => saveTemperaturePoint(database(), bundle(), {facility: current, name: name.value, location: location.value, minimum: minimum.value, maximum: maximum.value}, actor(), new Date().toISOString(), context()))));
 }
 const missing = new Set(missingTemperaturePoints(data, current.id, new Date().toISOString()).map(point => point.id));
 for (const point of data.temperaturePoints.filter(item => item.facilityId === current.id)) {
  const readings = data.temperatureReadings.filter(item => item.pointId === point.id);
  const row = item(point.name, [`${point.location} · zulässig ${amountLabel(point.minC)} bis ${amountLabel(point.maxC)} °C`, missing.has(point.id) ? 'Heute fehlt die Kontrolle.' : 'Heute ist eine Messung vorhanden.'], missing.has(point.id));
  const value = input();
  value.inputMode = 'decimal';
  const note = input();
  note.placeholder = 'Bemerkung, falls nötig';
  row.append(labeled('Gemessener Wert °C', value), labeled('Bemerkung', note));
  row.append(button('Messung speichern', 'secondary', () => commit(() => saveTemperatureReading(database(), bundle(), point.id, {value: value.value, note: note.value}, actor(), new Date().toISOString(), context()))));
  for (const reading of readings) {
   const line = document.createElement('p');
   line.className = 'help';
   line.textContent = `${new Date(reading.measuredAt).toLocaleString('de-DE')} · ${reading.recordedName}: ${amountLabel(reading.valueC)} °C${reading.note ? ` · ${reading.note}` : ''}`;
   row.append(line);
  }
  for (const alert of data.temperatureAlerts.filter(item => item.pointId === point.id)) {
   const line = document.createElement('p');
   line.className = 'help';
   line.textContent = alert.status === 'open'
    ? `Offene Warnung: ${amountLabel(alert.valueC)} °C`
    : `Quittiert ${new Date(alert.acknowledgedAt).toLocaleString('de-DE')} · ${alert.acknowledgedName}: ${alert.remark}`;
   row.append(line);
   if (alert.status !== 'open') continue;
   const remark = input();
   remark.placeholder = 'Bemerkung zur Quittierung';
   row.append(labeled('Quittierung', remark));
   row.append(button('Warnung quittieren', 'secondary', () => commit(() => saveTemperatureAcknowledgement(database(), bundle(), alert.id, remark.value, actor(), new Date().toISOString(), context()))));
   row.append(button('Mangel vorbereiten', 'secondary', () => {
    const draft = temperatureDefectDraft(bundle(), alert.id);
    if (!draft.ok) {
     say('error', draft.error);
     return;
    }
    if (el('defect-title')) el('defect-title').value = draft.defect.title;
    if (el('defect-desc')) el('defect-desc').value = draft.defect.description;
    if (el('defect-facility')) el('defect-facility').value = draft.defect.facility_id;
    if (el('defect-priority')) el('defect-priority').value = draft.defect.priority;
    say('ok', 'Der Mangel ist vorbereitet und noch nicht gespeichert.');
   }));
  }
  host.append(row);
 }
}

function renderStock(host, current) {
 controlsNote(host);
 const data = bundle();
 if (isManager(current)) {
  const name = input();
  const location = input();
  const unit = input('Stück');
  const minimum = input('0');
  minimum.inputMode = 'decimal';
  host.append(labeled('Material', name), labeled('Lagerort', location), labeled('Einheit', unit), labeled('Mindestbestand', minimum));
  host.append(button('Material speichern', '', () => commit(() => saveMaterial(database(), bundle(), {facility: current, name: name.value, location: location.value, unit: unit.value, minimum: minimum.value}, actor(), new Date().toISOString(), context()))));
 }
 for (const material of data.materials.filter(item => item.facilityId === current.id)) {
  const stock = stockOf(data, material.id);
  const low = materialBelowMinimum(data, material);
  const openRequest = data.requests.some(item => item.materialId === material.id && item.status === 'submitted');
  const row = item(material.name, [`${material.location} · Bestand ${amountLabel(stock)} ${material.unit}`, `Mindestbestand ${amountLabel(material.minimum)} ${material.unit}`, openRequest ? 'Offene Beschaffung vorhanden.' : 'Keine offene Beschaffung.'], low);
  const quantity = input();
  quantity.inputMode = 'decimal';
  const note = input();
  note.placeholder = 'Bemerkung zur Buchung';
  row.append(labeled('Menge', quantity), labeled('Bemerkung', note));
  const book = direction => commit(() => saveMaterialMovement(database(), bundle(), {materialId: material.id, direction, quantity: quantity.value, note: note.value}, actor(), new Date().toISOString(), context()));
  row.append(button('Zugang buchen', 'secondary', () => book('in')));
  row.append(button('Entnahme buchen', 'secondary', () => book('out')));
  if (low && !openRequest) {
   row.append(button('Beschaffung vorbereiten', '', () => {
    const prepared = procurementFromStock(bundle(), material.id, actor(), new Date().toISOString());
    if (!prepared.ok) {
     say('error', prepared.error);
     return null;
    }
    return commit(() => saveProcurementRequest(database(), bundle(), {
     facility: current,
     title: prepared.request.title,
     quantity: prepared.request.quantity,
     unit: prepared.request.unit,
     reason: prepared.request.reason,
     urgency: prepared.request.urgency,
     materialId: material.id
    }, actor(), new Date().toISOString(), context()));
   }));
  }
  for (const movement of data.movements.filter(item => item.materialId === material.id)) {
   const line = document.createElement('p');
   line.className = 'help';
   const direction = movement.direction === 'in' ? 'Zugang' : 'Entnahme';
   line.textContent = `${new Date(movement.recordedAt).toLocaleString('de-DE')} · ${movement.recordedName}: ${direction} ${amountLabel(movement.quantity)} ${material.unit}${movement.maintenanceLogId ? ' · für eine Wartung' : ''}${movement.note ? ` · ${movement.note}` : ''}`;
   row.append(line);
  }
  host.append(row);
 }
}

function renderNotices(host, current) {
 controlsNote(host);
 const notices = facilityNotices(bundle(), state.cachedDefects, {
  facilityIds: [current.id],
  now: new Date().toISOString(),
  actor: actor()
 });
 if (!notices.length) {
  const empty = document.createElement('p');
  empty.className = 'muted';
  empty.textContent = 'Keine offenen Hinweise für diesen Betrieb.';
  host.append(empty);
  return;
 }
 for (const notice of notices) host.append(item(notice.title, [notice.detail], notice.warn));
}

function renderPanel(filterDate) {
 const host = el('operations-panel');
 const current = facility();
 if (!host || !current) return;
 host.replaceChildren();
 if (filterDate !== undefined) host.dataset.filter = filterDate;
 const source = el('operations-source');
 source.textContent = installed
  ? 'Gespeichert wird in der Datenbank. Eine Meldung gilt erst, wenn die Datenbank den Datensatz bestätigt.'
  : 'Die Betriebsdatenbank ist noch nicht installiert. Eingaben bleiben im Formular und werden nicht als gespeichert geführt.';
 if (section === 'reports') renderReports(host, current);
 if (section === 'inspections') renderInspections(host, current);
 if (section === 'maintenance') renderMaintenance(host, current);
 if (section === 'procurement') renderProcurement(host, current);
 if (section === 'temperature') renderTemperature(host, current);
 if (section === 'stock') renderStock(host, current);
 if (section === 'notices') renderNotices(host, current);
}

function fillFacilities() {
 const select = el('operations-facility');
 if (!select) return;
 const previous = select.value;
 select.replaceChildren();
 for (const item of state.accessibleFacilities) {
  const option = document.createElement('option');
  option.value = item.id;
  option.textContent = item.name;
  select.append(option);
 }
 if (state.accessibleFacilities.some(item => item.id === pendingFacilityId)) select.value = pendingFacilityId;
 else if (state.accessibleFacilities.some(item => item.id === previous)) select.value = previous;
 pendingFacilityId = '';
}

export function focusNotice(notice) {
 showNotice(notice);
}

export function syncOperationFacility(facilityId) {
 const select = el('operations-facility');
 if (!select || !facilityId || facilityId === 'all') return;
 if (![...select.options].some(option => option.value === facilityId)) return;
 if (select.value === facilityId) return;
 select.value = facilityId;
 if (!el('operations-card')?.classList.contains('hidden')) renderPanel('');
}

export async function showOperationSection(name, facilityId) {
 const card = el('operations-card');
 show('operations-card', true);
 el('open-operations')?.classList.add('active');
 if (name) section = name;
 for (const tab of document.querySelectorAll('[data-operation]')) tab.classList.toggle('active', tab.dataset.operation === section);
 if (facilityId && facilityId !== 'all') pendingFacilityId = facilityId;
 if (!state.operationPreview) await openOperations();
 else {
  fillFacilities();
  renderPanel('');
 }
 card?.scrollIntoView({behavior: 'smooth', block: 'start'});
}

export async function openOperations() {
 fillFacilities();
 await refreshFromDatabase(true);
 renderPanel();
 paintOperationMetrics();
}

export function mountOperations() {
 const opener = el('open-operations');
 const card = el('operations-card');
 if (!opener || !card || opener.dataset.bound) return;
 opener.dataset.bound = '1';
 opener.addEventListener('click', async () => {
  const opening = card.classList.contains('hidden');
  show('operations-card', opening);
  opener.classList.toggle('active', opening);
  if (!opening) return;
  await openOperations();
  card.scrollIntoView({behavior: 'smooth', block: 'start'});
 });
 el('operations-facility')?.addEventListener('change', () => renderPanel(''));
 for (const tab of document.querySelectorAll('[data-operation]')) {
  tab.addEventListener('click', () => {
   section = tab.dataset.operation;
   for (const other of document.querySelectorAll('[data-operation]')) other.classList.toggle('active', other === tab);
   renderPanel('');
  });
 }
}
