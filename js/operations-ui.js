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
 temperatureDefectDraft,
 waterParameterName
} from './operations-controls.js';
import {
 assetNextDue,
 assetOverdue,
 dailyReportEmail,
 emptyOperations,
 filterDailyReports,
 inspectionOverdue,
 operationMetrics,
 waterCatalog,
 waterControlState,
 waterScheduleLabel
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
 saveTemperaturePointActive,
 saveTemperaturePointChange,
 saveTemperatureReading,
 saveWaterAcknowledgement,
 saveWaterCheck,
 saveWaterMeasure,
 saveWaterParameter,
 saveWaterParameterAdd,
 saveWaterPool,
 saveWaterPoolActive,
 saveWaterPoolChange,
 supabaseOperationDb
} from './operations-store.js';

const markNames = {ok: 'In Ordnung', notable: 'Auffällig', unchecked: 'Nicht geprüft'};
const statusNames = {submitted: 'Gemeldet', approved: 'Genehmigt', rejected: 'Abgelehnt', open: 'Offen', completed: 'Abgeschlossen'};
let installed = false;
let temperatureInstalled = false;
let materialsInstalled = false;
let waterInstalled = false;
let selectedWaterPoolId = '';
let followUpAlertId = '';
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
 temperatureInstalled = loaded.temperatureInstalled === true;
 materialsInstalled = loaded.materialsInstalled === true;
 waterInstalled = loaded.waterInstalled === true;
 state.temperatureInstalled = temperatureInstalled;
 state.materialsInstalled = materialsInstalled;
 state.waterInstalled = waterInstalled;
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
 if (el('metric-water')) el('metric-water').textContent = String(metrics.waterOpen);
 if (el('metric-water-missing')) el('metric-water-missing').textContent = String(metrics.waterMissing);
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
  'water-warning': 'water',
  'water-missing': 'water',
  'stock-low': 'stock',
  'procurement-open': 'procurement',
  'inspection-overdue': 'inspections',
  'maintenance-overdue': 'maintenance'
 };
 section = sections[notice.kind] || 'notices';
 pendingFacilityId = notice.facilityId;
 if (notice.poolId) selectedWaterPoolId = notice.poolId;
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

function missingNote(host, ready, message) {
 if (ready) return;
 const note = document.createElement('p');
 note.className = 'help';
 note.textContent = message;
 host.append(note);
}

function intervalLabel(point) {
 const count = Number(point.intervalCount) || 1;
 if ((point.intervalUnit || 'day') === 'day' && count === 1) return 'täglich';
 if (point.intervalUnit === 'week' && count === 1) return 'wöchentlich';
 if (point.intervalUnit === 'month' && count === 1) return 'monatlich';
 const unit = point.intervalUnit === 'week' ? 'Wochen' : point.intervalUnit === 'month' ? 'Monate' : 'Tage';
 return `alle ${count} ${unit}`;
}

function renderTemperature(host, current) {
 missingNote(host, temperatureInstalled, 'Temperaturkontrollen sind noch nicht in der Datenbank installiert. Es wurde nichts gespeichert.');
 const data = bundle();
 if (isManager(current)) {
  const name = input();
  const location = input();
  const minimum = input();
  const maximum = input();
  const unit = select(Object.entries(intervalNames).map(([value, label]) => ({value, label})), 'day');
  const count = input('1');
  minimum.inputMode = 'decimal';
  maximum.inputMode = 'decimal';
  count.inputMode = 'numeric';
  host.append(labeled('Messstelle', name), labeled('Bereich', location), labeled('Mindestens °C', minimum), labeled('Höchstens °C', maximum), labeled('Kontrollintervall', unit), labeled('Intervallanzahl', count));
  host.append(button('Messstelle speichern', '', () => commit(() => saveTemperaturePoint(database(), bundle(), {facility: current, name: name.value, location: location.value, minimum: minimum.value, maximum: maximum.value, intervalUnit: unit.value, intervalCount: count.value}, actor(), new Date().toISOString(), context()))));
 }
 const missing = new Set(missingTemperaturePoints(data, current.id, new Date().toISOString()).map(point => point.id));
 const points = data.temperaturePoints.filter(item => item.facilityId === current.id).sort((left, right) => Number(left.active === false) - Number(right.active === false) || left.name.localeCompare(right.name, 'de'));
 for (const point of points) {
  const readings = data.temperatureReadings.filter(item => item.pointId === point.id);
  const status = point.active === false ? 'Deaktiviert. Die bisherigen Messungen bleiben sichtbar.' : missing.has(point.id) ? 'Die Kontrolle ist fällig.' : 'Die nächste Kontrolle ist noch nicht fällig.';
  const row = item(`${point.name}${point.active === false ? ' · deaktiviert' : ''}`, [`${point.location} · zulässig ${amountLabel(point.minC)} bis ${amountLabel(point.maxC)} °C · ${intervalLabel(point)}`, status], missing.has(point.id));
  if (isManager(current)) {
   const actions = document.createElement('div');
   actions.className = 'point-actions';
   const editor = document.createElement('div');
   editor.className = 'point-editor hidden';
   const name = input(point.name);
   const location = input(point.location);
   const minimum = input(String(point.minC));
   const maximum = input(String(point.maxC));
   const unit = select(Object.entries(intervalNames).map(([value, label]) => ({value, label})), point.intervalUnit || 'day');
   const count = input(String(point.intervalCount || 1));
   minimum.inputMode = 'decimal';
   maximum.inputMode = 'decimal';
   count.inputMode = 'numeric';
   editor.append(labeled('Bezeichnung', name), labeled('Bereich', location), labeled('Mindestens °C', minimum), labeled('Höchstens °C', maximum), labeled('Kontrollintervall', unit), labeled('Intervallanzahl', count));
   editor.append(button('Änderungen speichern', '', () => commit(() => saveTemperaturePointChange(database(), bundle(), point.id, {name: name.value, location: location.value, minimum: minimum.value, maximum: maximum.value, intervalUnit: unit.value, intervalCount: count.value}, actor(), new Date().toISOString(), context()))));
   actions.append(button('Bearbeiten', 'secondary', () => { editor.classList.toggle('hidden'); }));
   actions.append(button(point.active === false ? 'Reaktivieren' : 'Deaktivieren', 'secondary', () => commit(() => saveTemperaturePointActive(database(), bundle(), point.id, point.active === false, actor(), new Date().toISOString(), context()))));
   row.append(actions, editor);
  }
  if (point.active !== false) {
   const value = input();
   value.inputMode = 'decimal';
   const note = input();
   note.placeholder = 'Bemerkung, falls nötig';
   row.append(labeled('Gemessener Wert °C', value), labeled('Bemerkung', note));
   row.append(button('Messung speichern', 'secondary', () => commit(() => saveTemperatureReading(database(), bundle(), point.id, {value: value.value, note: note.value}, actor(), new Date().toISOString(), context()))));
  }
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
    ? `Offene Warnung: ${amountLabel(alert.valueC)} °C außerhalb von ${amountLabel(alert.minC)} bis ${amountLabel(alert.maxC)} °C`
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

function choice(text, checked) {
 const node = document.createElement('label');
 node.className = 'choice';
 const box = document.createElement('input');
 box.type = 'checkbox';
 box.checked = checked === true;
 node.append(box, document.createTextNode(text));
 return {node, box};
}

function weekdayBoxes(selected) {
 const names = [[1, 'Mo'], [2, 'Di'], [3, 'Mi'], [4, 'Do'], [5, 'Fr'], [6, 'Sa'], [7, 'So']];
 const wrap = document.createElement('div');
 wrap.className = 'point-actions';
 const boxes = [];
 for (const [value, label] of names) {
  const item = choice(label, (selected || [1, 2, 3, 4, 5, 6, 7]).map(Number).includes(value));
  item.box.value = String(value);
  boxes.push(item.box);
  wrap.append(item.node);
 }
 return {wrap, boxes};
}

function selectedWeekdays(boxes) {
 return boxes.filter(box => box.checked).map(box => Number(box.value));
}

function limitText(value) {
 return value == null || value === '' ? '' : String(value);
}

function rangeText(parameter) {
 if (parameter.minValue == null && parameter.maxValue == null) return 'Kein Sollbereich hinterlegt.';
 if (parameter.minValue != null && parameter.maxValue != null) return `Sollbereich ${parameter.minValue} bis ${parameter.maxValue}`;
 if (parameter.minValue != null) return `Sollbereich mindestens ${parameter.minValue}`;
 return `Sollbereich höchstens ${parameter.maxValue}`;
}

function renderWater(host, current) {
 missingNote(host, waterInstalled, 'Wasserhygiene ist noch nicht in der Datenbank installiert. Es wurde nichts gespeichert.');
 const data = bundle();
 const catalog = waterCatalog(data);
 if (isManager(current)) {
  const name = input();
  const mode = select([{value: 'daily', label: 'Täglich'}, {value: 'weekly', label: 'Wöchentlich'}, {value: 'times', label: 'Feste Uhrzeiten'}], 'daily');
  const count = input('1');
  const times = input('08:00, 14:00');
  const days = weekdayBoxes([1, 2, 3, 4, 5, 6, 7]);
  count.inputMode = 'numeric';
  const schedule = document.createElement('div');
  const paintSchedule = () => {
   const timed = mode.value === 'times';
   count.parentElement?.classList.toggle('hidden', timed);
   times.parentElement?.classList.toggle('hidden', !timed);
   days.wrap.classList.toggle('hidden', !timed);
  };
  mode.addEventListener('change', paintSchedule);
  host.append(labeled('Becken', name), labeled('Kontrollplan', mode), labeled('Intervallanzahl', count), labeled('Uhrzeiten', times), days.wrap);
  host.append(button('Becken speichern', '', () => commit(() => saveWaterPool(database(), bundle(), {facility: current, name: name.value, scheduleMode: mode.value, intervalCount: count.value, scheduledTimes: times.value, weekdays: selectedWeekdays(days.boxes)}, actor(), new Date().toISOString(), context()))));
  const hint = document.createElement('p');
  hint.className = 'help';
  hint.textContent = 'Sollbereiche werden nicht automatisch gesetzt. Ohne hinterlegten Bereich entsteht keine Grenzwertwarnung.';
  host.append(hint);
  paintSchedule();
 }
 const pools = data.waterPools.filter(item => item.facilityId === current.id).sort((left, right) => Number(left.active === false) - Number(right.active === false) || left.name.localeCompare(right.name, 'de'));
 if (!pools.length) {
  const empty = document.createElement('p');
  empty.className = 'muted';
  empty.textContent = 'Für diesen Betrieb ist noch kein Becken angelegt.';
  host.append(empty);
  return;
 }
 const duePool = pools.find(pool => waterControlState(pool, data.waterChecks, data.waterPoolParameters, new Date().toISOString()).due);
 const initialPool = pools.some(pool => pool.id === selectedWaterPoolId) ? selectedWaterPoolId : (duePool || pools[0]).id;
 const picker = select(pools.map(pool => ({value: pool.id, label: pool.active === false ? `${pool.name} · deaktiviert` : pool.name})), initialPool);
 selectedWaterPoolId = picker.value;
 picker.addEventListener('change', () => {
  selectedWaterPoolId = picker.value;
  followUpAlertId = '';
  renderPanel('');
 });
 host.append(labeled('Becken auswählen', picker));
 const pool = pools.find(item => item.id === picker.value);
 if (!pool) return;
 const parameterOrder = code => waterCatalog(data).findIndex(item => item.code === code);
 const parameters = data.waterPoolParameters.filter(item => item.poolId === pool.id).sort((left, right) => parameterOrder(left.parameterCode) - parameterOrder(right.parameterCode));
 const status = waterControlState(pool, data.waterChecks, data.waterPoolParameters, new Date().toISOString());
 const row = item(pool.name, [`${waterScheduleLabel(pool)}`, status.detail], status.due);
 if (isManager(current)) {
  const actions = document.createElement('div');
  actions.className = 'point-actions';
  const editor = document.createElement('div');
  editor.className = 'point-editor hidden';
  const name = input(pool.name);
  const mode = select([{value: 'daily', label: 'Täglich'}, {value: 'weekly', label: 'Wöchentlich'}, {value: 'times', label: 'Feste Uhrzeiten'}], pool.scheduleMode || 'daily');
  const count = input(String(pool.intervalCount || 1));
  const times = input((pool.scheduledTimes || []).join(', '));
  const days = weekdayBoxes(pool.weekdays);
  count.inputMode = 'numeric';
  const paintSchedule = () => {
   const timed = mode.value === 'times';
   count.parentElement?.classList.toggle('hidden', timed);
   times.parentElement?.classList.toggle('hidden', !timed);
   days.wrap.classList.toggle('hidden', !timed);
  };
  mode.addEventListener('change', paintSchedule);
  editor.append(labeled('Bezeichnung', name), labeled('Kontrollplan', mode), labeled('Intervallanzahl', count), labeled('Uhrzeiten', times), days.wrap);
  editor.append(button('Änderungen speichern', '', () => commit(() => saveWaterPoolChange(database(), bundle(), pool.id, {name: name.value, scheduleMode: mode.value, intervalCount: count.value, scheduledTimes: times.value, weekdays: selectedWeekdays(days.boxes)}, actor(), new Date().toISOString(), context()))));
  actions.append(button('Bearbeiten', 'secondary', () => editor.classList.toggle('hidden')));
  actions.append(button(pool.active === false ? 'Reaktivieren' : 'Deaktivieren', 'secondary', () => commit(() => saveWaterPoolActive(database(), bundle(), pool.id, pool.active === false, actor(), new Date().toISOString(), context()))));
  row.append(actions, editor);
  paintSchedule();
  for (const parameter of parameters) {
   const definition = catalog.find(item => item.code === parameter.parameterCode);
   const block = document.createElement('div');
   block.className = 'water-parameter';
   const title = document.createElement('strong');
   title.textContent = waterParameterName(data, parameter.parameterCode);
   const minimum = input(limitText(parameter.minValue));
   const maximum = input(limitText(parameter.maxValue));
   minimum.inputMode = 'decimal';
   maximum.inputMode = 'decimal';
   minimum.lang = 'de';
   maximum.lang = 'de';
   const required = choice('Erforderlich', parameter.required !== false);
   const active = choice('Aktiv', parameter.active !== false);
   block.append(title, labeled(`Mindestens ${definition?.unit || ''}`.trim(), minimum), labeled(`Höchstens ${definition?.unit || ''}`.trim(), maximum), required.node, active.node);
   block.append(button('Parameter speichern', 'secondary', () => commit(() => saveWaterParameter(database(), bundle(), parameter.id, {minValue: minimum.value, maxValue: maximum.value, required: required.box.checked, active: active.box.checked}, actor(), new Date().toISOString(), context()))));
   row.append(block);
  }
  const missingCodes = catalog.filter(item => !parameters.some(parameter => parameter.parameterCode === item.code));
  if (missingCodes.length) {
   const code = select(missingCodes.map(item => ({value: item.code, label: item.name})));
   row.append(labeled('Weiteren Parameter ergänzen', code));
   row.append(button('Parameter ergänzen', 'secondary', () => commit(() => saveWaterParameterAdd(database(), bundle(), pool.id, code.value, actor(), new Date().toISOString(), context()))));
  }
 }
 else {
  for (const parameter of parameters) {
   const line = document.createElement('p');
   line.className = 'help';
   const stateText = parameter.active === false ? 'deaktiviert' : parameter.required === false ? 'optional' : 'erforderlich';
   line.textContent = `${waterParameterName(data, parameter.parameterCode)} · ${rangeText(parameter)} · ${stateText}`;
   row.append(line);
  }
 }
 if (pool.active !== false) {
  const activeParameters = parameters.filter(item => item.active !== false);
  const readings = document.createElement('div');
  readings.className = 'water-readings';
  const fields = new Map();
  if (followUpAlertId && !data.waterAlerts.some(item => item.id === followUpAlertId && item.poolId === pool.id)) followUpAlertId = '';
  if (followUpAlertId) {
   const banner = document.createElement('p');
   banner.className = 'help';
   banner.textContent = 'Diese Messung wird als Wiederholung dokumentiert. Die bestehende Warnung bleibt davon unberührt.';
   row.append(banner);
  }
  for (const parameter of activeParameters) {
   const definition = catalog.find(item => item.code === parameter.parameterCode);
   const field = input();
   field.inputMode = 'decimal';
   field.lang = 'de';
   fields.set(parameter.parameterCode, field);
   const caption = `${waterParameterName(data, parameter.parameterCode)}${definition?.unit ? ` ${definition.unit}` : ''}${parameter.required === false ? '' : ' · erforderlich'}`;
   readings.append(labeled(caption, field));
   const limit = document.createElement('p');
   limit.className = 'help';
   limit.textContent = rangeText(parameter);
   readings.append(limit);
  }
  row.append(readings);
  const note = input();
  note.placeholder = 'Kommentar, falls nötig';
  row.append(labeled('Kommentar', note));
  row.append(button('Messung speichern', 'secondary', async () => {
   const values = {};
   for (const [code, field] of fields) values[code] = field.value;
   const alertId = followUpAlertId;
   followUpAlertId = '';
   const result = await commit(() => saveWaterCheck(database(), bundle(), pool.id, {values, note: note.value, followUpAlertId: alertId || null}, actor(), new Date().toISOString(), context()));
   if (!result?.ok) followUpAlertId = alertId;
  }));
 } else {
  const paused = document.createElement('p');
  paused.className = 'help';
  paused.textContent = 'Deaktiviert. Die bisherigen Messungen bleiben sichtbar.';
  row.append(paused);
 }
 const checks = data.waterChecks.filter(item => item.poolId === pool.id).slice(0, 15);
 for (const check of checks) {
  const values = check.readings.map(reading => {
   const name = waterParameterName(data, reading.parameterCode);
   const unit = reading.unit ? ` ${reading.unit}` : '';
   const limits = reading.minLimit == null && reading.maxLimit == null ? '' : ` (damals ${reading.minLimit ?? '—'} bis ${reading.maxLimit ?? '—'})`;
   return `${name} ${reading.value}${unit}${limits}`;
  }).join(' · ');
  const line = document.createElement('p');
  line.className = 'help';
  const repeat = check.followUpAlertId ? ' · Wiederholungsmessung' : '';
  line.textContent = `${new Date(check.measuredAt).toLocaleString('de-DE')} · ${check.recordedName}: ${values}${check.note ? ` · ${check.note}` : ''}${repeat}`;
  row.append(line);
 }
 if (data.waterChecks.filter(item => item.poolId === pool.id).length > checks.length) {
  const more = document.createElement('p');
  more.className = 'help';
  more.textContent = 'Ältere Messungen bleiben in der Datenbank gespeichert.';
  row.append(more);
 }
 for (const alert of data.waterAlerts.filter(item => item.poolId === pool.id)) {
  const name = waterParameterName(data, alert.parameterCode);
  const unit = alert.unit ? ` ${alert.unit}` : '';
  const line = document.createElement('p');
  line.className = 'help';
  line.textContent = alert.status === 'open'
   ? `Offene Warnung: ${name} ${alert.value}${unit}. Quittierung ist keine Behebung.`
   : `Quittiert ${new Date(alert.acknowledgedAt).toLocaleString('de-DE')} · ${alert.acknowledgedName}: ${alert.acknowledgementNote}. Die Abweichung gilt damit nicht als behoben.`;
  row.append(line);
  for (const measure of data.waterMeasures.filter(item => item.alertId === alert.id)) {
   const measureLine = document.createElement('p');
   measureLine.className = 'help';
   measureLine.textContent = `Maßnahme ${new Date(measure.recordedAt).toLocaleString('de-DE')} · ${measure.recordedName}: ${measure.measureText}`;
   row.append(measureLine);
  }
  const measure = input();
  measure.placeholder = 'Durchgeführte Maßnahme';
  row.append(labeled('Maßnahme', measure));
  row.append(button('Maßnahme speichern', 'secondary', () => commit(() => saveWaterMeasure(database(), bundle(), alert.id, measure.value, actor(), new Date().toISOString(), context()))));
  row.append(button('Wiederholungsmessung', 'secondary', () => {
   followUpAlertId = alert.id;
   selectedWaterPoolId = pool.id;
   renderPanel('');
  }));
  if (alert.status !== 'open') continue;
  const acknowledgement = input();
  acknowledgement.placeholder = 'Kenntnisnahme, keine Behebung';
  row.append(labeled('Quittierung', acknowledgement));
  row.append(button('Warnung quittieren', 'secondary', () => commit(() => saveWaterAcknowledgement(database(), bundle(), alert.id, acknowledgement.value, actor(), new Date().toISOString(), context()))));
 }
 host.append(row);
}

function renderStock(host, current) {
 missingNote(host, materialsInstalled, 'Materialbestände sind noch nicht in der Datenbank installiert. Es wurde nichts gespeichert.');
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
 missingNote(host, temperatureInstalled, 'Temperaturkontrollen sind noch nicht in der Datenbank installiert. Es wurde nichts gespeichert.');
 missingNote(host, materialsInstalled, 'Materialbestände sind noch nicht in der Datenbank installiert. Es wurde nichts gespeichert.');
 missingNote(host, waterInstalled, 'Wasserhygiene ist noch nicht in der Datenbank installiert. Es wurde nichts gespeichert.');
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
 if (section === 'water') renderWater(host, current);
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
