import {supabase} from './supabase.js';
import {priorityNames, statusNames} from './labels.js';
import {el, show} from './utils.js';
import {state} from './state.js';
import {isManager} from './permissions.js';
import {clearFacilityMeters, loadFacilityMeters, resetMeterEditor} from './meters.js';
import {paintMobile} from './mobile.js';
import {refreshOperationMetrics, syncOperationFacility} from './operations-ui.js';
import {DASHBOARD_DEFECT_LIMIT, dashboardMineDefects, dashboardRecentDefects, isActiveDefect} from './defects.js';
import {membershipAllowsMeterReading} from './meters-domain.js';
import {fetchConsumptionCalendar} from './meters-store.js';
import {
 analyticsMedia,
 analyticsWindow,
 buildAnalytics,
 formatAnalyticsValue,
 formatDelta,
 sparkHeights
} from './consumption-analytics.js';
import {weatherForFacility, weatherReportLine} from './weather.js';

let openDefectsFromDashboard = () => {};
export function setDashboardActions(actions) {
 if (actions.openDefects) openDefectsFromDashboard = actions.openDefects;
}

export function touchConsumptionFacility() { consumptionFacilityTouched = true; }

let consumptionFacilityTouched = false;
let weatherSeq = 0;
let analyticsSeq = 0;
let lastWeatherLine = '';

export function resetConsumptionPanel() {
 resetMeterEditor();
 consumptionFacilityTouched = false;
 show('consumption-card', false);
 el('open-consumption')?.classList.remove('active');
 el('consumption-facility')?.replaceChildren();
 clearFacilityMeters();
 show('consumption-empty', false);
 show('consumption-panel', true);
}

export function populateConsumptionFacility() {
 const sel = el('consumption-facility');
 if (!sel) return;
 const previous = sel.value;
 const facilities = state.accessibleFacilities;
 const dashboard = el('dashboard-facility')?.value;
 sel.replaceChildren();
 const available = facilities.length > 0;
 show('consumption-empty', !available);
 show('consumption-panel', available);
 if (!available) return;
 for (const facility of facilities) {
  const opt = document.createElement('option');
  opt.value = facility.id;
  opt.textContent = facility.name;
  sel.append(opt);
 }
 if (consumptionFacilityTouched && facilities.some(item => item.id === previous)) sel.value = previous;
 else if (facilities.some(item => item.id === dashboard)) sel.value = dashboard;
 else sel.value = facilities[0].id;
}

export function populateDashboardFilters() {
 const sel = el('dashboard-facility');
 if (!sel) return;
 const old = sel.value;
 sel.replaceChildren();
 const all = document.createElement('option');
 all.value = 'all';
 all.textContent = 'Alle berechtigten Betriebe';
 sel.append(all);
 for (const facility of state.accessibleFacilities) {
  const opt = document.createElement('option');
  opt.value = facility.id;
  opt.textContent = facility.name;
  sel.append(opt);
 }
 sel.value = state.accessibleFacilities.some(item => item.id === old) ? old : 'all';
 const settings = el('settings-facility');
 if (!settings) return;
 const previous = settings.value;
 settings.replaceChildren();
 for (const facility of state.accessibleFacilities.filter(isManager)) {
  const option = document.createElement('option');
  option.value = facility.id;
  option.textContent = facility.name;
  settings.append(option);
 }
 if ([...settings.options].some(option => option.value === previous)) settings.value = previous;
 el('settings-card')?.classList.toggle('hidden', !settings.options.length);
}

function dashRows(target, rows, empty) {
 const box = el(target);
 if (!box) return;
 box.replaceChildren();
 if (!rows.length) {
  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = empty;
  box.append(note);
  return;
 }
 for (const defect of rows.slice(0, DASHBOARD_DEFECT_LIMIT)) {
  const item = document.createElement('div');
  item.className = 'dash-row';
  item.tabIndex = 0;
  item.setAttribute('role', 'button');
  const title = document.createElement('strong');
  title.textContent = defect.title;
  title.className = 'priority-' + (defect.priority || 'normal');
  const detail = document.createElement('small');
  detail.textContent = (state.accessibleFacilities.find(item => item.id === defect.facility_id)?.name || 'Betrieb')
   + ' · ' + (priorityNames[defect.priority] || 'Normal')
   + ' · ' + (statusNames[defect.status] || defect.status);
  item.append(title, detail);
  const go = () => { openDefectsFromDashboard(); };
  item.onclick = go;
  item.onkeydown = event => { if (event.key === 'Enter') go(); };
  box.append(item);
 }
}

function selectedFacility() {
 const selected = el('dashboard-facility')?.value;
 if (selected && selected !== 'all') {
  return state.accessibleFacilities.find(item => item.id === selected) || null;
 }
 return state.accessibleFacilities[0] || null;
}

function renderSpark(host, points) {
 if (!host) return;
 host.replaceChildren();
 for (const bar of sparkHeights(points)) {
  const node = document.createElement('i');
  node.style.height = `${bar.height}px`;
  if (bar.empty) node.classList.add('is-empty');
  if (bar.estimate) node.classList.add('is-estimate');
  host.append(node);
 }
}

async function renderWeatherPanel() {
 const box = el('dash-weather');
 if (!box) return;
 const facility = selectedFacility();
 const seq = ++weatherSeq;
 if (!facility) {
  box.innerHTML = '<p class="help">Kein Betrieb gewählt.</p>';
  lastWeatherLine = '';
  return;
 }
 box.innerHTML = '<p class="help">Wetter wird geladen …</p>';
 const result = await weatherForFacility(facility);
 if (seq !== weatherSeq) return;
 if (!result.ok) {
  box.innerHTML = `<p class="help">${result.error}</p>`;
  lastWeatherLine = '';
  return;
 }
 const weather = result.weather;
 lastWeatherLine = weatherReportLine(weather, result.location);
 box.replaceChildren();
 const layout = document.createElement('div');
 layout.className = 'weather-card compact';
 const icon = document.createElement('div');
 icon.className = 'weather-icon';
 icon.textContent = weather.icon;
 icon.setAttribute('aria-hidden', 'true');
 const body = document.createElement('div');
 const title = document.createElement('strong');
 title.className = 'panel-value';
 title.textContent = weather.temperature != null ? `${weather.temperature} °C` : '—';
 const meta = document.createElement('p');
 meta.className = 'panel-meta';
 meta.textContent = `${weather.label} · ${facility.name}`;
 body.append(title, meta);
 layout.append(icon, body);
 const facts = document.createElement('div');
 facts.className = 'weather-facts';
 const entries = [
  ['Max', weather.max != null ? `${weather.max}°` : '—'],
  ['Min', weather.min != null ? `${weather.min}°` : '—'],
  ['Regen', weather.rainChance != null ? `${weather.rainChance}%` : '—'],
  ['Wind', weather.wind != null ? `${weather.wind}` : '—']
 ];
 for (const [label, value] of entries) {
  const cell = document.createElement('div');
  const caption = document.createElement('span');
  caption.textContent = label;
  const strong = document.createElement('strong');
  strong.textContent = value;
  cell.append(caption, strong);
  facts.append(cell);
 }
 box.append(layout, facts);
 if (result.location.uncertain || result.location.source === 'geocode') {
  const warn = document.createElement('p');
  warn.className = 'estimate-badge weather-uncertain';
  warn.textContent = `Standort geschätzt${result.location.place ? `: ${result.location.place}` : ''} – bitte Koordinaten hinterlegen.`;
  box.append(warn);
 }
 const source = document.createElement('p');
 source.className = 'help';
 source.textContent = `${weather.source} · ${result.location.source === 'facility' ? 'Standort ok' : 'geschätzt'}`;
 box.append(source);
}

async function renderAnalyticsPanel() {
 const box = el('dash-analytics');
 if (!box) return;
 const facility = selectedFacility();
 const seq = ++analyticsSeq;
 const actor = {
  userId: state.currentUser?.id,
  memberships: state.myMemberships || []
 };
 if (!facility || !membershipAllowsMeterReading(facility, actor.memberships, actor.userId)) {
  box.innerHTML = '<p class="help">Keine Berechtigung für Verbrauchswerte in diesem Betrieb.</p>';
  return;
 }
 box.innerHTML = '<p class="help">Verbrauch wird geladen …</p>';
 const medium = el('dash-analytics-medium')?.value || 'electricity';
 const range = el('dash-analytics-range')?.value || 'month';
 const window = analyticsWindow(range);
 try {
  const {data, error} = await fetchConsumptionCalendar({
   p_facility_id: facility.id,
   p_medium: medium,
   p_meter_id: null,
   p_grain: window.grain,
   p_from: window.compareFrom,
   p_to: window.to
  });
  if (seq !== analyticsSeq) return;
  if (error) throw error;
  const analytics = buildAnalytics(data || [], {medium, range});
  box.replaceChildren();
  const chips = document.createElement('div');
  chips.className = 'stats-grid';
  const delta = formatDelta(analytics.delta);
  const current = formatAnalyticsValue(analytics.current, analytics.unit);
  const previous = formatAnalyticsValue(analytics.previous, analytics.unit);
  for (const [label, value, extra] of [
   ['Aktuell', current, analytics.qualityLabel],
   ['Vergleich', previous, 'Vorperiode'],
   ['Veränderung', delta.text, delta.tone]
  ]) {
   const chip = document.createElement('div');
   chip.className = 'stat-chip';
   const caption = document.createElement('span');
   caption.textContent = label;
   const strong = document.createElement('strong');
   strong.textContent = value;
   if (extra === 'delta-up' || extra === 'delta-down' || extra === 'delta-flat') strong.className = extra;
   chip.append(caption, strong);
   if (extra && !String(extra).startsWith('delta-')) {
    const meta = document.createElement('p');
    meta.className = 'help';
    meta.textContent = extra;
    chip.append(meta);
    if (analytics.current.kind === 'estimated' || analytics.current.kind === 'mixed') {
     const badge = document.createElement('span');
     badge.className = 'estimate-badge';
     badge.textContent = 'Schätzung gekennzeichnet';
     chip.append(badge);
    }
   }
   chips.append(chip);
  }
  const spark = document.createElement('div');
  spark.className = 'sparkline';
  spark.setAttribute('aria-hidden', 'true');
  renderSpark(spark, analytics.points);
  const note = document.createElement('p');
  note.className = 'help';
  note.textContent = analytics.spikes.length
   ? `${analytics.spikes.length} auffällige Sprünge im Zeitraum. Verbrauch folgt Perioden/Kalender, nicht rohen Zählerständen.`
   : 'Verbrauch folgt Perioden/Kalender, nicht rohen Zählerständen.';
  box.append(chips, spark, note);
 } catch (error) {
  if (seq !== analyticsSeq) return;
  box.innerHTML = `<p class="help">Verbrauch konnte nicht geladen werden: ${error.message || 'Unbekannter Fehler'}</p>`;
 }
}

export function latestWeatherReportLine() {
 return lastWeatherLine;
}

function paintNexusStatus(openCount, criticalCount, progressCount) {
 const dateNode = el('nexus-date');
 if (dateNode) {
  dateNode.textContent = new Intl.DateTimeFormat('de-DE', {
   timeZone: 'Europe/Berlin',
   weekday: 'short',
   day: '2-digit',
   month: '2-digit',
   year: 'numeric'
  }).format(new Date());
 }
 const status = el('nexus-status');
 if (!status) return;
 status.classList.remove('status-ok', 'status-warn', 'status-alert', 'status-idle');
 if (criticalCount > 0) {
  status.textContent = `${criticalCount} kritisch`;
  status.classList.add('status-alert');
 } else if (openCount > 0 || progressCount > 0) {
  status.textContent = `${openCount + progressCount} offen / laufend`;
  status.classList.add('status-warn');
 } else {
  status.textContent = 'Keine kritischen Meldungen';
  status.classList.add('status-ok');
 }
 const spotlight = el('facility-spotlight-status');
 if (spotlight) {
  spotlight.replaceChildren();
  const chips = [
   [`${openCount} Mängel`, openCount ? 'status-warn' : 'status-ok'],
   [`${progressCount} laufend`, progressCount ? 'status-warn' : 'status-idle'],
   criticalCount ? [`${criticalCount} kritisch`, 'status-alert'] : null
  ].filter(Boolean);
  for (const [text, tone] of chips) {
   const chip = document.createElement('span');
   chip.className = `nexus-chip ${tone}`;
   chip.textContent = text;
   spotlight.append(chip);
  }
 }
}

export function renderDashboard() {
 if (!el('metric-open')) return;
 paintMobile();
 const selected = el('dashboard-facility').value;
 const data = state.cachedDefects.filter(item => selected === 'all' || item.facility_id === selected);
 const count = pred => data.filter(pred).length;
 const openCount = count(item => item.status === 'open' && !item.archived_at);
 const progressCount = count(item => item.status === 'in_progress' && !item.archived_at);
 const criticalCount = count(item => item.priority === 'critical' && isActiveDefect(item));
 for (const [id, value] of [
  ['open', openCount],
  ['progress', progressCount],
  ['resolved', count(item => item.status === 'resolved' && !item.archived_at)],
  ['review', count(item => item.status === 'pending_review' && !item.archived_at)],
  ['mine', count(item => item.assigned_to === state.currentUser?.id && isActiveDefect(item))],
  ['critical', criticalCount]
 ]) {
  const node = el('metric-' + id);
  if (node) node.textContent = value;
 }
 paintNexusStatus(openCount, criticalCount, progressCount);
 dashRows('dash-mine', dashboardMineDefects(data, state.currentUser?.id), 'Keine offenen persönlichen Aufgaben.');
 dashRows('dash-recent', dashboardRecentDefects(data), 'Noch keine aktiven Mängel.');
 const facilities = el('dash-facilities');
 if (facilities) {
  facilities.replaceChildren();
  for (const facility of state.accessibleFacilities.filter(item => selected === 'all' || item.id === selected)) {
   const row = document.createElement('div');
   row.className = 'item';
   row.textContent = facility.name + ' · ' + data.filter(item => item.facility_id === facility.id && isActiveDefect(item)).length + ' nicht abgeschlossene Mängel';
   facilities.append(row);
  }
  if (!facilities.childNodes.length) facilities.textContent = 'Keine berechtigten Betriebe.';
 }
 renderCriticalAlerts(data);
 refreshOperationMetrics();
 renderWeatherPanel();
 renderAnalyticsPanel();
}

el('dashboard-facility')?.addEventListener('change', () => {
 const selected = el('dashboard-facility').value;
 if (!consumptionFacilityTouched) {
  populateConsumptionFacility();
  if (!el('consumption-card')?.classList.contains('hidden')) loadFacilityMeters(el('consumption-facility').value);
 }
 syncOperationFacility(selected);
 renderDashboard();
});
el('open-consumption')?.addEventListener('click', () => {
 const card = el('consumption-card');
 const open = card.classList.contains('hidden');
 if (open && !consumptionFacilityTouched) populateConsumptionFacility();
 show('consumption-card', open);
 el('open-consumption').classList.toggle('active', open);
 if (open) {
  loadFacilityMeters(el('consumption-facility').value);
  card.scrollIntoView({behavior: 'smooth', block: 'start'});
 }
});
el('consumption-facility')?.addEventListener('change', () => {
 consumptionFacilityTouched = true;
 loadFacilityMeters(el('consumption-facility').value);
});
el('dash-analytics-medium')?.addEventListener('change', () => renderAnalyticsPanel());
el('dash-analytics-range')?.addEventListener('change', () => renderAnalyticsPanel());

export async function loadCriticalAcks() {
 if (!state.currentUser) return;
 const {data, error} = await supabase.from('critical_defect_acknowledgements').select('defect_id,acknowledged_by,acknowledged_at');
 if (error) {
  state.notificationSupport = false;
  state.ackRows = [];
  return;
 }
 state.notificationSupport = true;
 state.ackRows = data || [];
 renderDashboard();
}

function renderCriticalAlerts(data) {
 const box = el('dashboard-alerts');
 if (!box) return;
 box.replaceChildren();
 const critical = data.filter(item => item.priority === 'critical' && isActiveDefect(item));
 if (!critical.length) return;
 const heading = document.createElement('div');
 heading.className = 'alert-box';
 const title = document.createElement('strong');
 title.textContent = critical.length + ' kritische Mängel';
 heading.append(title);
 const help = document.createElement('p');
 help.className = 'help';
 help.textContent = 'Bei akuter Gefahr sofort die betrieblichen Sicherheits- und Meldewege nutzen. Die App ersetzt keine Notfallalarmierung.';
 heading.append(help);
 if (!state.notificationSupport) {
  const note = document.createElement('p');
  note.className = 'help';
  note.textContent = 'Kenntnisnahmen konnten in dieser Sitzung nicht geladen werden.';
  heading.append(note);
 }
 for (const defect of critical) {
  const facility = state.accessibleFacilities.find(item => item.id === defect.facility_id);
  if (!facility) continue;
  const row = document.createElement('div');
  row.className = 'item';
  const acknowledged = state.ackRows.filter(item => item.defect_id === defect.id);
  const name = document.createElement('strong');
  name.textContent = defect.title + ' · ' + facility.name;
  row.append(name);
  const sub = document.createElement('p');
  sub.className = 'help';
  sub.textContent = acknowledged.length
   ? 'Kenntnisnahme dokumentiert: ' + new Date(acknowledged[0].acknowledged_at).toLocaleString('de-DE')
   : 'Noch keine Kenntnisnahme dokumentiert';
  row.append(sub);
  if (isManager(facility) && state.notificationSupport && !acknowledged.some(item => item.acknowledged_by === state.currentUser?.id)) {
   const button = document.createElement('button');
   button.className = 'secondary compact-button';
   button.textContent = 'Zur Kenntnis genommen';
   button.onclick = async () => {
    button.disabled = true;
    const {error} = await supabase.from('critical_defect_acknowledgements').insert({
     defect_id: defect.id,
     acknowledged_by: state.currentUser.id
    });
    if (error) {
     alert('Bestätigung fehlgeschlagen: ' + error.message);
     button.disabled = false;
    } else await loadCriticalAcks();
   };
   row.append(button);
  }
  heading.append(row);
 }
 box.append(heading);
}

export async function loadSettings() {
 const {data, error} = await supabase.from('facility_escalation_settings').select('facility_id,reminder_minutes,escalation_minutes,after_hours_mode,business_hours');
 if (error) {
  state.settingsRows = [];
  const message = el('settings-message');
  if (message) {
   message.className = 'error';
   message.textContent = 'Einstellungen konnten nicht geladen werden: ' + error.message;
  }
  return;
 }
 state.settingsRows = data || [];
 displaySettings();
}

function displaySettings() {
 const facilityId = el('settings-facility')?.value;
 const settings = state.settingsRows.find(item => item.facility_id === facilityId);
 if (el('setting-reminder')) el('setting-reminder').value = settings?.reminder_minutes ?? 15;
 if (el('setting-escalation')) el('setting-escalation').value = settings?.escalation_minutes ?? 30;
 if (el('setting-mode')) el('setting-mode').value = settings?.after_hours_mode ?? 'always';
 if (el('setting-hours')) el('setting-hours').value = settings?.business_hours ? JSON.stringify(settings.business_hours, null, 2) : '';
}

el('settings-facility')?.addEventListener('change', displaySettings);
el('settings-expert')?.addEventListener('change', () => show('expert-fields', el('settings-expert').checked));
el('save-settings')?.addEventListener('click', async () => {
 const facilityId = el('settings-facility').value;
 const message = el('settings-message');
 if (!facilityId || !state.accessibleFacilities.some(item => item.id === facilityId && isManager(item))) {
  message.className = 'error';
  message.textContent = 'Keine Berechtigung für diesen Betrieb.';
  return;
 }
 const reminder = Number(el('setting-reminder').value);
 const escalation = Number(el('setting-escalation').value);
 if (!Number.isInteger(reminder) || !Number.isInteger(escalation) || reminder < 1 || escalation <= reminder) {
  message.className = 'error';
  message.textContent = 'Die Eskalation muss später als die erste Erinnerung erfolgen.';
  return;
 }
 let hours = {};
 try {
  hours = el('setting-hours').value.trim() ? JSON.parse(el('setting-hours').value) : {};
 } catch {
  message.className = 'error';
  message.textContent = 'Die Betriebszeiten konnten nicht gelesen werden. Bitte die erweiterte Eingabe prüfen oder das Feld leer lassen.';
  return;
 }
 const {error} = await supabase.from('facility_escalation_settings').upsert({
  facility_id: facilityId,
  reminder_minutes: reminder,
  escalation_minutes: escalation,
  after_hours_mode: el('setting-mode').value,
  business_hours: hours
 }, {onConflict: 'facility_id'});
 message.className = error ? 'error' : 'ok';
 message.textContent = error ? 'Speichern fehlgeschlagen: ' + error.message : '✓ Einstellungen gespeichert.';
 if (!error) await loadSettings();
});
