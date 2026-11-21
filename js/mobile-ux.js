import {el} from './utils.js';
import {state} from './state.js';
import {isManager, mayAppointManager} from './permissions.js';
import {toggleCapture} from './mobile.js';

const DRAFT = 'tageswerk-draft';
const NARROW = 850;

export function isMobileUx() {
 if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
 return window.matchMedia(`(max-width:${NARROW}px)`).matches;
}

export const MORE_GROUPS = [
 {
  id: 'betrieb',
  label: 'Tagesgeschäft',
  items: [
   {id: 'open-operations', label: 'Betriebserfassung', manager: false},
   {id: 'open-consumption', label: 'Zählerstände', manager: false}
  ]
 },
 {
  id: 'verwaltung',
  label: 'Verwaltung',
  items: [
   {id: 'open-management-dashboard', label: 'Management-Dashboard', manager: true},
   {id: 'staff-card', label: 'Mitarbeiter', manager: true},
   {id: 'invite-card', label: 'Einladungen', manager: true},
   {id: 'facility-admin-card', label: 'Betriebe anlegen', manager: true, admin: true},
   {id: 'settings-card', label: 'Eskalationsregeln', manager: true}
  ]
 },
 {
  id: 'einstellungen',
  label: 'Einstellungen',
  items: [
   {id: 'mgmt-open-settings', label: 'Dashboard-Darstellung', manager: true}
  ]
 }
];

export function moreHubItems(memberships, facilities) {
 const manager = (facilities || []).some(facility => isManager(facility));
 const admin = (state.organizations || []).some(org => mayAppointManager(org.id, memberships));
 return MORE_GROUPS.map(group => ({
  ...group,
  items: group.items.filter(item => {
   if (item.admin) return admin;
   if (item.manager) return manager;
   const node = typeof document !== 'undefined' ? document.getElementById(item.id) : null;
   if (node?.tagName === 'BUTTON' && node.classList.contains('hidden')) return false;
   return true;
  })
 })).filter(group => group.items.length);
}

function ensureSheet() {
 let sheet = el('mobile-sheet');
 if (sheet) return sheet;
 sheet = document.createElement('div');
 sheet.id = 'mobile-sheet';
 sheet.className = 'mobile-sheet hidden';
 sheet.setAttribute('role', 'dialog');
 sheet.setAttribute('aria-modal', 'true');
 const panel = document.createElement('div');
 panel.className = 'mobile-sheet-panel';
 panel.innerHTML = '<div class="mobile-sheet-head"><h2 id="mobile-sheet-title">Filter</h2><button type="button" class="secondary compact-button" id="mobile-sheet-close">Schließen</button></div><div id="mobile-sheet-body"></div>';
 sheet.append(panel);
 sheet.addEventListener('click', event => {
  if (event.target === sheet) closeSheet();
 });
 document.body.append(sheet);
 el('mobile-sheet-close')?.addEventListener('click', closeSheet);
 return sheet;
}

export function openSheet(title, fill) {
 const sheet = ensureSheet();
 const titleNode = el('mobile-sheet-title');
 const body = el('mobile-sheet-body');
 if (titleNode) titleNode.textContent = title;
 if (body) {
  body.replaceChildren();
  fill?.(body);
 }
 sheet.classList.remove('hidden');
}

let filterHome = null;

export function closeSheet() {
 const bar = document.querySelector('#mobile-sheet-body .filterbar');
 if (bar && filterHome?.parent) {
  filterHome.parent.insertBefore(bar, filterHome.next);
  filterHome = null;
 }
 el('mobile-sheet')?.classList.add('hidden');
}

export function bindDraft(form) {
 if (!form?.id) return;
 const key = `${DRAFT}:${form.id}`;
 try {
  const saved = sessionStorage.getItem(key);
  if (saved) {
   const data = JSON.parse(saved);
   for (const [name, value] of Object.entries(data)) {
    const field = form.elements[name] || form.querySelector(`#${name}`);
    if (field && field.type !== 'file' && value != null) field.value = value;
   }
  }
 } catch { /* ignore */ }
 form.addEventListener('input', () => {
  const data = {};
  for (const field of form.querySelectorAll('input,select,textarea')) {
   if (!field.id || field.type === 'file' || field.type === 'password') continue;
   data[field.id] = field.value;
  }
  try { sessionStorage.setItem(key, JSON.stringify(data)); } catch { /* ignore */ }
 });
 form.addEventListener('submit', () => {
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
 });
}

function wrapHidden(node, title) {
 if (!node || node.dataset.mobileFold === '1' || node.closest?.('details.mobile-fold')) return;
 node.dataset.mobileFold = '1';
 const details = document.createElement('details');
 details.className = 'mobile-fold';
 const summary = document.createElement('summary');
 summary.textContent = title;
 details.append(summary);
 node.parentNode?.insertBefore(details, node);
 details.append(node);
}

export function collapseRareSections() {
 if (!isMobileUx()) return;
 wrapHidden(el('management-config'), 'Darstellung und Kennzahlen');
 wrapHidden(el('settings-card'), 'Eskalationsregeln');
 wrapHidden(el('orgs')?.closest('.card'), 'Unternehmen');
 wrapHidden(el('facilities')?.closest('.card'), 'Betriebe');
 const meterManage = document.querySelector('#consumption-card form.manage, #meter-form');
 if (meterManage) wrapHidden(meterManage.closest('form') || meterManage, 'Zählerverwaltung');
}

export function mountCasesTabs() {
 const host = el('defects-card');
 if (!host || el('cases-tabs')) return;
 const tabs = document.createElement('div');
 tabs.id = 'cases-tabs';
 tabs.className = 'cases-tabs';
 const notices = document.createElement('button');
 notices.type = 'button';
 notices.className = 'secondary';
 notices.textContent = 'Hinweise';
 notices.addEventListener('click', () => {
  document.querySelector('[data-view="notices"]')?.click();
 });
 tabs.append(notices);
 host.prepend(tabs);
}

export function mountCaptureFab() {
 if (el('mobile-capture-fab')) return;
 const fab = document.createElement('button');
 fab.id = 'mobile-capture-fab';
 fab.type = 'button';
 fab.textContent = '＋ Erfassen';
 fab.addEventListener('click', () => toggleCapture(true));
 document.body.append(fab);
 bindFabViewport();
}

function bindFabViewport() {
 if (document.documentElement.dataset.fabViewport === '1') return;
 document.documentElement.dataset.fabViewport = '1';
 const apply = () => {
  const vv = window.visualViewport;
  const covered = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  document.documentElement.style.setProperty('--tw-keyboard', `${covered}px`);
  document.body.classList.toggle('keyboard-open', covered > 80);
 };
 apply();
 window.visualViewport?.addEventListener('resize', apply);
 window.visualViewport?.addEventListener('scroll', apply);
 window.addEventListener('focusin', event => {
  if (event.target?.matches?.('input,textarea,select')) document.body.classList.add('field-focus');
 });
 window.addEventListener('focusout', () => document.body.classList.remove('field-focus'));
}

function compactSecurityNotice() {
 if (!isMobileUx()) return;
 const notice = document.querySelector('main > .notice.notice-compact');
 if (!notice || notice.dataset.folded === '1' || notice.tagName === 'DETAILS') return;
 notice.dataset.folded = '1';
 const text = notice.textContent.trim();
 const details = document.createElement('details');
 details.className = notice.className;
 details.setAttribute('role', 'status');
 const summary = document.createElement('summary');
 summary.textContent = 'Mandantentrennung aktiv';
 const body = document.createElement('p');
 body.className = 'notice-full';
 body.textContent = text;
 details.append(summary, body);
 notice.replaceWith(details);
}

function mountMgmtBack() {
 if (el('mgmt-back-more') || !el('management-board-card')) return;
 const button = document.createElement('button');
 button.id = 'mgmt-back-more';
 button.type = 'button';
 button.className = 'secondary';
 button.textContent = 'Zurück zu Mehr';
 button.addEventListener('click', () => {
  el('management-board-card')?.classList.add('hidden');
  el('more-hub')?.scrollIntoView({behavior: 'smooth', block: 'start'});
  window.scrollTo({top: 0, behavior: 'smooth'});
 });
 el('management-board-card').prepend(button);
}

export function mountMoreHub() {
 const view = el('view-more');
 if (!view) return;
 let hub = el('more-hub');
 if (!hub) {
  hub = document.createElement('div');
  hub.id = 'more-hub';
  hub.className = 'more-hub card';
  view.prepend(hub);
 }
 const groups = moreHubItems(state.myMemberships, state.accessibleFacilities);
 hub.replaceChildren();
 const heading = document.createElement('h2');
 heading.textContent = 'Mehr';
 hub.append(heading);
 for (const group of groups) {
  const block = document.createElement('section');
  const title = document.createElement('h3');
  title.textContent = group.label;
  block.append(title);
  for (const item of group.items) {
   const button = document.createElement('button');
   button.type = 'button';
   button.className = 'module-card neon-tile accent-cyan';
   button.textContent = item.label;
   button.addEventListener('click', () => {
    const target = el(item.id);
    if (item.id === 'mgmt-open-settings') {
     el('open-management-dashboard')?.click();
     el('management-config')?.closest('details')?.setAttribute('open', '');
     el('management-config')?.scrollIntoView({behavior: 'smooth', block: 'start'});
     return;
    }
    if (target?.tagName === 'BUTTON') target.click();
    else {
     const fold = target?.closest('details');
     if (fold) fold.open = true;
     target?.classList.remove('hidden');
     target?.scrollIntoView({behavior: 'smooth', block: 'start'});
    }
   });
   block.append(button);
  }
  hub.append(block);
 }
}

export function bindMobileFilters() {
 const bar = document.querySelector('#defects-panel > .filterbar');
 if (!bar || bar.dataset.mobileBound === '1') return;
 bar.dataset.mobileBound = '1';
 const button = document.createElement('button');
 button.type = 'button';
 button.id = 'defect-filter-toggle';
 button.className = 'secondary';
 button.textContent = 'Filter';
 button.addEventListener('click', () => {
  if (!filterHome) filterHome = {parent: bar.parentNode, next: bar.nextSibling};
  openSheet('Mängelfilter', host => {
   host.append(bar);
   const reset = document.createElement('button');
   reset.type = 'button';
   reset.className = 'secondary';
   reset.textContent = 'Filter zurücksetzen';
   reset.addEventListener('click', () => {
    if (el('defect-facility-filter')) el('defect-facility-filter').value = 'all';
    if (el('defect-filter')) el('defect-filter').value = 'open';
    el('defect-facility-filter')?.dispatchEvent(new Event('change'));
    el('defect-filter')?.dispatchEvent(new Event('change'));
    closeSheet();
   });
   host.append(reset);
  });
 });
 bar.parentNode?.insertBefore(button, bar);
}

export function bindFormDrafts() {
 bindDraft(el('defect-form'));
 bindDraft(el('invite-form'));
 bindDraft(el('form'));
}

export function mountMobileUx() {
 document.body.classList.add('nexus-v45');
 if (isMobileUx()) el('operations-card')?.classList.add('hidden');
 compactSecurityNotice();
 mountCaptureFab();
 mountCasesTabs();
 mountMoreHub();
 mountMgmtBack();
 collapseRareSections();
 bindMobileFilters();
 bindFormDrafts();
 const settings = el('mgmt-open-settings');
 if (!settings && el('management-config')) {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'mgmt-open-settings';
  button.className = 'secondary';
  button.textContent = 'Darstellung';
  button.addEventListener('click', () => {
   const fold = el('management-config')?.closest('details');
   if (fold) fold.open = !fold.open;
   else el('management-config')?.classList.toggle('hidden');
  });
  el('management-board-card')?.querySelector('h2')?.after(button);
 }
}

export function compactList(host, limit = 12) {
 if (!host || !isMobileUx()) return;
 const cards = [...host.children].filter(node => node.matches?.('.item,.defect-card,.task-card,.mgmt-tile,.dash-row,.stock-card'));
 if (cards.length <= limit) return;
 for (const card of cards.slice(limit)) card.classList.add('hidden');
 if (host.querySelector('.mobile-more-rows')) return;
 const more = document.createElement('button');
 more.type = 'button';
 more.className = 'secondary mobile-more-rows';
 more.textContent = `Weitere ${cards.length - limit} anzeigen`;
 more.addEventListener('click', () => {
  for (const card of cards) card.classList.remove('hidden');
  more.remove();
 });
 host.append(more);
}
