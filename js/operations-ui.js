import {supabase} from './supabase.js';
import {paintMobile} from './mobile.js';
import {el, show} from './utils.js';
import {state} from './state.js';
import {isManager, waterHistoryRole} from './permissions.js';
import {priorityNames, intervalNames} from './labels.js';
import {
 facilityNotices,
 materialBelowMinimum,
 missingTemperaturePoints,
 procurementFromStock,
 stockOf,
 temperatureDefectDraft,
 configureTemperatureInput,
 beginWaterRound,
 clearWaterRound,
 loadWaterRound,
 moveWaterRound,
 ownOpenWaterDraft,
 rememberWaterEntry,
 reviewWaterRound,
 roundFromWaterDraft,
 storeWaterRound,
 waterDraftSaveDelay,
 waterDraftStatusText,
 waterParameterName,
 waterRoundDisplayStatus,
 waterRoundTableRows,
 waterRoundPools,
 waterRoundProgress,
 waterRoundSelection
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
 waterDayRounds,
 waterFacilityPlan,
 waterFacilitySlots,
 waterHistoryByPool,
 waterHistoryCsv,
 waterHistoryRows,
 waterOverviewRows,
 waterReadingOutside,
 waterRowsForMember,
 dayFigureAccess,
 employeeFigureWindow,
 formatCalendarDay,
 formatCents,
 waterScheduleLabel
} from './operations.js';
import {
 loadOperations,
 saveAssetDefect,
 saveAssetRecord,
 saveDailyReport,
 saveDailyReportRevision,
 loadDayFigureBoard,
 saveDayFigures,
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
 saveWaterRound,
 saveWaterRoundDraft,
 discardWaterRound,
 saveWaterMeasure,
 saveWaterFacilitySlots,
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
let waterSettingsOpen = false;
let temperatureSettingsOpen = false;
let waterRoundNotice = '';
let waterRoundError = '';
let followUpAlertId = '';
let waterDraftTimer = 0;
let waterDraftStatus = '';
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
 if (result.bundle) state.operationPreview = result.bundle;
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
 const nowIso = new Date().toISOString();
 const waterView = waterRowsForMember(bundle(), state.myMemberships, nowIso, state.currentUser?.id);
 const metrics = operationMetrics({...bundle(), waterChecks: waterView.checks, waterAlerts: waterView.alerts, waterMeasures: waterView.measures}, ids, today(), nowIso);
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

let figureRender = 0;

function changeLabel(change) {
 const node = document.createElement('span');
 node.className = change?.tone === 'up' ? 'figure-up' : change?.tone === 'down' ? 'figure-down' : 'figure-flat';
 node.textContent = change?.label || 'Keine Vergleichsdaten';
 return node;
}

function figureCell(value) {
 const cell = document.createElement('td');
 if (value instanceof Node) cell.append(value);
 else cell.textContent = value ?? '';
 return cell;
}

function figureTable(headers, rows) {
 const wrap = document.createElement('div');
 wrap.className = 'figure-table-wrap';
 const table = document.createElement('table');
 table.className = 'figure-table';
 const head = document.createElement('tr');
 for (const label of headers) {
  const cell = document.createElement('th');
  cell.scope = 'col';
  cell.textContent = label;
  head.append(cell);
 }
 table.append(head);
 for (const row of rows) {
  const line = document.createElement('tr');
  if (row.weekend === 'saturday') line.className = 'is-saturday';
  if (row.weekend === 'sunday') line.className = 'is-sunday';
  line.append(...row.cells);
  table.append(line);
 }
 wrap.append(table);
 return wrap;
}

function metricLine(title, metric, money) {
 const line = document.createElement('p');
 const name = document.createElement('strong');
 name.textContent = `${title}: `;
 line.append(name);
 if (metric?.state === 'complete' && metric.current != null) {
  line.append(`${money ? formatCents(metric.current) : new Intl.NumberFormat('de-DE').format(metric.current)} gegenüber ${money ? formatCents(metric.prior) : new Intl.NumberFormat('de-DE').format(metric.prior)} `);
 }
 if (metric?.state === 'incomplete') line.append('Vergleich unvollständig. ');
 line.append(changeLabel(metric?.state === 'complete' ? metric.change : metric));
 return line;
}

function renderFigureBoard(host, board, access) {
 const overview = board?.overview || {rows: []};
 const period = board?.period || {};
 const tableRows = (overview.rows || []).map(row => ({
  weekend: row.weekend,
  cells: access === 'manager'
   ? [figureCell(formatCalendarDay(row.day)), figureCell(row.weekday), figureCell(formatCalendarDay(row.compareDay)), figureCell(row.visitors ?? ''), figureCell(row.priorVisitors ?? ''), figureCell(changeLabel(row.visitorChange)), figureCell(formatCents(row.gateCents)), figureCell(formatCents(row.bistroCents)), figureCell(formatCents(row.totalCents)), figureCell(formatCents(row.priorTotalCents)), figureCell(changeLabel(row.revenueChange))]
   : [figureCell(formatCalendarDay(row.day)), figureCell(row.weekday), figureCell(formatCalendarDay(row.compareDay)), figureCell(row.visitors ?? ''), figureCell(changeLabel(row.visitorChange))]
 }));
 const headers = access === 'manager'
  ? ['Datum', 'Wochentag', 'Vergleichstag VJ', 'Besucher', 'Besucher VJ', 'Besucherabweichung', 'Kassenumsatz', 'Bistroumsatz', 'Gesamtumsatz', 'Gesamtumsatz VJ', 'Umsatzabweichung']
  : ['Datum', 'Wochentag', 'Vergleichstag VJ', 'Besucher', 'Besucherabweichung'];
 const overviewTitle = document.createElement('h3');
 overviewTitle.textContent = access === 'manager' ? 'Tagesübersicht' : 'Tagesübersicht der letzten sieben Tage';
 host.append(overviewTitle, figureTable(headers, tableRows));
 for (const [key, fallback] of [['month', 'Monatsentwicklung'], ['year', 'Jahresentwicklung']]) {
  const block = period[key] || {};
  const title = document.createElement('h3');
  title.textContent = fallback;
  host.append(title);
  host.append(metricLine('Besucher', block.visitors, false));
  if (access === 'manager') {
   host.append(metricLine('Kassenumsatz', block.gate, true));
   host.append(metricLine('Bistroumsatz', block.bistro, true));
  }
  host.append(metricLine('Gesamtumsatz', block.total, true));
 }
}

function renderDayFigures(host, current) {
 const access = dayFigureAccess(current, state.myMemberships);
 if (access === 'none') return;
 const board = document.createElement('section');
 board.id = 'day-figures';
 board.className = 'figure-board';
 const heading = document.createElement('h3');
 heading.textContent = 'Tageskennzahlen';
 const day = input(today());
 day.type = 'date';
 if (access === 'employee') {
  const window = employeeFigureWindow(today());
  day.min = window.from;
  day.max = window.to;
 }
 const visitors = input('');
 const gate = input('');
 const bistro = input('');
 const total = input('');
 visitors.inputMode = 'numeric';
 gate.inputMode = 'decimal';
 bistro.inputMode = 'decimal';
 gate.placeholder = '0,00';
 bistro.placeholder = '0,00';
 total.readOnly = true;
 total.tabIndex = -1;
 const paintTotal = () => {
  const left = euroCents(gate.value);
  const right = euroCents(bistro.value);
  total.value = left == null || right == null ? '' : formatCents(left + right);
 };
 gate.addEventListener('input', paintTotal);
 bistro.addEventListener('input', paintTotal);
 const note = input('');
 note.placeholder = 'Nur bei einer Änderung eines gespeicherten Tages';
 board.append(heading, labeled('Tag der Kennzahlen', day), labeled('Besucherzahl', visitors), labeled('Kassenumsatz', gate), labeled('Bistroumsatz', bistro), labeled('Gesamtumsatz', total), labeled('Grund der Änderung', note));
 board.append(button('Kennzahlen speichern', '', () => commit(() => saveDayFigures(database(), {
  facility: current,
  access,
  day: day.value,
  visitors: visitors.value,
  gate: gate.value,
  bistro: bistro.value,
  changeNote: note.value,
  replaces: false,
  source: 'erfassung'
 }, actor(), today()))));
 const resultHost = document.createElement('div');
 board.append(resultHost);
 if (access === 'manager') {
  const from = input('');
  const to = input('');
  from.type = 'date';
  to.type = 'date';
  const weekday = select([{value: 'all', label: 'Alle Wochentage'}, {value: 'saturday', label: 'Nur Samstage'}, {value: 'sunday', label: 'Nur Sonntage'}], 'all');
  const reload = range => paintFigures(range);
  board.append(labeled('Von', from), labeled('Bis', to), labeled('Wochentage', weekday));
  const filters = document.createElement('div');
  filters.className = 'figure-filters';
  const presets = document.createElement('div');
  presets.className = 'figure-presets';
  const preset = (label, shift) => button(label, 'secondary', () => {
   const range = figurePreset(today(), shift);
   from.value = range.from;
   to.value = range.to;
   reload({from: range.from, to: range.to, weekday: weekday.value});
  });
  filters.append(button('Zeitraum anzeigen', 'secondary', () => reload({from: from.value, to: to.value, weekday: weekday.value})));
  presets.append(preset('Aktueller Monat', 'month'), preset('Vorheriger Monat', 'previous-month'), preset('Aktuelles Jahr', 'year'), preset('Vorheriges Jahr', 'previous-year'));
  filters.append(presets);
  board.append(filters, figureSettings(current, access));
 }
 host.append(board);
 const paintFigures = range => {
  const token = ++figureRender;
  loadDayFigureBoard(database(), current.id, range || {}).then(result => {
   if (token !== figureRender || !resultHost.isConnected) return;
   resultHost.replaceChildren();
   if (result.missing) {
    missingNote(resultHost, false, result.error);
    return;
   }
   if (!result.ok) {
    const failure = document.createElement('p');
    failure.className = 'error';
    failure.textContent = result.error;
    resultHost.append(failure);
    return;
   }
   renderFigureBoard(resultHost, result, result.overview?.access || access);
  });
 };
 paintFigures({});
}

function figurePreset(day, kind) {
 const [year, month] = day.split('-').map(Number);
 const startOf = (targetYear, targetMonth) => new Date(Date.UTC(targetYear, targetMonth - 1, 1)).toISOString().slice(0, 10);
 const endOf = (targetYear, targetMonth) => new Date(Date.UTC(targetYear, targetMonth, 0)).toISOString().slice(0, 10);
 if (kind === 'month') return {from: startOf(year, month), to: day};
 if (kind === 'previous-month') {
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return {from: previous.toISOString().slice(0, 10), to: endOf(previous.getUTCFullYear(), previous.getUTCMonth() + 1)};
 }
 if (kind === 'year') return {from: `${year}-01-01`, to: day};
 return {from: `${year - 1}-01-01`, to: `${year - 1}-12-31`};
}

function euroCents(raw) {
 const text = String(raw ?? '').trim().replace(/\s/g, '').replace('€', '');
 if (!text) return null;
 const german = text.includes(',');
 if (!(german ? /^\d{1,9}(\.\d{3})*(,\d{1,2})?$/ : /^\d{1,9}(\.\d{1,2})?$/).test(text)) return null;
 const normalized = german ? text.replace(/\./g, '').replace(',', '.') : text;
 const [whole, fraction = ''] = normalized.split('.');
 return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function figureSettings(current, access) {
 const wrap = document.createElement('div');
 const panel = document.createElement('div');
 panel.id = 'day-figure-settings';
 panel.className = 'water-settings hidden';
 wrap.append(button('⚙ Einstellungen', 'secondary', () => {
  const open = panel.classList.toggle('hidden') === false;
  wrap.firstChild.setAttribute('aria-expanded', open ? 'true' : 'false');
 }));
 wrap.firstChild.setAttribute('aria-expanded', 'false');
 wrap.firstChild.setAttribute('aria-controls', 'day-figure-settings');
 const title = document.createElement('h3');
 title.textContent = 'Historische Daten';
 const help = document.createElement('p');
 help.className = 'help';
 help.textContent = 'Historische Daten können Besucherzahl und Gesamtumsatz enthalten. Fehlende Kassen- und Bistroumsätze werden nicht ergänzt. Ein vorhandener Tag wird nur mit einem Änderungsgrund ersetzt.';
 const historicDay = input('');
 historicDay.type = 'date';
 const historicVisitors = input('');
 const historicTotal = input('');
 const historicNote = input('');
 historicVisitors.inputMode = 'numeric';
 historicTotal.inputMode = 'decimal';
 historicTotal.placeholder = '0,00';
 historicNote.placeholder = 'Grund, falls der Tag schon gespeichert ist';
 const pdf = document.createElement('input');
 pdf.type = 'file';
 pdf.accept = 'application/pdf';
 pdf.addEventListener('change', () => {
  pdf.value = '';
  say('error', 'Die PDF-Erkennung wartet auf eine echte Beispieldatei. Es wurde nichts gelesen und nichts gespeichert.');
 });
 panel.append(title, help, labeled('Historisches Datum', historicDay), labeled('Besucherzahl', historicVisitors), labeled('Gesamtumsatz', historicTotal), labeled('Grund der Änderung', historicNote));
 panel.append(button('Historische Kennzahlen speichern', 'secondary', () => commit(() => saveDayFigures(database(), {
  facility: current,
  access,
  day: historicDay.value,
  visitors: historicVisitors.value,
  total: historicTotal.value,
  gate: '',
  bistro: '',
  changeNote: historicNote.value,
  replaces: false,
  source: 'import'
 }, actor(), today()))));
 panel.append(labeled('PDF-Datei', pdf));
 const steps = document.createElement('p');
 steps.className = 'help';
 steps.textContent = 'Der Import führt über Datei, Analyse, Vorschau, Korrektur, Bestätigung und Protokoll. Die Auswertung einer PDF-Datei beginnt erst nach einer echten Beispieldatei.';
 panel.append(steps);
 wrap.append(panel);
 return wrap;
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
 renderDayFigures(host, current);
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
 let settings = null;
 if (isManager(current)) {
  settings = document.createElement('div');
  settings.id = 'temperature-settings';
  settings.className = temperatureSettingsOpen ? 'water-settings' : 'water-settings hidden';
  const toggle = button('⚙ Einstellungen', 'secondary', () => {
   temperatureSettingsOpen = settings.classList.toggle('hidden') === false;
   toggle.setAttribute('aria-expanded', temperatureSettingsOpen ? 'true' : 'false');
  });
  toggle.setAttribute('aria-expanded', temperatureSettingsOpen ? 'true' : 'false');
  toggle.setAttribute('aria-controls', 'temperature-settings');
  host.append(toggle);
  const name = input();
  const location = input();
  const minimum = configureTemperatureInput(input());
  const maximum = configureTemperatureInput(input());
  const unit = select(Object.entries(intervalNames).map(([value, label]) => ({value, label})), 'day');
  const count = input('1');
  count.inputMode = 'numeric';
  settings.append(labeled('Messstelle', name), labeled('Bereich', location), labeled('Mindestens °C', minimum), labeled('Höchstens °C', maximum), labeled('Kontrollintervall', unit), labeled('Intervallanzahl', count));
  settings.append(button('Messstelle speichern', '', () => commit(() => saveTemperaturePoint(database(), bundle(), {facility: current, name: name.value, location: location.value, minimum: minimum.value, maximum: maximum.value, intervalUnit: unit.value, intervalCount: count.value}, actor(), new Date().toISOString(), context()))));
  host.append(settings);
 }
 const missing = new Set(missingTemperaturePoints(data, current.id, new Date().toISOString()).map(point => point.id));
 const points = data.temperaturePoints.filter(item => item.facilityId === current.id).sort((left, right) => Number(left.active === false) - Number(right.active === false) || left.name.localeCompare(right.name, 'de'));
 for (const point of points) {
  const readings = data.temperatureReadings.filter(item => item.pointId === point.id);
  const status = point.active === false ? 'Deaktiviert. Die bisherigen Messungen bleiben sichtbar.' : missing.has(point.id) ? 'Die Kontrolle ist fällig.' : 'Die nächste Kontrolle ist noch nicht fällig.';
  const row = item(`${point.name}${point.active === false ? ' · deaktiviert' : ''}`, [`${point.location} · zulässig ${amountLabel(point.minC)} bis ${amountLabel(point.maxC)} °C · ${intervalLabel(point)}`, status], missing.has(point.id));
  if (isManager(current) && settings) {
   const managed = document.createElement('div');
   managed.className = 'water-parameter';
   const title = document.createElement('strong');
   title.textContent = point.name;
   const actions = document.createElement('div');
   actions.className = 'point-actions';
   const editor = document.createElement('div');
   editor.className = 'point-editor hidden';
   const name = input(point.name);
   const location = input(point.location);
   const minimum = configureTemperatureInput(input(), String(point.minC));
   const maximum = configureTemperatureInput(input(), String(point.maxC));
   const unit = select(Object.entries(intervalNames).map(([value, label]) => ({value, label})), point.intervalUnit || 'day');
   const count = input(String(point.intervalCount || 1));
   count.inputMode = 'numeric';
   editor.append(labeled('Bezeichnung', name), labeled('Bereich', location), labeled('Mindestens °C', minimum), labeled('Höchstens °C', maximum), labeled('Kontrollintervall', unit), labeled('Intervallanzahl', count));
   editor.append(button('Änderungen speichern', '', () => commit(() => saveTemperaturePointChange(database(), bundle(), point.id, {name: name.value, location: location.value, minimum: minimum.value, maximum: maximum.value, intervalUnit: unit.value, intervalCount: count.value}, actor(), new Date().toISOString(), context()))));
   actions.append(button('Bearbeiten', 'secondary', () => { editor.classList.toggle('hidden'); }));
   actions.append(button(point.active === false ? 'Reaktivieren' : 'Deaktivieren', 'secondary', () => commit(() => saveTemperaturePointActive(database(), bundle(), point.id, point.active === false, actor(), new Date().toISOString(), context()))));
   managed.append(title, actions, editor);
   settings.append(managed);
  }
  if (point.active !== false) {
   const value = configureTemperatureInput(input());
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

function downloadWaterCsv(text, name) {
 const blob = new Blob([`\uFEFF${text}`], {type: 'text/csv;charset=utf-8'});
 const url = URL.createObjectURL(blob);
 const link = document.createElement('a');
 link.href = url;
 link.download = name;
 link.click();
 URL.revokeObjectURL(url);
}

function waterEntryValues(fields, note) {
 const values = {};
 for (const [code, field] of fields) values[code] = field.value;
 return {values, note: note.value};
}

function showDraftStatus(text) {
 waterDraftStatus = text;
 const node = document.querySelector('.water-draft-status');
 if (node) node.textContent = text;
}

async function flushWaterDraftSave(userId, facilityId) {
 const round = loadWaterRound(userId, facilityId);
 if (!round || round.saved) return;
 const baseRevision = Number(round.revision) || 0;
 const sent = `${JSON.stringify(round.entries)}|${round.index}|${round.phase}|${JSON.stringify(round.selectedPoolIds || [])}`;
 let result;
 try {
  result = await saveWaterRoundDraft(database(), round);
 } catch {
  showDraftStatus(waterDraftStatusText.offline);
  return;
 }
 const current = loadWaterRound(userId, facilityId);
 if (!current) return;
 if (!result?.ok) {
  showDraftStatus(result?.conflict ? waterDraftStatusText.conflict : waterDraftStatusText.offline);
  return;
 }
 if ((Number(current.revision) || 0) === baseRevision) storeWaterRound(userId, {...current, revision: result.revision});
 const latest = loadWaterRound(userId, facilityId);
 const nowSent = `${JSON.stringify(latest.entries)}|${latest.index}|${latest.phase}|${JSON.stringify(latest.selectedPoolIds || [])}`;
 if (nowSent !== sent) scheduleWaterDraftSave(userId, facilityId);
 else showDraftStatus(waterDraftStatusText.saved);
}

function scheduleWaterDraftSave(userId, facilityId) {
 showDraftStatus(waterDraftStatusText.saving);
 window.clearTimeout(waterDraftTimer);
 waterDraftTimer = window.setTimeout(() => {
  flushWaterDraftSave(userId, facilityId);
 }, waterDraftSaveDelay);
}

async function rememberDraft(userId, round, immediate = false) {
 const stored = storeWaterRound(userId, round);
 if (immediate) {
  window.clearTimeout(waterDraftTimer);
  showDraftStatus(waterDraftStatusText.saving);
  await flushWaterDraftSave(userId, stored.facilityId);
 } else scheduleWaterDraftSave(userId, stored.facilityId);
 return stored;
}

function discardButton(person, facilityId, round) {
 return button('Kontrollrunde verwerfen', 'secondary', async () => {
  if (!confirm('Kontrollrunde verwerfen? Die erfassten Werte werden nicht als Messung gespeichert.')) return;
  window.clearTimeout(waterDraftTimer);
  const current = round?.roundId ? round : loadWaterRound(person.userId, facilityId);
  if (!current?.roundId) {
   clearWaterRound(person.userId, facilityId);
   renderPanel('');
   return;
  }
  const result = await discardWaterRound(database(), current);
  if (!result?.ok && !result?.absent) {
   showDraftStatus(waterDraftStatusText.offline);
   say('error', result?.error || 'Die Kontrollrunde wurde nicht verworfen.');
   return;
  }
  clearWaterRound(person.userId, facilityId);
  waterRoundError = '';
  const preview = bundle();
  state.operationPreview = {
   ...preview,
   waterRoundDrafts: (preview.waterRoundDrafts || []).filter(draft => !(draft.userId === person.userId && draft.facilityId === facilityId && draft.roundId === current.roundId))
  };
  showDraftStatus('');
  say('ok', 'Die Kontrollrunde wurde verworfen. Es wurde keine Messung gespeichert.');
  renderPanel('');
 });
}

function waterTable(headers, rows) {
 const wrap = document.createElement('div');
 wrap.className = 'water-table-wrap';
 const table = document.createElement('table');
 table.className = 'water-table';
 const head = document.createElement('tr');
 for (const label of headers) {
  const cell = document.createElement('th');
  cell.scope = 'col';
  cell.textContent = label;
  head.append(cell);
 }
 table.append(head);
 for (const values of rows) {
  const line = document.createElement('tr');
  for (const value of values) {
   const cell = document.createElement('td');
   writeWaterCell(cell, value);
   line.append(cell);
  }
  table.append(line);
 }
 wrap.append(table);
 return wrap;
}

function writeWaterCell(cell, value) {
 if (value && typeof value === 'object') {
  if (value.breach) {
   cell.className = 'is-breach';
   cell.title = 'Grenzwertabweichung';
   const mark = document.createElement('span');
   mark.setAttribute('aria-hidden', 'true');
   mark.textContent = '⚠ ';
   cell.append(mark);
  }
  cell.append(document.createTextNode(value.text ?? ''));
  return;
 }
 cell.textContent = value ?? '';
 if (value === 'fehlt') cell.className = 'is-missing';
}

function roundLabel(round) {
 if (round?.kind === 'extra') return 'Zusatzkontrolle';
 if (round?.slotTime) return `Kontrollrunde ${round.slotTime}`;
 return 'Kontrollrunde';
}

function startPlannedRound(person, facilityId, plan) {
 if (loadWaterRound(person.userId, facilityId) || ownOpenWaterDraft(bundle(), facilityId, person.userId)) {
  say('error', 'Die geöffnete Kontrollrunde zuerst abschließen oder verwerfen.');
  return;
 }
 const created = beginWaterRound(person.userId, facilityId);
 storeWaterRound(person.userId, {...created, slotId: plan.slotId || null, kind: plan.kind, slotTime: plan.slotTime || '', selectedPoolIds: []});
 renderPanel('');
}

function renderWaterDay(host, current, data, nowIso) {
 const plan = waterFacilityPlan(data, current.id, nowIso);
 if (!plan.current.length) {
  if (!plan.upcoming.length) return;
  const waiting = document.createElement('p');
  waiting.className = 'help';
  waiting.textContent = 'Der Kontrollplan gilt ab morgen. Für heute wird keine Kontrollrunde nachträglich als fehlend geführt.';
  host.append(waiting);
  return;
 }
 const day = waterDayRounds(data, current.id, nowIso);
 const person = actor();
 const section = document.createElement('section');
 const title = document.createElement('h3');
 title.textContent = 'Kontrollrunden heute';
 section.append(title);
 const rows = day.planned.map(item => [item.time, item.status]);
 for (const extra of day.extras) rows.push(['Zusatzkontrolle', extra.status]);
 section.append(waterTable(['Uhrzeit', 'Status'], rows.length ? rows : [['—', 'Keine Kontrollzeit']]));
 const actions = document.createElement('div');
 actions.className = 'point-actions';
 for (const item of day.planned) {
  if (item.state === 'done') continue;
  actions.append(button(`${item.time} starten`, '', () => startPlannedRound(person, current.id, {slotId: item.id, kind: 'planned', slotTime: item.time})));
 }
 actions.append(button('Zusatzkontrolle starten', 'secondary', () => startPlannedRound(person, current.id, {kind: 'extra'})));
 section.append(actions);
 const note = document.createElement('p');
 note.className = 'help';
 note.textContent = plan.changed
  ? `Ab morgen gelten andere Kontrollzeiten: ${plan.upcoming.map(slot => slot.time).join(', ') || 'kein eigener Kontrollplan'}. Heutige Kontrollrunden bleiben unverändert.`
  : 'Eine Kontrollrunde kann vor ihrer Uhrzeit begonnen werden. Eine versäumte Runde bleibt überfällig, auch wenn eine spätere Runde bereits abgeschlossen ist.';
 section.append(note);
 host.append(section);
}

function waterPoolChoices(pools, selectedIds) {
 const selected = new Set(Array.isArray(selectedIds) ? selectedIds : []);
 const group = document.createElement('fieldset');
 group.className = 'water-pool-choices';
 const legend = document.createElement('legend');
 legend.textContent = 'Becken für die Zusatzkontrolle';
 group.append(legend);
 const boxes = new Map();
 for (const pool of pools) {
  const label = document.createElement('label');
  label.className = 'choice';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = selected.has(pool.id);
  const text = document.createElement('span');
  text.textContent = pool.name;
  label.append(box, text);
  group.append(label);
  boxes.set(pool.id, box);
 }
 return {group, boxes};
}

function applyPoolChoice(person, facilityId, round, poolId, checked, currentValues, currentPoolId) {
 const latest = loadWaterRound(person.userId, facilityId) || round;
 const remembered = currentPoolId && typeof currentValues === 'function' ? rememberWaterEntry(latest, currentPoolId, currentValues()) : latest;
 const ids = new Set(Array.isArray(remembered.selectedPoolIds) ? remembered.selectedPoolIds : []);
 if (checked) ids.add(poolId);
 else ids.delete(poolId);
 const selected = waterRoundPools(bundle(), facilityId).filter(pool => ids.has(pool.id));
 const index = Math.max(selected.findIndex(pool => pool.id === currentPoolId), 0);
 rememberDraft(person.userId, {...remembered, selectedPoolIds: selected.map(pool => pool.id), index, phase: 'edit'}).then(() => renderPanel(''));
}

function renderWaterRound(host, current, data) {
 const pools = waterRoundPools(data, current.id);
 const person = actor();
 const remote = ownOpenWaterDraft(data, current.id, person.userId);
 let round = loadWaterRound(person.userId, current.id);
 if (!round && !remote && waterFacilitySlots(data, current.id, new Date().toISOString()).length) {
  if (waterRoundNotice) {
   const done = document.createElement('p');
   done.className = 'water-round-status';
   done.textContent = waterRoundNotice;
   host.append(done);
   waterRoundNotice = '';
  }
  return;
 }
 const card = document.createElement('section');
 const title = document.createElement('h3');
 title.textContent = roundLabel(round || (remote ? roundFromWaterDraft(remote) : null));
 card.append(title);
 if (waterRoundNotice) {
  const done = document.createElement('p');
  done.className = 'water-round-status';
  done.textContent = waterRoundNotice;
  card.append(done);
  waterRoundNotice = '';
 }
 if (!pools.length) {
  const empty = document.createElement('p');
  empty.className = 'muted';
  empty.textContent = 'Für diesen Betrieb ist kein aktives Becken angelegt.';
  card.append(empty);
  host.append(card);
  return;
 }
 if (!round && remote) {
  const pendingPool = selectedWaterPoolId;
  selectedWaterPoolId = '';
  const note = document.createElement('p');
  note.textContent = 'Eine unterbrochene Kontrollrunde ist gespeichert.';
  const actions = document.createElement('div');
  actions.className = 'point-actions';
  actions.append(button('Kontrollrunde fortsetzen', '', () => {
   const restored = roundFromWaterDraft(remote);
   if (pendingPool) {
    const index = pools.findIndex(pool => pool.id === pendingPool);
    if (index >= 0) restored.index = index;
   }
   storeWaterRound(person.userId, restored);
   showDraftStatus(waterDraftStatusText.saved);
   renderPanel('');
  }));
  actions.append(discardButton(person, current.id, {roundId: remote.roundId, facilityId: current.id, revision: remote.revision}));
  card.append(note, actions);
  host.append(card);
  return;
 }
 if (!round) round = beginWaterRound(person.userId, current.id);
 title.textContent = roundLabel(round);
 const roundPools = waterRoundSelection(data, round);
 if (selectedWaterPoolId) {
  const index = roundPools.findIndex(pool => pool.id === selectedWaterPoolId);
  if (index >= 0) round = storeWaterRound(person.userId, {...round, index, phase: 'edit'});
  selectedWaterPoolId = '';
 }
 if (roundPools.length && round.index >= roundPools.length) round = storeWaterRound(person.userId, {...round, index: 0});
 const progress = waterRoundProgress(data, round, roundPools, person, new Date().toISOString());
 const progressLine = document.createElement('p');
 progressLine.className = 'water-progress';
 progressLine.textContent = round.kind === 'extra' && !roundPools.length
  ? 'Keine Becken ausgewählt'
  : `${progress.label} · ${progress.filled} von ${progress.total} vollständig`;
 card.append(progressLine);
 const roundState = waterRoundDisplayStatus(data, round, person, new Date().toISOString());
 if (roundState) {
  const stateLine = document.createElement('p');
  stateLine.className = 'water-round-status';
  stateLine.textContent = roundState;
  card.append(stateLine);
 }
 const draftStatus = document.createElement('p');
 draftStatus.className = 'water-draft-status';
 draftStatus.textContent = waterDraftStatus;
 card.append(draftStatus);
 if (waterRoundError) {
  const failure = document.createElement('p');
  failure.className = 'error';
  failure.textContent = waterRoundError;
  card.append(failure);
 }
 if (round.phase === 'summary') {
  const review = reviewWaterRound(data, round, person, new Date().toISOString());
  if (!review.ok) {
   const failed = roundPools.findIndex(pool => pool.id === review.poolId);
   round = storeWaterRound(person.userId, {...round, index: failed >= 0 ? failed : round.index, phase: 'edit'});
   const message = document.createElement('p');
   message.className = 'error';
   message.textContent = review.error;
   card.append(message);
  } else {
   const summaryRows = waterRoundTableRows(data, review).map(item => [item.poolName, item.values.temperature, item.values.ph, item.values.free_chlorine, item.values.combined_chlorine, item.status]);
   const chosen = document.createElement('p');
   chosen.className = 'help';
   chosen.textContent = `Diese Becken werden kontrolliert: ${review.pools.map(pool => pool.name).join(', ')}.`;
   card.append(chosen, waterTable(['Becken', 'Temperatur', 'pH-Wert', 'Freies Chlor', 'Gebundenes Chlor', 'Status'], summaryRows));
   const actions = document.createElement('div');
   actions.className = 'point-actions';
   actions.append(button('Zurück zur Eingabe', 'secondary', async () => {
    const latest = loadWaterRound(person.userId, current.id) || round;
    await rememberDraft(person.userId, {...latest, phase: 'edit'}, true);
    renderPanel('');
   }));
   actions.append(discardButton(person, current.id, loadWaterRound(person.userId, current.id) || round));
   const occupied = round.kind === 'planned'
    ? waterDayRounds(data, current.id, new Date().toISOString()).planned.find(item => item.id === round.slotId && item.state === 'done' && item.roundId !== round.roundId)
    : null;
   if (occupied) {
    const kept = document.createElement('p');
    kept.className = 'help';
    kept.textContent = 'Dieser Termin ist abgeschlossen. Die eingegebenen Messwerte bleiben erhalten und können als Zusatzkontrolle gespeichert werden.';
    card.append(kept);
    actions.append(button('Als Zusatzkontrolle speichern', 'secondary', () => {
     const latest = loadWaterRound(person.userId, current.id) || round;
     storeWaterRound(person.userId, {...latest, kind: 'extra', slotId: null, slotTime: '', phase: 'summary', selectedPoolIds: pools.map(pool => pool.id)});
     waterRoundError = '';
     renderPanel('');
    }));
   }
   actions.append(button('Kontrollrunde speichern', '', () => {
    const pending = commit(async () => {
     window.clearTimeout(waterDraftTimer);
     const result = await saveWaterRound(database(), bundle(), loadWaterRound(person.userId, current.id) || round, person, new Date().toISOString(), context());
     if (result?.ok) {
      clearWaterRound(person.userId, current.id);
      showDraftStatus('');
      waterRoundError = '';
      waterRoundNotice = 'Endgültig abgeschlossen';
     } else {
      waterRoundError = result?.error || 'Die Kontrollrunde wurde nicht abgeschlossen. Die erfassten Werte bleiben im Entwurf.';
      if (result?.conflict && result.bundle) state.operationPreview = result.bundle;
     }
     return result;
    });
    if (!pending?.then) return pending;
    return pending.then(result => {
     if (!result?.ok) renderPanel();
     return result;
    });
   }));
   card.append(actions);
   host.append(card);
   return;
  }
 }
 const choices = round.kind === 'extra' ? waterPoolChoices(pools, round.selectedPoolIds) : null;
 if (choices) card.append(choices.group);
 if (!roundPools.length) {
  const hint = document.createElement('p');
  hint.className = 'help';
  hint.textContent = 'Bitte mindestens ein Becken auswählen. Bereits eingegebene Werte bleiben erhalten.';
  const actions = document.createElement('div');
  actions.className = 'point-actions';
  actions.append(discardButton(person, current.id, loadWaterRound(person.userId, current.id) || round));
  choices?.boxes.forEach((box, poolId) => box.addEventListener('change', () => applyPoolChoice(person, current.id, round, poolId, box.checked, null)));
  card.append(hint, actions);
  host.append(card);
  return;
 }
 const pool = roundPools[round.index] || roundPools[0];
 const savedEntry = round.entries[pool.id] || {values: {}, note: ''};
 const parameters = data.waterPoolParameters.filter(item => item.poolId === pool.id && item.active !== false).sort((left, right) => waterCatalog(data).findIndex(item => item.code === left.parameterCode) - waterCatalog(data).findIndex(item => item.code === right.parameterCode));
 const name = document.createElement('strong');
 name.textContent = pool.name;
 card.append(name);
 const readings = document.createElement('div');
 readings.className = 'water-readings';
 const fields = new Map();
 for (const parameter of parameters) {
  const definition = waterCatalog(data).find(item => item.code === parameter.parameterCode);
  const field = input(savedEntry.values[parameter.parameterCode] || '');
  field.inputMode = 'decimal';
  field.lang = 'de';
  fields.set(parameter.parameterCode, field);
  const caption = `${waterParameterName(data, parameter.parameterCode)}${definition?.unit ? ` ${definition.unit}` : ''}${parameter.required === false ? '' : ' · erforderlich'}`;
  readings.append(labeled(caption, field));
 }
 card.append(readings);
 const note = input(savedEntry.note || '');
 note.placeholder = 'Kommentar, falls nötig';
 const keep = () => {
  const latest = loadWaterRound(person.userId, current.id) || round;
  rememberDraft(person.userId, rememberWaterEntry(latest, pool.id, waterEntryValues(fields, note)));
 };
 choices?.boxes.forEach((box, poolId) => box.addEventListener('change', () => applyPoolChoice(person, current.id, round, poolId, box.checked, () => waterEntryValues(fields, note), pool.id)));
 for (const field of fields.values()) field.addEventListener('input', keep);
 note.addEventListener('input', keep);
 card.append(labeled('Kommentar', note));
 const actions = document.createElement('div');
 actions.className = 'point-actions';
 actions.append(button('Zurück', 'secondary', async () => {
  const latest = loadWaterRound(person.userId, current.id) || round;
  await rememberDraft(person.userId, moveWaterRound(latest, roundPools, -1, waterEntryValues(fields, note)), true);
  renderPanel('');
 }));
 if (round.index < roundPools.length - 1) {
  actions.append(button('Weiter', '', async () => {
   const latest = loadWaterRound(person.userId, current.id) || round;
   await rememberDraft(person.userId, moveWaterRound(latest, roundPools, 1, waterEntryValues(fields, note)), true);
   renderPanel('');
  }));
 } else {
  actions.append(button('Zusammenfassung anzeigen', '', async () => {
   const latest = loadWaterRound(person.userId, current.id) || round;
   const remembered = rememberWaterEntry(latest, pool.id, waterEntryValues(fields, note));
   await rememberDraft(person.userId, {...remembered, phase: 'summary'}, true);
   renderPanel('');
  }));
 }
 if (round.index === 0) actions.firstChild.disabled = true;
 actions.append(discardButton(person, current.id, loadWaterRound(person.userId, current.id) || round));
 card.append(actions);
 host.append(card);
}

const waterHistoryViewKey = 'tageswerk-water-history-view';
const waterHistoryHeaders = ['Datum', 'Uhrzeit', 'Becken', 'Freies Chlor', 'Gebundenes Chlor', 'pH-Wert', 'Wassertemperatur', 'Mitarbeiter', 'Grenzwertstatus'];

function waterHistoryView() {
 try {
  return localStorage.getItem(waterHistoryViewKey) === 'time' ? 'time' : 'pool';
 } catch (error) {
  return 'pool';
 }
}

function storeWaterHistoryView(view) {
 try {
  localStorage.setItem(waterHistoryViewKey, view === 'time' ? 'time' : 'pool');
 } catch (error) {
  return;
 }
}

function historyReadingText(reading) {
 return reading && String(reading.value ?? '') !== '' ? `${reading.value}${reading.unit ? ` ${reading.unit}` : ''}` : '';
}

function historyTable(rows) {
 const table = document.createElement('table');
 table.className = 'water-table';
 const head = document.createElement('tr');
 for (const label of waterHistoryHeaders) {
  const cell = document.createElement('th');
  cell.scope = 'col';
  cell.textContent = label;
  head.append(cell);
 }
 table.append(head);
 for (const row of rows) {
  const line = document.createElement('tr');
  const plain = value => {
   const cell = document.createElement('td');
   cell.textContent = value ?? '';
   return cell;
  };
  const readingCell = reading => {
   const cell = document.createElement('td');
   writeWaterCell(cell, waterReadingOutside(reading) ? {text: historyReadingText(reading), breach: true} : historyReadingText(reading));
   return cell;
  };
  line.append(
   plain(row.date),
   plain(row.time),
   plain(row.poolName),
   readingCell(row.values?.free_chlorine),
   readingCell(row.values?.combined_chlorine),
   readingCell(row.values?.ph),
   readingCell(row.values?.temperature),
   plain(row.recordedName),
   plain(row.limitStatus)
  );
  table.append(line);
 }
 return table;
}

function renderWaterHistory(host, current, data, visible) {
 const wrap = document.createElement('section');
 wrap.id = 'water-history';
 wrap.className = 'water-history';
 const heading = document.createElement('h3');
 heading.textContent = 'Messwertübersicht';
 const from = input();
 const to = input();
 from.type = 'date';
 to.type = 'date';
 const poolOptions = [{value: '', label: 'Alle Becken'}].concat(data.waterPools.filter(pool => pool.facilityId === current.id).map(pool => ({value: pool.id, label: pool.name})));
 const people = [...new Map(visible.checks.filter(check => check.facilityId === current.id).map(check => [check.recordedBy, check.recordedName || 'Mitarbeiter']))];
 const personOptions = [{value: '', label: 'Alle Mitarbeiter'}].concat(people.map(([id, name]) => ({value: id, label: name})));
 const poolFilter = select(poolOptions, '');
 const personFilter = select(personOptions, '');
 const viewBar = document.createElement('div');
 viewBar.className = 'water-view-toggle';
 viewBar.setAttribute('role', 'group');
 viewBar.setAttribute('aria-label', 'Darstellung der Messwerte');
 const poolButton = document.createElement('button');
 const timeButton = document.createElement('button');
 for (const [control, view, label] of [[poolButton, 'pool', 'Nach Becken'], [timeButton, 'time', 'Nach Uhrzeit']]) {
  control.type = 'button';
  control.className = 'secondary';
  control.textContent = label;
  control.addEventListener('click', () => {
   storeWaterHistoryView(view);
   paint();
  });
  viewBar.append(control);
 }
 const tableHost = document.createElement('div');
 const exportButton = document.createElement('button');
 exportButton.type = 'button';
 exportButton.className = 'secondary';
 exportButton.textContent = 'Messwerte als CSV exportieren';
 const paint = () => {
  const rows = waterHistoryRows({...data, waterChecks: visible.checks}, current.id, {from: from.value, to: to.value, poolId: poolFilter.value, recordedBy: personFilter.value});
  const view = waterHistoryView();
  poolButton.setAttribute('aria-pressed', view === 'pool' ? 'true' : 'false');
  timeButton.setAttribute('aria-pressed', view === 'time' ? 'true' : 'false');
  exportButton.disabled = !rows.length;
  exportButton.onclick = () => downloadWaterCsv(waterHistoryCsv(rows), 'Wasserhygiene.csv');
  tableHost.replaceChildren();
  if (!rows.length) {
   const empty = document.createElement('p');
   empty.className = 'help';
   empty.textContent = 'Für diese Auswahl liegen keine Messungen vor.';
   tableHost.append(empty);
   return;
  }
  if (view === 'time') {
   tableHost.append(historyTable(rows));
   return;
  }
  for (const group of waterHistoryByPool(rows)) {
   const title = document.createElement('h4');
   title.textContent = group.poolName;
   tableHost.append(title, historyTable(group.rows));
  }
 };
 for (const control of [from, to, poolFilter, personFilter]) control.addEventListener('change', paint);
 wrap.append(heading, labeled('Von', from), labeled('Bis', to), labeled('Becken', poolFilter), labeled('Mitarbeiter', personFilter), exportButton, viewBar, tableHost);
 paint();
 host.append(wrap);
}

function renderWater(host, current) {
 missingNote(host, waterInstalled, 'Wasserhygiene ist noch nicht in der Datenbank installiert. Es wurde nichts gespeichert.');
 const data = bundle();
 const catalog = waterCatalog(data);
 let settings = null;
 if (isManager(current)) {
  settings = document.createElement('div');
  settings.className = waterSettingsOpen ? 'water-settings' : 'water-settings hidden';
  host.append(button('⚙ Einstellungen', 'secondary', () => {
   waterSettingsOpen = settings.classList.toggle('hidden') === false;
  }));
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
  settings.append(labeled('Becken', name), labeled('Kontrollplan', mode), labeled('Intervallanzahl', count), labeled('Uhrzeiten', times), days.wrap);
  settings.append(button('Becken speichern', '', () => commit(() => saveWaterPool(database(), bundle(), {facility: current, name: name.value, scheduleMode: mode.value, intervalCount: count.value, scheduledTimes: times.value, weekdays: selectedWeekdays(days.boxes)}, actor(), new Date().toISOString(), context()))));
  const hint = document.createElement('p');
  hint.className = 'help';
  hint.textContent = 'Sollbereiche werden nicht automatisch gesetzt. Ohne hinterlegten Bereich entsteht keine Grenzwertwarnung.';
  settings.append(hint);
  const savedTimes = waterFacilityPlan(data, current.id, new Date().toISOString()).upcoming.map(slot => slot.time).join(', ');
  const roundTimes = input(savedTimes);
  settings.append(labeled('Tägliche Kontrollzeiten', roundTimes));
  settings.append(button('Kontrollzeiten speichern', 'secondary', () => commit(() => saveWaterFacilitySlots(database(), bundle(), current, roundTimes.value, actor(), new Date().toISOString(), context()))));
  const roundHint = document.createElement('p');
  roundHint.className = 'help';
  roundHint.textContent = 'Bis zu sechs Uhrzeiten gelten für den ganzen Betrieb in der Zeitzone Europe/Berlin. Eine Änderung gilt ab dem nächsten Kalendertag. Heutige Kontrollrunden bleiben unverändert. Die bestehenden Beckenpläne bleiben erhalten.';
  settings.append(roundHint);
  paintSchedule();
  host.append(settings);
 }
 const pools = data.waterPools.filter(item => item.facilityId === current.id).sort((left, right) => Number(left.active === false) - Number(right.active === false) || left.name.localeCompare(right.name, 'de'));
 if (!pools.length) {
  const empty = document.createElement('p');
  empty.className = 'muted';
  empty.textContent = 'Für diesen Betrieb ist noch kein Becken angelegt.';
  host.append(empty);
  return;
 }
 const nowIso = new Date().toISOString();
 const history = waterHistoryRole(current, state.myMemberships);
 const visible = waterRowsForMember(data, state.myMemberships, nowIso, actor().userId);
 const overview = waterOverviewRows(data, current.id, visible.checks, nowIso);
 if (!history) {
  const hiddenValues = document.createElement('p');
  hiddenValues.className = 'help';
  hiddenValues.textContent = 'Gespeicherte Messwerte werden für Mitarbeiter nicht angezeigt. Die noch nicht bestätigte Eingabe steht in der Kontrollrunde.';
  host.append(hiddenValues);
 }
 const day = waterDayRounds(data, current.id, nowIso);
 const urgent = day.planned.find(item => item.state === 'overdue') || day.planned.find(item => item.state === 'due') || day.planned.find(item => item.state === 'waiting');
 const facilityStatus = day.planned.length
  ? (urgent ? `${urgent.time}: ${urgent.status}` : 'Alle geplanten Kontrollrunden sind abgeschlossen.')
  : '';
 host.append(waterTable(
  ['Becken', 'Temperatur', 'pH-Wert', 'Freies Chlor', 'Gebundenes Chlor', 'Letzte Messung', 'Status'],
  overview.map(item => {
   const status = facilityStatus && !String(item.status).startsWith('Grenzwert') ? facilityStatus : item.status;
   const shown = code => {
    const text = history ? item.values[code] : 'nicht sichtbar';
    return history && item.breached?.includes(code) && text !== 'fehlt' ? {text, breach: true} : text;
   };
   return [item.poolName, shown('temperature'), shown('ph'), shown('free_chlorine'), shown('combined_chlorine'), history ? item.measuredLabel : 'nicht sichtbar', status];
  })
 ));
 renderWaterDay(host, current, data, nowIso);
 const duePool = pools.find(pool => waterControlState(pool, visible.checks, data.waterPoolParameters, nowIso).due);
 const initialPool = pools.some(pool => pool.id === selectedWaterPoolId) ? selectedWaterPoolId : (duePool || pools[0]).id;
 const pool = pools.find(item => item.id === initialPool) || pools[0];
 if (!pool) return;
 const parameterOrder = code => waterCatalog(data).findIndex(item => item.code === code);
 const parameters = data.waterPoolParameters.filter(item => item.poolId === pool.id).sort((left, right) => parameterOrder(left.parameterCode) - parameterOrder(right.parameterCode));
 const row = document.createElement('div');
 if (isManager(current) && settings) {
  const picker = select(pools.map(entry => ({value: entry.id, label: entry.active === false ? `${entry.name} · deaktiviert` : entry.name})), pool.id);
  picker.addEventListener('change', () => {
   selectedWaterPoolId = picker.value;
   followUpAlertId = '';
   renderPanel('');
  });
  settings.append(labeled('Becken verwalten', picker));
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
  settings.append(actions, editor);
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
   settings.append(block);
  }
  const missingCodes = catalog.filter(item => !parameters.some(parameter => parameter.parameterCode === item.code));
  if (missingCodes.length) {
   const code = select(missingCodes.map(item => ({value: item.code, label: item.name})));
   settings.append(labeled('Weiteren Parameter ergänzen', code));
   settings.append(button('Parameter ergänzen', 'secondary', () => commit(() => saveWaterParameterAdd(database(), bundle(), pool.id, code.value, actor(), new Date().toISOString(), context()))));
  }
 }
 if (followUpAlertId && !data.waterAlerts.some(item => item.id === followUpAlertId && item.poolId === pool.id)) followUpAlertId = '';
 if (followUpAlertId && pool.active !== false) {
  const activeParameters = parameters.filter(item => item.active !== false);
  const readings = document.createElement('div');
  readings.className = 'water-readings';
  const fields = new Map();
  const banner = document.createElement('p');
  banner.className = 'help';
  banner.textContent = 'Diese Messung wird als Wiederholung dokumentiert. Die bestehende Warnung bleibt davon unberührt.';
  row.append(banner);
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
  row.append(button('Wiederholung speichern', 'secondary', async () => {
   const values = {};
   for (const [code, field] of fields) values[code] = field.value;
   const alertId = followUpAlertId;
   followUpAlertId = '';
   const result = await commit(() => saveWaterCheck(database(), bundle(), pool.id, {values, note: note.value, followUpAlertId: alertId || null}, actor(), new Date().toISOString(), context()));
   if (!result?.ok) followUpAlertId = alertId;
  }));
 } else if (pool.active === false) {
  const paused = document.createElement('p');
  paused.className = 'help';
  paused.textContent = history ? 'Deaktiviert. Die bisherigen Messungen bleiben sichtbar.' : 'Deaktiviert. Die laufende Kontrollrunde bleibt sichtbar.';
  row.append(paused);
 }
 for (const alert of visible.alerts.filter(item => pools.some(entry => entry.id === item.poolId))) {
  const name = waterParameterName(data, alert.parameterCode);
  const unit = alert.unit ? ` ${alert.unit}` : '';
  const line = document.createElement('p');
  line.className = 'help';
  line.textContent = alert.status === 'open'
   ? `Offene Warnung: ${name} ${alert.value}${unit}. Quittierung ist keine Behebung.`
   : `Quittiert ${new Date(alert.acknowledgedAt).toLocaleString('de-DE')} · ${alert.acknowledgedName}: ${alert.acknowledgementNote}. Die Abweichung gilt damit nicht als behoben.`;
  row.append(line);
  const optional = document.createElement('p');
  optional.className = 'help';
  optional.textContent = 'Die Messung ist gespeichert. Die Warnung bleibt sichtbar. Maßnahme und Quittierung sind freiwillig und heben die Abweichung nicht auf.';
  row.append(optional);
  for (const measure of visible.measures.filter(item => item.alertId === alert.id)) {
   const measureLine = document.createElement('p');
   measureLine.className = 'help';
   measureLine.textContent = `Maßnahme ${new Date(measure.recordedAt).toLocaleString('de-DE')} · ${measure.recordedName}: ${measure.measureText}`;
   row.append(measureLine);
  }
  const measure = input();
  measure.placeholder = 'Durchgeführte Maßnahme';
  row.append(labeled('Maßnahme (freiwillig)', measure));
  row.append(button('Maßnahme speichern', 'secondary', () => commit(() => saveWaterMeasure(database(), bundle(), alert.id, measure.value, actor(), new Date().toISOString(), context()))));
  row.append(button('Wiederholungsmessung', 'secondary', () => {
   followUpAlertId = alert.id;
   selectedWaterPoolId = alert.poolId;
   renderPanel('');
  }));
  if (alert.status !== 'open') continue;
  const acknowledgement = input();
  acknowledgement.placeholder = 'Kenntnisnahme, keine Behebung';
  row.append(labeled('Quittierung (freiwillig)', acknowledgement));
  row.append(button('Warnung quittieren', 'secondary', () => commit(() => saveWaterAcknowledgement(database(), bundle(), alert.id, acknowledgement.value, actor(), new Date().toISOString(), context()))));
 }
 host.append(row);
 if (!followUpAlertId) renderWaterRound(host, current, data);
 if (history) renderWaterHistory(host, current, data, visible);
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
 if (name === 'temperature') temperatureSettingsOpen = false;
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
  temperatureSettingsOpen = false;
  await openOperations();
  card.scrollIntoView({behavior: 'smooth', block: 'start'});
 });
 el('operations-facility')?.addEventListener('change', () => renderPanel(''));
 for (const tab of document.querySelectorAll('[data-operation]')) {
  tab.addEventListener('click', () => {
   if (tab.dataset.operation === 'temperature') temperatureSettingsOpen = false;
   section = tab.dataset.operation;
   for (const other of document.querySelectorAll('[data-operation]')) other.classList.toggle('active', other === tab);
   renderPanel('');
  });
 }
}
