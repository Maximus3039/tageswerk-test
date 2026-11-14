import {paintMobile} from './mobile.js';
import {el, show} from './utils.js';
import {state} from './state.js';
import {operationMetrics, waterRowsForMember} from './operations.js';
import {facilityNotices} from './operations-controls.js';
import {
 actor,
 bundle,
 facility,
 opsUi,
 refreshFromDatabase,
 setOperationsUiHooks,
 today
} from './operations-ui-shared.js';
import {renderReports, renderInspections, renderMaintenance, renderProcurement, renderStock, renderNotices} from './operations-ui-sections.js';
import {renderTemperature} from './operations-ui-temperature.js';
import {renderWater} from './operations-ui-water.js';

let section = 'reports';

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
 opsUi.pendingFacilityId = notice.facilityId;
 if (notice.poolId) opsUi.selectedWaterPoolId = notice.poolId;
 for (const tab of document.querySelectorAll('[data-operation]')) tab.classList.toggle('active', tab.dataset.operation === section);
 const card = el('operations-card');
 if (card?.classList.contains('hidden')) {
  el('open-operations')?.click();
  return;
 }
 const select = el('operations-facility');
 if (select && [...select.options].some(option => option.value === notice.facilityId)) select.value = notice.facilityId;
 renderPanelImpl('');
}

export function refreshOperationMetrics() {
 if (!el('metric-reports')) return;
 if (state.operationPreview) {
  paintOperationMetrics();
  return;
 }
 if (!opsUi.loading) opsUi.loading = refreshFromDatabase(false).finally(() => {
  opsUi.loading = null;
  paintOperationMetrics();
 });
}


function renderPanelImpl(filterDate) {
 const host = el('operations-panel');
 const current = facility();
 if (!host || !current) return;
 host.replaceChildren();
 if (filterDate !== undefined) host.dataset.filter = filterDate;
 const sourceNode = el('operations-source');
 sourceNode.textContent = opsUi.installed
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
 for (const entry of state.accessibleFacilities) {
  const option = document.createElement('option');
  option.value = entry.id;
  option.textContent = entry.name;
  select.append(option);
 }
 if (state.accessibleFacilities.some(entry => entry.id === opsUi.pendingFacilityId)) select.value = opsUi.pendingFacilityId;
 else if (state.accessibleFacilities.some(entry => entry.id === previous)) select.value = previous;
 opsUi.pendingFacilityId = '';
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
 if (!el('operations-card')?.classList.contains('hidden')) renderPanelImpl('');
}

export async function showOperationSection(name, facilityId) {
 if (name === 'temperature') opsUi.temperatureSettingsOpen = false;
 const card = el('operations-card');
 show('operations-card', true);
 el('open-operations')?.classList.add('active');
 if (name) section = name;
 for (const tab of document.querySelectorAll('[data-operation]')) tab.classList.toggle('active', tab.dataset.operation === section);
 if (facilityId && facilityId !== 'all') opsUi.pendingFacilityId = facilityId;
 if (!state.operationPreview) await openOperations();
 else {
  fillFacilities();
  renderPanelImpl('');
 }
 card?.scrollIntoView({behavior: 'smooth', block: 'start'});
}

export async function openOperations() {
 fillFacilities();
 await refreshFromDatabase(true);
 renderPanelImpl();
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
  opsUi.temperatureSettingsOpen = false;
  await openOperations();
  card.scrollIntoView({behavior: 'smooth', block: 'start'});
 });
 el('operations-facility')?.addEventListener('change', () => renderPanelImpl(''));
 for (const tab of document.querySelectorAll('[data-operation]')) {
  tab.addEventListener('click', () => {
   if (tab.dataset.operation === 'temperature') opsUi.temperatureSettingsOpen = false;
   section = tab.dataset.operation;
   for (const other of document.querySelectorAll('[data-operation]')) other.classList.toggle('active', other === tab);
   renderPanelImpl('');
  });
 }
}

setOperationsUiHooks({
 afterCommit: async () => {
  renderPanelImpl();
  refreshOperationMetrics();
 },
 renderPanel: renderPanelImpl
});
