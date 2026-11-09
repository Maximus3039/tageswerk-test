import {supabase} from './supabase.js';
import {el, show} from './utils.js';
import {state} from './state.js';
import {isManager} from './permissions.js';
import {priorityNames, intervalNames} from './labels.js';
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
 saveProcurementRequest,
 saveProcurementReview,
 saveReportDefect,
 supabaseOperationDb
} from './operations-store.js';

const markNames = {ok: 'In Ordnung', notable: 'Auffällig', unchecked: 'Nicht geprüft'};
const statusNames = {submitted: 'Gemeldet', approved: 'Genehmigt', rejected: 'Abgelehnt', open: 'Offen', completed: 'Abgeschlossen'};
let installed = false;
let section = 'reports';
let loading = null;

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
 let result;
 try {
  result = await task();
 } catch (error) {
  say('error', 'Die Speicherung wurde nicht bestätigt.');
  return null;
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
 node.addEventListener('click', onClick);
 return node;
}

function labeled(text, control) {
 const node = document.createElement('label');
 node.textContent = text;
 node.append(control);
 return node;
}

function input(value) {
 const node = document.createElement('input');
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
  host.append(labeled('Bezeichnung des Kontrollgangs', name), labeled('Prüfpunkte', points), labeled('Wiederholung', unit), labeled('Intervallanzahl', count));
  host.append(button('Checkliste anlegen', '', () => commit(() => saveInspectionTemplate(database(), bundle(), {facility: current, name: name.value, points: points.value, intervalUnit: unit.value, intervalCount: count.value}, actor(), new Date().toISOString(), context()))));
  const template = select((data.templates || []).filter(item => item.facilityId === current.id).map(item => ({value: item.id, label: item.name})));
  const people = state.staff.filter(member => member.is_active === true && member.facility_id === current.id);
  const person = select(people.map(member => ({value: member.user_id, label: member.name})));
  const due = input();
  due.type = 'datetime-local';
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
  const anchor = input();
  anchor.type = 'date';
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
  row.append(labeled('Wartung dokumentieren', note), button('Als erledigt speichern', 'secondary', () => commit(() => saveMaintenanceLog(database(), bundle(), asset.id, note.value, actor(), new Date().toISOString(), context()))));
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
 if (state.accessibleFacilities.some(item => item.id === previous)) select.value = previous;
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
