import {facilityVisibleToMember} from './permissions.js';
import {assetNextDue, assetOverdue, berlinDay, inspectionOverdue} from './operations.js';
import {facilityNotices, missingTemperaturePoints} from './operations-controls.js';
import {state} from './state.js';
import {el} from './utils.js';

const upcomingMs = 7 * 24 * 60 * 60 * 1000;
const routes = {capture: null, task: null, notice: null};

export const captureActions = [
 {id: 'defect', label: 'Mangel melden'},
 {id: 'temperature', label: 'Temperatur erfassen'},
 {id: 'reading', label: 'Zählerstand erfassen'},
 {id: 'daily-report', label: 'Tagesbericht erstellen'},
 {id: 'procurement', label: 'Beschaffung melden'}
];

export function onCapture(handler) { routes.capture = handler; }
export function onOpenTask(handler) { routes.task = handler; }
export function onOpenNotice(handler) { routes.notice = handler; }

export function greeting(date = new Date()) {
 const hour = Number(new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23'}).format(date));
 if (hour < 11) return 'Guten Morgen';
 if (hour < 17) return 'Guten Tag';
 if (hour < 22) return 'Guten Abend';
 return 'Gute Nacht';
}

function countLine(count, one, many) {
 return `${count} ${count === 1 ? one : many}`;
}

export function homeLines(counts) {
 const lines = [
  countLine(counts.inspections, 'offener Kontrollgang', 'offene Kontrollgänge'),
  counts.temperatureInstalled
   ? countLine(counts.temperature, 'Temperaturkontrolle ausstehend', 'Temperaturkontrollen ausstehend')
   : 'Temperatur ist noch nicht in der Datenbank installiert.',
  countLine(counts.maintenance, 'Wartung fällig', 'Wartungen fällig'),
  countLine(counts.notices, 'neuer Hinweis', 'neue Hinweise')
 ];
 return lines;
}

function allowed(facilityId, organizationId, actor, ids) {
 if (!ids.includes(facilityId)) return false;
 if (!organizationId) return true;
 return facilityVisibleToMember({id: facilityId, organization_id: organizationId}, actor?.memberships || []);
}

function scope(assignedId, userId) {
 if (assignedId && assignedId === userId) return {personal: true, forYou: true, scope: 'Dir zugewiesen'};
 if (assignedId) return {personal: false, forYou: false, scope: 'Einer anderen Person zugewiesen'};
 return {personal: false, forYou: true, scope: 'Für den Betrieb'};
}

function bucketFor(due, now, overdue) {
 if (overdue) return 'overdue';
 if (!due) return null;
 const dueTime = new Date(due).getTime();
 const nowTime = new Date(now).getTime();
 if (Number.isNaN(dueTime) || Number.isNaN(nowTime)) return null;
 if (berlinDay(due) === berlinDay(now)) return 'today';
 if (dueTime > nowTime && dueTime - nowTime <= upcomingMs) return 'upcoming';
 return null;
}

export function workAgenda(bundle, options = {}) {
 const ids = options.facilityIds || [];
 const actor = options.actor || {};
 const now = options.now || new Date().toISOString();
 const items = [];
 const push = item => {
  if (!allowed(item.facilityId, item.organizationId, actor, ids)) return;
  items.push(item);
 };
 for (const run of bundle?.runs || []) {
  if (run.status === 'completed') continue;
  const bucket = bucketFor(run.dueAt, now, inspectionOverdue(run, now));
  if (!bucket) continue;
  push({
   id: `inspection:${run.id}`,
   facilityId: run.facilityId,
   organizationId: run.organizationId,
   kind: 'inspection',
   title: run.name || 'Kontrollgang',
   dueAt: run.dueAt,
   bucket,
   ...scope(run.assignedTo, actor.userId)
  });
 }
 for (const asset of bundle?.assets || []) {
  const due = assetNextDue(asset);
  const bucket = bucketFor(due, now, assetOverdue(asset, now));
  if (!bucket) continue;
  push({
   id: `maintenance:${asset.id}`,
   facilityId: asset.facilityId,
   organizationId: asset.organizationId,
   kind: 'maintenance',
   title: asset.name || 'Wartung',
   dueAt: due ? due.toISOString() : '',
   bucket,
   ...scope(asset.responsibleUserId, actor.userId)
  });
 }
 for (const facilityId of ids) {
  for (const point of missingTemperaturePoints(bundle, facilityId, now)) {
   push({
    id: `temperature:${point.id}`,
    facilityId: point.facilityId,
    organizationId: point.organizationId,
    kind: 'temperature',
    title: point.name || 'Temperaturkontrolle',
    dueAt: now,
    bucket: 'today',
    personal: false,
    forYou: true,
    scope: 'Für den Betrieb'
   });
  }
 }
 const rank = {overdue: 0, today: 1, upcoming: 2};
 return items.sort((left, right) => rank[left.bucket] - rank[right.bucket] || String(left.dueAt).localeCompare(String(right.dueAt)) || left.title.localeCompare(right.title, 'de'));
}

export function agendaCounts(items, noticeCount, temperatureInstalled) {
 return {
  inspections: items.filter(item => item.forYou && item.kind === 'inspection').length,
  temperature: items.filter(item => item.forYou && item.kind === 'temperature').length,
  maintenance: items.filter(item => item.forYou && item.kind === 'maintenance' && item.bucket !== 'upcoming').length,
  notices: noticeCount,
  temperatureInstalled: temperatureInstalled === true
 };
}

function selectedFacilityIds() {
 const selected = el('dashboard-facility')?.value || 'all';
 return state.accessibleFacilities.filter(item => selected === 'all' || item.id === selected).map(item => item.id);
}

function actor() {
 const profile = state.staff.find(member => member.user_id === state.currentUser?.id);
 return {userId: state.currentUser?.id, name: profile?.name || '', memberships: state.myMemberships};
}

function facilityName(id) {
 return state.accessibleFacilities.find(item => item.id === id)?.name || 'Betrieb';
}

function taskButton(item) {
 const button = document.createElement('button');
 button.type = 'button';
 button.className = `task-card${item.bucket === 'overdue' ? ' is-overdue' : ''}`;
 const title = document.createElement('strong');
 title.textContent = item.title;
 const detail = document.createElement('small');
 detail.textContent = `${facilityName(item.facilityId)} · ${item.scope}`;
 button.append(title, detail);
 button.addEventListener('click', () => routes.task?.(item));
 return button;
}

function group(host, title, items, empty) {
 const block = document.createElement('section');
 const heading = document.createElement('h3');
 heading.textContent = title;
 block.append(heading);
 if (!items.length) {
  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = empty;
  block.append(note);
 } else {
  for (const item of items) block.append(taskButton(item));
 }
 host.append(block);
}

export function toggleCapture(force) {
 ensureCapture();
 const sheet = el('capture-sheet');
 if (!sheet) return;
 const open = force === undefined ? sheet.classList.contains('hidden') : force === true;
 sheet.classList.toggle('hidden', !open);
 const active = open ? 'capture' : state.currentView;
 for (const button of document.querySelectorAll('[data-view]')) button.classList.toggle('active', button.dataset.view === active);
}

function ensureCapture() {
 const host = el('capture-actions');
 const quick = el('home-quick');
 if (host && !host.childElementCount) {
  for (const action of captureActions) {
   const button = document.createElement('button');
   button.type = 'button';
   button.dataset.capture = action.id;
   button.textContent = action.label;
   host.append(button);
  }
 }
 if (quick && !quick.childElementCount) {
  for (const action of captureActions.filter(item => item.id !== 'procurement')) {
   const button = document.createElement('button');
   button.type = 'button';
   button.dataset.capture = action.id;
   button.textContent = action.id === 'reading' ? 'Zählerstand eintragen' : action.id === 'daily-report' ? 'Tagesbericht' : action.label;
   quick.append(button);
  }
 }
}

function paintList(host, notices) {
 if (!host) return;
 host.replaceChildren();
 if (!notices.length) {
  const empty = document.createElement('p');
  empty.className = 'muted';
  empty.textContent = 'Keine offenen Hinweise für den gewählten Betrieb.';
  host.append(empty);
  return;
 }
 for (const notice of notices) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = notice.warn ? 'task-card is-overdue' : 'task-card';
  const title = document.createElement('strong');
  title.textContent = notice.title;
  const detail = document.createElement('small');
  detail.textContent = `${facilityName(notice.facilityId)} · ${notice.detail}`;
  button.append(title, detail);
  button.addEventListener('click', () => routes.notice?.(notice));
  host.append(button);
 }
}

export function paintMobile() {
 if (!el('home-greeting')) return;
 ensureCapture();
 const ids = selectedFacilityIds();
 const now = new Date().toISOString();
 const current = actor();
 const bundle = state.operationPreview;
 const items = bundle ? workAgenda(bundle, {facilityIds: ids, actor: current, now}) : [];
 const notices = bundle ? facilityNotices(bundle, state.cachedDefects, {facilityIds: ids, actor: current, now}) : [];
 const lines = bundle
  ? homeLines(agendaCounts(items, notices.length, state.temperatureInstalled))
  : ['Die Betriebsdaten werden geladen.'];
 el('home-greeting').textContent = `${greeting()}!`;
 const selected = el('dashboard-facility');
 el('home-facility').textContent = selected?.selectedOptions?.[0]?.textContent || 'Betrieb';
 const today = el('home-today');
 today.replaceChildren();
 for (const line of lines) {
  const item = document.createElement('li');
  item.textContent = line;
  today.append(item);
 }
 const agenda = el('agenda-list');
 if (agenda) {
  agenda.replaceChildren();
  group(agenda, 'Überfällig', items.filter(item => item.bucket === 'overdue'), 'Nichts ist überfällig.');
  group(agenda, 'Heute', items.filter(item => item.bucket === 'today'), 'Für heute liegt nichts an.');
  group(agenda, 'Demnächst', items.filter(item => item.bucket === 'upcoming'), 'In den nächsten sieben Tagen liegt nichts an.');
 }
 paintList(el('notice-list'), notices);
}

document.addEventListener('click', event => {
 const capture = event.target.closest?.('[data-capture]');
 if (!capture) return;
 toggleCapture(false);
 routes.capture?.(capture.dataset.capture);
});
