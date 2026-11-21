import {supabase} from './supabase.js';
import {el} from './utils.js';
import {state} from './state.js';
import {isManager} from './permissions.js';
import {emptyOperations} from './operations.js';
import {loadOperations, saveOldFacilityAlertHides, supabaseOperationDb} from './operations-store.js';

export const markNames = {ok: 'In Ordnung', notable: 'Auffällig', unchecked: 'Nicht geprüft'};
export const statusNames = {submitted: 'Gemeldet', approved: 'Genehmigt', rejected: 'Abgelehnt', open: 'Offen', completed: 'Abgeschlossen'};

export const opsUi = {
 installed: false,
 temperatureInstalled: false,
 materialsInstalled: false,
 waterInstalled: false,
 waterFiltersInstalled: false,
 selectedWaterPoolId: '',
 selectedWaterFilterId: '',
 selectedFlushId: '',
 flushHistoryPoolId: '',
 flushHistoryFilterId: '',
 flushHistoryPeriod: '30',
 flushHistoryFrom: '',
 flushHistoryTo: '',
 statusHistoryFilterId: '',
 waterSettingsOpen: false,
 temperatureSettingsOpen: false,
 waterRoundNotice: '',
 waterRoundError: '',
 followUpAlertId: '',
 alertHidesInstalled: false,
 alertView: {temperature: 'active', water: 'active'},
 waterDraftTimer: 0,
 waterDraftStatus: '',
 loading: null,
 pendingFacilityId: '',
 saving: false,
 figureRender: 0
};

const hooks = {
 afterCommit: async () => {},
 renderPanel: () => {}
};

export function setOperationsUiHooks(next) {
 if (next.afterCommit) hooks.afterCommit = next.afterCommit;
 if (next.renderPanel) hooks.renderPanel = next.renderPanel;
}

export function renderPanel(filterDate) {
 return hooks.renderPanel(filterDate);
}

export function actor() {
 const user = state.currentUser;
 const profile = state.staff.find(member => member.user_id === user?.id);
 return {userId: user?.id, name: profile?.name || 'unbekannte Person', memberships: state.myMemberships};
}

export function facility() {
 return state.accessibleFacilities.find(item => item.id === el('operations-facility')?.value) || null;
}

export function defectsFor(facilityId) {
 return (state.cachedDefects || []).filter(defect => defect.facility_id === facilityId);
}

export function say(kind, message) {
 const node = el('operations-message');
 if (!node) return;
 node.className = kind;
 node.textContent = message;
}

export function database() {
 return supabaseOperationDb(supabase);
}

export function context() {
 const names = {};
 for (const member of state.staff || []) names[member.user_id] = member.name;
 const current = actor();
 if (current.userId) names[current.userId] = names[current.userId] || current.name;
 return {facilities: state.accessibleFacilities, names};
}

export async function commit(task) {
 if (opsUi.saving) return null;
 opsUi.saving = true;
 document.body.dataset.saving = '1';
 const previous = state.operationPreview;
 try {
  const result = await task();
  if (!result?.ok || !result.id) {
   state.operationPreview = previous;
   say('error', result?.error || 'Die Speicherung wurde nicht bestätigt.');
   return null;
  }
  const loaded = await refreshFromDatabase(false);
  if (!loaded.ok || !loaded.bundle) {
   state.operationPreview = previous;
   say('error', loaded.error || 'Die Speicherung wurde nicht bestätigt.');
   return null;
  }
  say(result.warning ? 'error' : 'ok', result.warning ? `Gespeichert. ${result.warning}` : '✓ In der Datenbank gespeichert.');
  await hooks.afterCommit();
  return result;
 } catch (error) {
  state.operationPreview = previous;
  say('error', 'Die Speicherung wurde nicht bestätigt.');
  return null;
 } finally {
  opsUi.saving = false;
  delete document.body.dataset.saving;
 }
}

export async function refreshFromDatabase(announce) {
 const loaded = await loadOperations(database(), actor(), context());
 opsUi.installed = loaded.installed === true;
 opsUi.temperatureInstalled = loaded.temperatureInstalled === true;
 opsUi.materialsInstalled = loaded.materialsInstalled === true;
 opsUi.waterInstalled = loaded.waterInstalled === true;
 opsUi.waterFiltersInstalled = loaded.waterFiltersInstalled === true;
 opsUi.alertHidesInstalled = loaded.alertHidesInstalled === true;
 state.temperatureInstalled = opsUi.temperatureInstalled;
 state.materialsInstalled = opsUi.materialsInstalled;
 state.waterInstalled = opsUi.waterInstalled;
 state.waterFiltersInstalled = opsUi.waterFiltersInstalled;
 if (loaded.bundle) state.operationPreview = loaded.bundle;
 else if (!state.operationPreview) state.operationPreview = emptyOperations();
 if (!loaded.ok && announce) say('error', loaded.error);
 return loaded;
}

export function bundle() {
 return state.operationPreview || emptyOperations();
}

export function today() {
 return new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Berlin'}).format(new Date());
}

export function button(label, className, onClick) {
 const node = document.createElement('button');
 node.type = 'button';
 node.className = className || '';
 node.textContent = label;
 node.addEventListener('click', async () => {
  if (node.disabled || opsUi.saving) return;
  node.disabled = true;
  try { await onClick(); }
  finally { node.disabled = false; }
 });
 return node;
}

export function labeled(text, control) {
 const node = document.createElement('label');
 node.textContent = text;
 node.append(control);
 return node;
}

export function berlinLocal(date = new Date()) {
 const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(date);
 const part = type => parts.find(item => item.type === type)?.value || '00';
 return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export function input(value) {
 const node = document.createElement('input');
 node.autocomplete = 'off';
 if (value) node.value = value;
 return node;
}

export function area(value) {
 const node = document.createElement('textarea');
 node.value = value || '';
 return node;
}

export function select(options, value) {
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

export function item(title, lines, overdue) {
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


export function amountLabel(value) {
 return new Intl.NumberFormat('de-DE', {maximumFractionDigits: 3}).format(Number(value));
}

export function missingNote(host, ready, message) {
 if (ready) return;
 const note = document.createElement('p');
 note.className = 'help';
 note.textContent = message;
 host.append(note);
}

export function renderAlertVisibilityBar(host, current, source) {
 if (!opsUi.alertHidesInstalled || !isManager(current)) return;
 const bar = document.createElement('div');
 bar.className = 'alert-visibility-bar';
 const filter = select([
  {value: 'active', label: 'Aktive Warnungen'},
  {value: 'hidden', label: 'Ausgeblendete Warnungen'}
 ], opsUi.alertView[source] || 'active');
 filter.addEventListener('change', () => {
  opsUi.alertView[source] = filter.value;
  renderPanel('');
 });
 const days = select([
  {value: '7', label: 'älter als 7 Tage'},
  {value: '14', label: 'älter als 14 Tage'},
  {value: '30', label: 'älter als 30 Tage'}
 ], '7');
 const help = document.createElement('p');
 help.className = 'help';
 help.textContent = 'Das Ausblenden gilt für alle Benutzer dieses Betriebs. Messung und Warnungsstatus bleiben unverändert.';
 bar.append(labeled('Anzeige', filter), labeled('Sammelausblendung', days));
 bar.append(button('Alte Warnungen ausblenden', 'secondary', () => commit(() => saveOldFacilityAlertHides(database(), bundle(), current, Number(days.value), actor(), new Date().toISOString(), context()))));
 bar.append(help);
 host.append(bar);
}


