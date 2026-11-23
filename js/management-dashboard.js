import {supabase} from './supabase.js';
import {el, setHidden} from './utils.js';
import {state} from './state.js';
import {isManager} from './permissions.js';
import {statusNames} from './labels.js';
import {facilityStatusCounts, isActiveDefect, sortByPriorityThenAge} from './defects.js';
import {loadDayFigureBoard} from './operations-store.js';
import {fetchConsumptionCalendar} from './meters-store.js';
import {assetOverdue, formatCents, figurePercent} from './operations.js';
import {analyticsMedia, buildAnalytics, formatAnalyticsValue} from './consumption-analytics.js';
import {revenuePerVisitor, summarizeComparableWindow, yearEndForecast} from './statistics.js';
import {
 allowedFacilityIds,
 copyConfigToFacilities,
 DASHBOARD_PRESETS,
 defaultLayout,
 facilityTileConfig,
 gridColumns,
 moveFacilityId,
 readLocalLayouts,
 writeLocalLayouts
} from './dashboard-layouts.js';

let timer = null;
let seq = 0;
let layoutsState = {layouts: [defaultLayout()]};
let activeIndex = 0;
const consumptionCache = new Map();

function managedFacilities() {
 return (state.accessibleFacilities || []).filter(isManager);
}

export function syncManagementAccess() {
 const allowed = managedFacilities().length > 0;
 el('open-management-dashboard')?.classList.toggle('hidden', !allowed);
 if (!allowed) el('management-board-card')?.classList.add('hidden');
}

function activeLayout() {
 return layoutsState.layouts[activeIndex] || layoutsState.layouts[0] || defaultLayout();
}

function persist() {
 if (state.currentUser?.id) writeLocalLayouts(state.currentUser.id, layoutsState.layouts);
 supabase.from('user_dashboard_layouts').upsert({
  user_id: state.currentUser?.id,
  layouts: layoutsState.layouts,
  updated_at: new Date().toISOString()
 }).then(({error}) => {
  if (!error) return;
  if (/schema cache|PGRST205|does not exist|42P01/i.test(error.message || '')) return;
 });
}

export async function loadDashboardLayouts() {
 if (!state.currentUser?.id) return;
 const local = readLocalLayouts(state.currentUser.id);
 layoutsState = local;
 const remote = await supabase.from('user_dashboard_layouts').select('layouts').eq('user_id', state.currentUser.id).maybeSingle();
 if (!remote.error && Array.isArray(remote.data?.layouts) && remote.data.layouts.length) {
  layoutsState = {layouts: remote.data.layouts, source: 'server'};
 }
}

function metricBlock(title, current, prior, money) {
 const wrap = document.createElement('div');
 wrap.className = 'mgmt-metric';
 const label = document.createElement('span');
 label.textContent = title;
 const value = document.createElement('strong');
 if (current == null) value.textContent = 'Keine Daten';
 else value.textContent = money ? formatCents(current) : new Intl.NumberFormat('de-DE').format(current);
 const change = document.createElement('small');
 const delta = figurePercent(current, prior);
 change.textContent = current == null || prior == null ? 'Vorjahr fehlt' : delta.label;
 wrap.append(label, value, change);
 return wrap;
}

function periodFromRows(rows, from, to, key) {
 const priorKey = key === 'visitors' ? 'priorVisitors' : 'priorTotalCents';
 return summarizeComparableWindow(rows, from, to, key, priorKey);
}

function lastReportFor(facilityId) {
 const reports = (state.operationPreview?.reports || []).filter(report => report.facilityId === facilityId);
 reports.sort((left, right) => String(right.reportDate || '').localeCompare(String(left.reportDate || '')));
 return reports[0] || null;
}

function overdueMaintenance(facilityId) {
 return (state.operationPreview?.assets || []).filter(asset => asset.facilityId === facilityId && assetOverdue(asset, new Date().toISOString())).length;
}

function openTasks(facilityId) {
 return (state.cachedDefects || []).filter(item => item.facility_id === facilityId && item.assigned_to && isActiveDefect(item)).length;
}

async function consumptionFor(facility, media, today) {
 const yearFrom = `${today.slice(0, 4)}-01-01`;
 const lines = [];
 for (const medium of media) {
  const key = `${facility.id}:${medium}:${yearFrom}:${today}`;
  let data = consumptionCache.get(key);
  if (!data) {
   const result = await fetchConsumptionCalendar({
    p_facility_id: facility.id,
    p_medium: medium,
    p_meter_id: null,
    p_grain: 'month',
    p_from: yearFrom,
    p_to: today
   });
   data = result.error ? {error: result.error.message} : {rows: result.data || []};
   consumptionCache.set(key, data);
  }
  if (data.error) {
   lines.push({medium, label: analyticsMedia.find(item => item.id === medium)?.label || medium, text: 'Verbrauch nicht verfügbar'});
   continue;
  }
  const analytics = buildAnalytics(data.rows, {medium, range: 'year'});
  lines.push({
   medium,
   label: analyticsMedia.find(item => item.id === medium)?.label || medium,
   text: `${formatAnalyticsValue(analytics.current, analytics.unit)} · ${analytics.qualityLabel}`
  });
 }
 return lines;
}

function renderTile(host, facility, layout, board, today, extras) {
  const config = facilityTileConfig(layout, facility.id);
  const tile = document.createElement('article');
  tile.className = layout.compact ? 'mgmt-tile compact' : 'mgmt-tile';
  tile.dataset.facilityId = facility.id;
  const heading = document.createElement('h3');
  heading.textContent = facility.name;
  const order = document.createElement('div');
  order.className = 'mgmt-order';
  const up = document.createElement('button');
  up.type = 'button';
  up.className = 'secondary compact-button';
  up.textContent = '↑';
  up.addEventListener('click', () => {
   const next = {...activeLayout(), facilityIds: moveFacilityId(allowedFacilityIds(activeLayout().facilityIds, managedFacilities()), facility.id, -1)};
   layoutsState.layouts[activeIndex] = next;
   persist();
   paint();
  });
  const down = document.createElement('button');
  down.type = 'button';
  down.className = 'secondary compact-button';
  down.textContent = '↓';
  down.addEventListener('click', () => {
   const next = {...activeLayout(), facilityIds: moveFacilityId(allowedFacilityIds(activeLayout().facilityIds, managedFacilities()), facility.id, 1)};
   layoutsState.layouts[activeIndex] = next;
   persist();
   paint();
  });
  order.append(up, down);
  tile.append(heading, order);
  if (!board?.ok) {
   const err = document.createElement('p');
   err.className = 'help';
   err.textContent = board?.error || 'Kennzahlen nicht verfügbar.';
   tile.append(err);
   host.append(tile);
   return;
  }
  const rows = board.overview?.rows || [];
  const dayRow = rows.find(row => row.day === today) || {};
  const monthFrom = `${today.slice(0, 7)}-01`;
  const yearFrom = `${today.slice(0, 4)}-01-01`;
  const monthVisitors = periodFromRows(rows, monthFrom, today, 'visitors');
  const monthRevenue = periodFromRows(rows, monthFrom, today, 'totalCents');
  const yearVisitors = periodFromRows(rows, yearFrom, today, 'visitors');
  const yearRevenue = periodFromRows(rows, yearFrom, today, 'totalCents');
  const blocks = [
   ['Heute', {current: dayRow.visitors ?? null, prior: dayRow.priorVisitors ?? null, state: dayRow.visitors == null ? 'missing' : 'complete'}, {current: dayRow.totalCents ?? null, prior: dayRow.priorTotalCents ?? null, state: dayRow.totalCents == null ? 'missing' : 'complete'}],
   ['Monat', monthVisitors, monthRevenue],
   ['Jahr', yearVisitors, yearRevenue]
  ];
  for (const [title, visitors, revenue] of blocks) {
   const period = document.createElement('section');
   period.className = 'mgmt-period';
   const h = document.createElement('h4');
   h.textContent = title;
   period.append(h);
   if (config.showVisitors) period.append(metricBlock('Besucher', visitors.current, visitors.prior, false));
   if (config.showRevenue) period.append(metricBlock('Umsatz', revenue.current, revenue.prior, true));
   if (visitors.state === 'incomplete' || revenue.state === 'incomplete') {
    const gap = document.createElement('p');
    gap.className = 'help';
    gap.textContent = 'Vergleich unvollständig. Fehlende Tage werden nicht als 0 gezählt.';
    period.append(gap);
   }
   if (config.showRevenuePerVisitor && config.showRevenue && config.showVisitors) {
    const per = revenuePerVisitor(visitors.current, revenue.current);
    const line = document.createElement('p');
    line.className = 'help';
    line.textContent = `Umsatz/Besucher: ${per.label || '—'}`;
    period.append(line);
   }
   tile.append(period);
  }
  if (config.showForecast) {
   const forecast = yearEndForecast(rows.map(row => ({day: row.day, visitors: row.visitors, totalCents: row.totalCents})), today, 'visitors');
   const line = document.createElement('p');
   line.className = 'help';
   line.textContent = forecast.state === 'ok' || forecast.state === 'partial'
    ? `Prognose Besucher Jahr: erfasst ${forecast.actual}, Rest ${forecast.rest}, Gesamt ${forecast.total}. ${forecast.label}`
    : forecast.label;
   tile.append(line);
  }
  if (config.showStatus) {
   const counts = facilityStatusCounts(state.cachedDefects, facility.id);
   const report = lastReportFor(facility.id);
   const status = document.createElement('section');
   status.className = 'mgmt-status';
   const title = document.createElement('h4');
   title.textContent = 'Betriebsstatus';
   status.append(title);
   for (const [label, value] of [
    ['Aktive Mängel', counts.active],
    ['Kritische Mängel', counts.critical],
    ['Überfällige Wartungen', extras.maintenance],
    ['Offene Aufgaben', extras.tasks]
   ]) {
    const line = document.createElement('p');
    line.textContent = `${label}: ${value}`;
    status.append(line);
   }
   const last = document.createElement('p');
   last.className = 'help';
   last.textContent = report ? `Letzter Tagesbericht: ${report.reportDate}` : 'Letzter Tagesbericht: keine Daten';
   status.append(last);
   tile.append(status);
  }
  if (config.showMaintenance) {
   const line = document.createElement('p');
   line.textContent = `Überfällige Wartungen: ${extras.maintenance}`;
   tile.append(line);
  }
  if (config.showConsumption) {
   const list = document.createElement('div');
   const title = document.createElement('h4');
   title.textContent = 'Verbrauch';
   list.append(title);
   for (const line of extras.consumption || []) {
    const row = document.createElement('p');
    row.className = 'help';
    row.textContent = `${line.label}: ${line.text}`;
    list.append(row);
   }
   tile.append(list);
  }
  if (config.showDefects) {
   const defects = sortByPriorityThenAge((state.cachedDefects || []).filter(item => item.facility_id === facility.id && isActiveDefect(item))).slice(0, config.defectLimit);
   const list = document.createElement('div');
   const title = document.createElement('h4');
   title.textContent = 'Offene Mängel';
   list.append(title);
   if (!defects.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Keine offenen Mängel.';
    list.append(empty);
   }
   for (const defect of defects) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mgmt-link';
    button.textContent = `${defect.title} · ${statusNames[defect.status] || defect.status}`;
    button.addEventListener('click', () => {
     document.querySelector('[data-view="defects"]')?.click();
     const filter = el('defect-facility-filter');
     if (filter) {
      filter.value = facility.id;
      filter.dispatchEvent(new Event('change'));
     }
    });
    list.append(button);
   }
   tile.append(list);
  }
  host.append(tile);
}

async function paint() {
  const root = el('management-board');
  if (!root) return;
  const facilities = managedFacilities();
  root.replaceChildren();
  if (!facilities.length) {
   const empty = document.createElement('p');
   empty.className = 'muted';
   empty.textContent = 'Keine Betriebe mit Leitungsrecht für das Management-Dashboard.';
   root.append(empty);
   return;
  }
  const layout = activeLayout();
  const ids = allowedFacilityIds(layout.facilityIds, facilities);
  const selected = ids.map(id => facilities.find(item => item.id === id)).filter(Boolean);
  root.style.setProperty('--mgmt-cols', String(gridColumns(selected.length, layout.columns)));
  root.classList.toggle('mgmt-monitor', layout.monitor === true);
  document.body.classList.toggle('mgmt-fullscreen', layout.fullscreen === true);
  const today = new Date().toISOString().slice(0, 10);
  const token = ++seq;
  const boards = await Promise.all(selected.map(async facility => {
   const config = facilityTileConfig(layout, facility.id);
   const board = await loadDayFigureBoard({rpc: (name, args) => supabase.rpc(name, args)}, facility.id, {from: `${today.slice(0, 4)}-01-01`, to: today});
   const consumption = config.showConsumption ? await consumptionFor(facility, config.media, today) : [];
   return {
    facility,
    board,
    extras: {
     maintenance: overdueMaintenance(facility.id),
     tasks: openTasks(facility.id),
     consumption
    }
   };
  }));
  if (token !== seq) return;
  for (const item of boards) renderTile(root, item.facility, layout, item.board, today, item.extras);
}

function fillConfig() {
  const layout = activeLayout();
  const preset = DASHBOARD_PRESETS[layout.preset] || DASHBOARD_PRESETS.overview;
  if (el('mgmt-columns')) el('mgmt-columns').value = String(layout.columns || 2);
  if (el('mgmt-compact')) el('mgmt-compact').checked = Boolean(layout.compact);
  if (el('mgmt-monitor')) el('mgmt-monitor').checked = Boolean(layout.monitor);
  if (el('mgmt-refresh')) el('mgmt-refresh').value = String(layout.refreshSeconds || 60);
  if (el('mgmt-preset')) el('mgmt-preset').value = layout.preset || 'overview';
  for (const [id, key] of [
   ['mgmt-show-visitors', 'showVisitors'],
   ['mgmt-show-revenue', 'showRevenue'],
   ['mgmt-show-status', 'showStatus'],
   ['mgmt-show-defects', 'showDefects'],
   ['mgmt-show-maintenance', 'showMaintenance'],
   ['mgmt-show-consumption', 'showConsumption']
  ]) {
   if (el(id)) el(id).checked = Boolean(preset[key]);
  }
}

function bindConfig() {
  const form = el('management-config');
  if (!form || form.dataset.bound === '1') return;
  form.dataset.bound = '1';
  form.addEventListener('submit', event => {
   event.preventDefault();
   const layout = {...activeLayout()};
   layout.columns = Number(el('mgmt-columns')?.value || layout.columns);
   layout.compact = Boolean(el('mgmt-compact')?.checked);
   layout.monitor = Boolean(el('mgmt-monitor')?.checked);
   layout.fullscreen = Boolean(el('mgmt-fullscreen')?.checked);
   layout.refreshSeconds = Number(el('mgmt-refresh')?.value || 60);
   layout.preset = el('mgmt-preset')?.value || layout.preset;
   layout.facilityIds = [...(el('mgmt-facilities')?.selectedOptions || [])].map(option => option.value);
   const preset = {...(DASHBOARD_PRESETS[layout.preset] || DASHBOARD_PRESETS.overview)};
   if (el('mgmt-show-visitors')) preset.showVisitors = el('mgmt-show-visitors').checked;
   if (el('mgmt-show-revenue')) preset.showRevenue = el('mgmt-show-revenue').checked;
   if (el('mgmt-show-status')) preset.showStatus = el('mgmt-show-status').checked;
   if (el('mgmt-show-defects')) preset.showDefects = el('mgmt-show-defects').checked;
   if (el('mgmt-show-maintenance')) preset.showMaintenance = el('mgmt-show-maintenance').checked;
   if (el('mgmt-show-consumption')) preset.showConsumption = el('mgmt-show-consumption').checked;
   layout.perFacility = {};
   for (const id of layout.facilityIds.length ? layout.facilityIds : managedFacilities().map(item => item.id)) {
    layout.perFacility[id] = {...preset};
   }
   layoutsState.layouts[activeIndex] = layout;
   persist();
   paint();
   startRefresh();
   if (layout.fullscreen && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
   } else if (!layout.fullscreen && document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
   }
  });
  el('mgmt-copy-config')?.addEventListener('click', () => {
   const layout = copyConfigToFacilities(activeLayout(), allowedFacilityIds(activeLayout().facilityIds, managedFacilities()).map(id => id));
   layoutsState.layouts[activeIndex] = layout;
   persist();
  });
}

function startRefresh() {
  clearInterval(timer);
  const seconds = Number(activeLayout().refreshSeconds) || 60;
  timer = setInterval(() => {
   if (document.visibilityState === 'hidden') return;
   if (!navigator.onLine) return;
   paint();
  }, Math.max(15, seconds) * 1000);
}

export async function openManagementDashboard() {
  syncManagementAccess();
  if (!managedFacilities().length) return;
  const card = el('management-board-card');
  if (!card) return;
  setHidden(card, false);
  bindConfig();
  const select = el('mgmt-facilities');
  if (select) {
   const previous = new Set([...(select.selectedOptions || [])].map(option => option.value));
   const layoutIds = new Set(activeLayout().facilityIds || []);
   select.replaceChildren();
   for (const facility of managedFacilities()) {
    const option = document.createElement('option');
    option.value = facility.id;
    option.textContent = facility.name;
    option.selected = layoutIds.size ? layoutIds.has(facility.id) : previous.size ? previous.has(facility.id) : true;
    select.append(option);
   }
  }
  await loadDashboardLayouts();
  fillConfig();
  await paint();
  startRefresh();
}

el('open-management-dashboard')?.addEventListener('click', () => {
  openManagementDashboard();
  el('management-board-card')?.scrollIntoView({behavior: 'smooth', block: 'start'});
});
